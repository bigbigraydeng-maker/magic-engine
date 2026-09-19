/**
 * SEO Meta-Cycle v1 — the six-step chain's business logic, one function per
 * step (docs/specs/2026-09-20-seo-meta-cycle-v1-spec.md §4). Every function
 * here takes an explicit `supabase`/`adapter` — no top-level `import
 * supabaseAdmin`, same discipline as flywheel/seo-weekly.ts, so these are
 * directly unit-testable and the Inngest function file (the only place that
 * imports supabaseAdmin) wraps each call in its own `step.run`.
 *
 * Client-agnostic: nothing here references CTS. The only client-specific
 * pieces are `config` (L4, read from clients.seo_config) and `adapter` (L3,
 * constructed by the caller per client).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getClientCompetitorDomains } from '@/lib/competitors/resolver'
import { getKeywordsGap } from '@/lib/dataforseo/labs'
import { locationCodeForDb } from '@/lib/seo-intelligence/keyword-snapshots'
import { readPageMetrics } from '@/lib/seo/post-publish-monitor-store'
import { buildSitemapUrlFromDomain, pingSitemap } from '@/lib/gsc/sitemap-ping'
import { saveFailedExperiment, saveProvenPattern } from '@/lib/memory/service'
import { persistZhugeActions } from '@/lib/zhuge/action-persister'
import type { PriorityAction, ZhugeOutput } from '@/lib/zhuge/types'
import { deriveMetaCycleAction } from './action-mapping'
import { checkGlobalDataForSeoBudget } from './budget-guard'
import {
  fromGapKeywords,
  fromGscPages,
  fromPatrolFindings,
  mergeCandidates,
  type RawGapKeyword,
  type RawGscPage,
  type RawGscQuery,
  type RawPatrolFinding,
} from './candidates'
import { enrichCandidates, type EnrichedCandidate } from './enrichment'
import { classifyMetaChangeOutcome } from './outcome-classifier'
import { checkOscillationCap } from './oscillation'
import type {
  ApplyAdapter,
  ApplyAdapterResult,
  MetaCycleClientConfig,
  MetaCyclePrescription,
} from './types'

// ── Step 1: check_due (re-classify last cycle's changes, revert regressions) ──

/** Single T+14 checkpoint — spec §4 mentions "7/14 天前"; this v1 implements one
 *  checkpoint at 14 days rather than a two-pass 7-then-14 recheck, to avoid
 *  double-bookkeeping a row's checked_at/outcome across two separate checks.
 *  14 was chosen over 7 because it matches the "14 天有回查兜底" figure the
 *  spec itself uses everywhere else (§7's automation-safety table). */
export const CHECK_AFTER_DAYS = 14

interface SeoMetaLogRow {
  id: string
  page_slug: string
  page_url: string
  keyword: string
  new_title: string | null
  new_desc: string | null
  old_title: string | null
  old_desc: string | null
  baseline_ctr: number | null
  baseline_position: number | null
  baseline_impressions: number | null
  revert_count: number | null
}

export interface Step1Result {
  checked: number
  improved: number
  flat: number
  insufficientData: number
  regressed: number
  reverted: number
  routedToManual: number
  revertedSlugs: string[]
}

function buildManualAction(evidenceKey: string, meta: { page_slug: string; page_url: string; keyword: string }, whyNow: string): PriorityAction {
  return {
    rank: 1,
    dimension: 'seo',
    action_type: 'meta_cycle_manual_review',
    why_now: whyNow,
    evidence_refs: [evidenceKey],
    expected_impact: 'medium',
    effort: 'low',
    execution_mode: 'in_house',
    executable_by: null,
    metadata: meta,
  }
}

/** One row's worth of step-1 work — pulled out of runStep1CheckDue to keep that function under the CLAUDE.md 50-line-per-function budget. */
async function processCheckDueRow(
  supabase: SupabaseClient,
  adapter: ApplyAdapter,
  config: MetaCycleClientConfig,
  row: SeoMetaLogRow,
  weekKey: string,
  dryRun: boolean,
  now: Date,
): Promise<{ outcome: 'improved' | 'flat' | 'insufficient_data' | 'regressed'; reverted: boolean; revertedSlug: string | null; manualAction: PriorityAction | null }> {
  const observed = await readPageMetrics(supabase, config.clientId, row.page_url).catch(() => null)
  const classification = classifyMetaChangeOutcome(
    { ctr: row.baseline_ctr, position: row.baseline_position, impressions: row.baseline_impressions },
    {
      ctr: observed?.gsc.ctr ?? null,
      position: observed?.gsc.position ?? null,
      impressions: observed?.gsc.impressions ?? null,
      clicks: observed?.gsc.clicks ?? null,
    },
  )

  if (!dryRun) {
    await supabase.from('seo_meta_log').update({ checked_at: now.toISOString(), outcome: classification.outcome }).eq('id', row.id)
  }

  if (classification.outcome === 'improved') {
    if (!dryRun) {
      await saveProvenPattern(supabase, {
        client_id: config.clientId,
        pattern_type: 'headline',
        pattern_content: `Rewriting "${row.old_title}" → "${row.new_title}" for /${row.page_slug} improved CTR (${classification.reason})`,
        flywheel: 'seo',
        source_table: 'seo_meta_log',
        source_id: row.id,
      })
    }
    return { outcome: 'improved', reverted: false, revertedSlug: null, manualAction: null }
  }
  // Finding #11: insufficient_data (and flat) must never trigger a revert.
  if (classification.outcome === 'flat' || classification.outcome === 'insufficient_data') {
    return { outcome: classification.outcome, reverted: false, revertedSlug: null, manualAction: null }
  }

  // regressed — the only outcome that can trigger a revert.
  if (!dryRun) {
    await saveFailedExperiment(supabase, {
      client_id: config.clientId,
      experiment_description: `Rewrote "${row.old_title}" → "${row.new_title}" for /${row.page_slug}`,
      failure_reason: classification.reason,
      dimension: 'seo',
      source_table: 'seo_meta_log',
      source_id: row.id,
    })
  }

  const meta = { page_slug: row.page_slug, page_url: row.page_url, keyword: row.keyword }
  const oscillation = await checkOscillationCap(supabase, config.clientId, row.page_slug, adapter.channel)
  if (oscillation.forceManual) {
    return {
      outcome: 'regressed',
      reverted: false,
      revertedSlug: null,
      manualAction: buildManualAction(`seo_meta_log:${row.id}`, meta, `连续回归 ${oscillation.revertCount} 次，改为人工看板：${oscillation.reason}`),
    }
  }

  let revertResult: ApplyAdapterResult
  try {
    revertResult = await adapter.revert({
      slug: row.page_slug,
      lastWrittenTitle: row.new_title ?? '',
      lastWrittenDesc: row.new_desc ?? '',
      revertToTitle: row.old_title ?? '',
      revertToDesc: row.old_desc ?? '',
      weekKey,
      dryRun,
    })
  } catch (err) {
    // One candidate's GitHub error (e.g. a stale blob SHA because an earlier
    // candidate in this same run touched the same underlying data file) must
    // not abort every other row's check — isolate it as a manual item.
    return {
      outcome: 'regressed',
      reverted: false,
      revertedSlug: null,
      manualAction: buildManualAction(`seo_meta_log:${row.id}`, meta, `自动改回原文失败（${err instanceof Error ? err.message : String(err)}），需要人工处理`),
    }
  }

  if (revertResult.applied) {
    if (!dryRun) {
      await supabase.from('seo_meta_log').insert({
        client_id: config.clientId,
        content_type: 'meta',
        page_slug: row.page_slug,
        page_url: row.page_url,
        keyword: row.keyword,
        old_title: revertResult.oldTitle,
        old_desc: revertResult.oldDesc,
        new_title: revertResult.newTitle,
        new_desc: revertResult.newDesc,
        wp_updated: false,
        applied_channel: adapter.channel,
        optimised_at: now.toISOString(),
        revert_count: (row.revert_count ?? 0) + 1,
      })
    }
    return { outcome: 'regressed', reverted: true, revertedSlug: row.page_slug, manualAction: null }
  }

  if (revertResult.skipReason === 'human_edited_since_last_write') {
    return { outcome: 'regressed', reverted: false, revertedSlug: null, manualAction: buildManualAction(`seo_meta_log:${row.id}`, meta, '人已经在 GitHub 手改过这个标题，机器不再碰，改人工确认') }
  }
  if (revertResult.skipReason === 'pr_opened_but_not_merged') {
    const prNote = revertResult.prUrl ? `：${revertResult.prUrl}` : ''
    return { outcome: 'regressed', reverted: false, revertedSlug: null, manualAction: buildManualAction(`seo_meta_log:${row.id}`, meta, `已经开了改回原文的 PR 但没合并成功，需要人工去合并${prNote}`) }
  }
  // other skipReasons (slug_not_in_file etc.) — nothing to route, the page
  // no longer has an editable meta lane; not this step's problem to solve.
  return { outcome: 'regressed', reverted: false, revertedSlug: null, manualAction: null }
}

export async function runStep1CheckDue(
  supabase: SupabaseClient,
  adapter: ApplyAdapter,
  config: MetaCycleClientConfig,
  weekKey: string,
  dryRun: boolean,
  now: Date = new Date(),
): Promise<Step1Result> {
  const result: Step1Result = {
    checked: 0, improved: 0, flat: 0, insufficientData: 0, regressed: 0,
    reverted: 0, routedToManual: 0, revertedSlugs: [],
  }

  const cutoff = new Date(now.getTime() - CHECK_AFTER_DAYS * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from('seo_meta_log')
    .select('id, page_slug, page_url, keyword, new_title, new_desc, old_title, old_desc, baseline_ctr, baseline_position, baseline_impressions, revert_count')
    .eq('client_id', config.clientId)
    .eq('applied_channel', adapter.channel)
    .is('checked_at', null)
    .lte('optimised_at', cutoff)
    .order('optimised_at', { ascending: true })
    .limit(20)

  if (error || !data) return result
  const manualActions: PriorityAction[] = []

  for (const row of data as SeoMetaLogRow[]) {
    result.checked += 1
    const outcome = await processCheckDueRow(supabase, adapter, config, row, weekKey, dryRun, now)
    if (outcome.outcome === 'improved') result.improved += 1
    else if (outcome.outcome === 'flat') result.flat += 1
    else if (outcome.outcome === 'insufficient_data') result.insufficientData += 1
    else result.regressed += 1

    if (outcome.reverted && outcome.revertedSlug) {
      result.reverted += 1
      result.revertedSlugs.push(outcome.revertedSlug)
    }
    if (outcome.manualAction) {
      result.routedToManual += 1
      manualActions.push(outcome.manualAction)
    }
  }

  if (!dryRun && manualActions.length > 0) {
    await persistZhugeActions(supabase, {
      clientId: config.clientId,
      discoveryId: `seo_meta_cycle:${weekKey}:revert_review`,
      diagnosticRunId: null,
      output: { top_actions: manualActions, generated_at: now.toISOString(), cost_usd: 0, input_tokens: 0, output_tokens: 0 },
    }).catch(() => undefined)
  }

  return result
}

// ── Step 2: candidates_ready (discover + merge + enrich) ──────────────────────

export interface Step2Result {
  candidates: EnrichedCandidate[]
  dataforseoCallsMade: number
  budgetOverrun: boolean
}

interface PatrolFindingRow {
  keyword: string | null
  url: string | null
  position: number | null
  ctr: number | null
  search_volume: number | null
  keyword_difficulty: number | null
}

async function loadGapKeywords(
  config: MetaCycleClientConfig,
  budgetOverBudget: boolean,
): Promise<{ gapKeywords: RawGapKeyword[]; gapCallsMade: number }> {
  if (budgetOverBudget) return { gapKeywords: [], gapCallsMade: 0 }
  try {
    const competitorDomains = await getClientCompetitorDomains(config.clientId)
    if (competitorDomains.length === 0) return { gapKeywords: [], gapCallsMade: 0 }
    const locationCode = locationCodeForDb(config.semrushDb)
    const gap = await getKeywordsGap(config.domain, competitorDomains.slice(0, 3), locationCode, 40)
    return {
      gapKeywords: gap.map((k) => ({ keyword: k.keyword, search_volume: k.search_volume, keyword_difficulty: k.keyword_difficulty })),
      gapCallsMade: 1,
    }
  } catch (err) {
    console.warn(`[seo-meta-cycle] gap keyword fetch failed for ${config.clientId}:`, err instanceof Error ? err.message : String(err))
    return { gapKeywords: [], gapCallsMade: 0 }
  }
}

export async function runStep2CandidatesReady(
  supabase: SupabaseClient,
  config: MetaCycleClientConfig,
  weekKey: string,
  excludeSlugs: ReadonlySet<string>,
): Promise<Step2Result> {
  const cooldownCutoff = new Date(Date.now() - config.cooldownDays * 86_400_000).toISOString()

  const [{ data: recentRows }, { data: patrolRows }, { data: gscRow }, budget] = await Promise.all([
    supabase.from('seo_meta_log').select('page_slug').eq('client_id', config.clientId).gte('optimised_at', cooldownCutoff),
    supabase.from('seo_patrol_findings').select('keyword, url, position, ctr, search_volume, keyword_difficulty').eq('client_id', config.clientId).eq('status', 'fresh'),
    supabase.from('gsc_performance_snapshots').select('top_pages, top_queries').eq('client_id', config.clientId).order('period_end', { ascending: false }).limit(1).maybeSingle(),
    checkGlobalDataForSeoBudget(supabase, weekKey),
  ])

  const cooldownSlugs = new Set(((recentRows ?? []) as Array<{ page_slug: string }>).map((r) => r.page_slug))
  const patrolFindings = ((patrolRows ?? []) as PatrolFindingRow[])
    .map((f): RawPatrolFinding => ({ keyword: f.keyword, url: f.url, position: f.position, ctr: f.ctr, searchVolume: f.search_volume, keywordDifficulty: f.keyword_difficulty }))
  const gscSnapshot = gscRow as { top_pages?: RawGscPage[]; top_queries?: RawGscQuery[] } | null

  const { gapKeywords, gapCallsMade } = await loadGapKeywords(config, budget.overBudget)

  const merged = mergeCandidates(
    {
      patrol: fromPatrolFindings(patrolFindings),
      gsc: fromGscPages(gscSnapshot?.top_pages ?? [], gscSnapshot?.top_queries ?? []),
      gap: fromGapKeywords(gapKeywords),
    },
    cooldownSlugs,
    excludeSlugs,
    config.maxPagesPerRun * 3, // wide pool — some candidates will be un-editable/skip, same rationale as cts-meta-pr.ts's pickCandidates(..., 12)
  )

  const locationCode = locationCodeForDb(config.semrushDb)
  const { enriched, dataforseoCallsMade } = await enrichCandidates(merged, locationCode, budget.remaining - gapCallsMade)

  return {
    candidates: enriched,
    dataforseoCallsMade: dataforseoCallsMade + gapCallsMade,
    budgetOverrun: budget.overBudget,
  }
}

// ── Step 3: prescribed (score → action type) ───────────────────────────────────

export interface Step3Result {
  prescriptions: MetaCyclePrescription[]
  autoCount: number
  manualCount: number
  skipCount: number
}

export function runStep3Prescribe(candidates: EnrichedCandidate[], maxAutoActions: number): Step3Result {
  const prescriptions = candidates.map(({ candidate, top3CompetitorDomains, top3CompetitorTitles }) =>
    deriveMetaCycleAction({ candidate, top3CompetitorDomains, top3CompetitorTitles }),
  )

  // Cap auto actions to maxPagesPerRun (L4 config) — everything past the cap
  // that would have been auto stays a candidate but doesn't execute this run;
  // it's still eligible next week (not cooled down, wasn't touched).
  let autoBudget = maxAutoActions
  const capped = prescriptions.map((p) => {
    if (p.auto && autoBudget > 0) {
      autoBudget -= 1
      return p
    }
    if (p.auto && autoBudget <= 0) {
      return { ...p, auto: false, reason: `${p.reason} (auto budget for this run exhausted, deferred to next cycle)` }
    }
    return p
  })

  return {
    prescriptions: capped,
    autoCount: capped.filter((p) => p.auto).length,
    manualCount: capped.filter((p) => !p.auto && p.actionType !== 'skip').length,
    skipCount: capped.filter((p) => p.actionType === 'skip').length,
  }
}

// ── Step 4: applied (execute auto actions, route manual ones) ─────────────────

export interface Step4Result {
  applied: Array<{ slug: string; actionType: string; prUrl?: string }>
  indexRequestsSent: number
  routedManual: number
}

const AI_META_MAX_TITLE = 60
const AI_META_MAX_DESC = 155

type GenerateMetaFn = (keyword: string, pageUrl: string, brandVoice: string, competitorTitles: string[]) => Promise<{ title: string; desc: string }>

function manualActionFor(p: MetaCyclePrescription, whyNow: string): PriorityAction {
  return {
    rank: 1,
    dimension: 'seo',
    action_type: p.actionType,
    why_now: whyNow,
    evidence_refs: p.candidate.pageUrl ? [`gsc:${p.candidate.pageUrl}`] : [`keyword:${p.candidate.keyword}`],
    expected_impact: 'medium',
    effort: p.actionType === 'new_page' ? 'high' : 'medium',
    execution_mode: 'in_house',
    executable_by: null,
    metadata: { keyword: p.candidate.keyword, page_url: p.candidate.pageUrl, action_type: p.actionType },
  }
}

/** One prescription's worth of step-4 work — pulled out to keep runStep4Applied under the 50-line budget. */
async function applyOnePrescription(
  supabase: SupabaseClient,
  adapter: ApplyAdapter,
  config: MetaCycleClientConfig,
  weekKey: string,
  p: MetaCyclePrescription,
  generateMeta: GenerateMetaFn,
  dryRun: boolean,
): Promise<{ applied: { slug: string; actionType: string; prUrl?: string } | null; manualAction: PriorityAction | null }> {
  if (!p.candidate.pageUrl) return { applied: null, manualAction: null }

  const meta = await generateMeta(p.candidate.keyword, p.candidate.pageUrl, config.brandVoice, p.top3CompetitorTitles)
  const title = meta.title.slice(0, AI_META_MAX_TITLE)
  const desc = meta.desc.slice(0, AI_META_MAX_DESC)
  if (!desc) {
    // AI generation failed (e.g. truncated/malformed JSON — cts-meta-pr.ts's
    // history, #1792, shows this really happens). Do NOT silently drop a
    // candidate step 3 already judged auto-eligible — route it to the
    // manual board instead ("发现不许死在日志里").
    return { applied: null, manualAction: manualActionFor(p, `AI 生成标题/描述失败，需要人工补一个（关键词：${p.candidate.keyword}）`) }
  }

  let applyResult: ApplyAdapterResult
  try {
    applyResult = await adapter.apply({ candidate: p.candidate, newTitle: title, newDesc: desc, weekKey, dryRun })
  } catch (err) {
    return { applied: null, manualAction: manualActionFor(p, `自动改标题失败（${err instanceof Error ? err.message : String(err)}），需要人工处理`) }
  }

  if (applyResult.applied) {
    if (!dryRun) {
      await supabase.from('seo_meta_log').insert({
        client_id: config.clientId,
        content_type: 'meta',
        page_slug: p.candidate.slug,
        page_url: p.candidate.pageUrl,
        keyword: p.candidate.keyword,
        old_title: applyResult.oldTitle,
        old_desc: applyResult.oldDesc,
        new_title: applyResult.newTitle,
        new_desc: applyResult.newDesc,
        wp_updated: false,
        applied_channel: adapter.channel,
        optimised_at: new Date().toISOString(),
        baseline_ctr: p.candidate.ctr,
        baseline_position: p.candidate.position,
        baseline_impressions: p.candidate.impressions,
      })
    }
    return { applied: { slug: p.candidate.slug ?? '', actionType: 'title_rewrite', prUrl: applyResult.prUrl }, manualAction: null }
  }

  if (applyResult.skipReason === 'pr_opened_but_not_merged') {
    const prNote = applyResult.prUrl ? `：${applyResult.prUrl}` : ''
    return { applied: null, manualAction: manualActionFor(p, `已经开了标题改动的 PR 但没合并成功，需要人工去合并${prNote}`) }
  }
  return { applied: null, manualAction: null }
}

export async function runStep4Applied(
  supabase: SupabaseClient,
  adapter: ApplyAdapter,
  config: MetaCycleClientConfig,
  weekKey: string,
  prescriptions: MetaCyclePrescription[],
  generateMeta: GenerateMetaFn,
  dryRun: boolean,
): Promise<Step4Result> {
  const result: Step4Result = { applied: [], indexRequestsSent: 0, routedManual: 0 }
  const manualActions: PriorityAction[] = []
  let needsIndexPing = false

  for (const p of prescriptions) {
    if (p.actionType === 'skip') continue

    if (!p.auto) {
      result.routedManual += 1
      manualActions.push(manualActionFor(p, p.reason))
      continue
    }

    if (p.actionType === 'index_request') {
      needsIndexPing = true
      continue
    }

    if (p.actionType === 'title_rewrite') {
      const outcome = await applyOnePrescription(supabase, adapter, config, weekKey, p, generateMeta, dryRun)
      if (outcome.applied) result.applied.push(outcome.applied)
      if (outcome.manualAction) {
        result.routedManual += 1
        manualActions.push(outcome.manualAction)
      }
    }
  }

  if (needsIndexPing && !dryRun) {
    const sitemapUrl = buildSitemapUrlFromDomain(config.domain)
    if (sitemapUrl) {
      await pingSitemap(sitemapUrl)
      result.indexRequestsSent = 1
    }
  }

  if (!dryRun && manualActions.length > 0) {
    await persistZhugeActions(supabase, {
      clientId: config.clientId,
      discoveryId: `seo_meta_cycle:${weekKey}:prescribed`,
      diagnosticRunId: null,
      output: { top_actions: manualActions, generated_at: new Date().toISOString(), cost_usd: 0, input_tokens: 0, output_tokens: 0 },
    }).catch(() => undefined)
  }

  return result
}
