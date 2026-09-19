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
 *
 * PM 2026-09-20 精简拍板: auto-revert, oscillation, memory learning writes,
 * and the cross-client DataForSEO budget breaker are all cut here — real
 * usage is ≤3 pages/week for one client, and both bugs the review rounds
 * found lived in the auto-revert machinery. A regressed page now becomes
 * ONE manual kanban item pointing at the merged PR's own GitHub Revert
 * button — zero new revert code.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { readPageMetrics } from '@/lib/seo/post-publish-monitor-store'
import { persistZhugeActions } from '@/lib/zhuge/action-persister'
import type { PriorityAction, ZhugeOutput } from '@/lib/zhuge/types'
import { deriveMetaCycleAction } from './action-mapping'
import {
  fromGscPages,
  mergeCandidates,
  type RawGscPage,
  type RawGscQuery,
} from './candidates'
import { enrichWithSnapshots, fetchCompetitorTitles } from './enrichment'
import { classifyMetaChangeOutcome } from './outcome-classifier'
import type { MetaGenerationInput } from './ai-meta'
import type {
  ApplyAdapter,
  ApplyAdapterResult,
  MetaCycleCandidate,
  MetaCycleClientConfig,
  MetaCyclePrescription,
} from './types'

// ── Step 1: check_due (re-classify last cycle's changes) ──────────────────────

export const CHECK_AFTER_DAYS = 14

interface SeoMetaLogRow {
  id: string
  page_slug: string
  page_url: string
  keyword: string
  old_title: string | null
  new_title: string | null
  baseline_ctr: number | null
  baseline_position: number | null
  baseline_impressions: number | null
  pr_url: string | null
}

export interface Step1Result {
  checked: number
  improved: number
  flat: number
  insufficientData: number
  regressed: number
  routedToManual: number
}

function pct(decimalCtr: number | null): string {
  return decimalCtr === null ? '未知' : `${(decimalCtr * 100).toFixed(2)}%`
}

function buildManualAction(
  evidenceKey: string,
  meta: { page_slug: string; page_url: string; keyword: string },
  what: string,
  how: string,
  href: string | undefined,
): PriorityAction {
  return {
    rank: 1,
    dimension: 'seo',
    action_type: 'meta_cycle_manual_review',
    why_now: href ? `${what} ${how}：${href}` : `${what} ${how}`,
    evidence_refs: href ? [evidenceKey, href] : [evidenceKey],
    expected_impact: 'medium',
    effort: 'low',
    execution_mode: 'in_house',
    executable_by: null,
    metadata: { ...meta, how, href },
  }
}

/** One row's worth of step-1 work — kept separate from runStep1CheckDue for the CLAUDE.md 50-line-per-function budget. */
async function processCheckDueRow(
  supabase: SupabaseClient,
  config: MetaCycleClientConfig,
  row: SeoMetaLogRow,
  now: Date,
  dryRun: boolean,
): Promise<{ outcome: 'improved' | 'flat' | 'insufficient_data' | 'regressed'; manualAction: PriorityAction | null }> {
  const observed = await readPageMetrics(supabase, config.clientId, row.page_url).catch(() => null)
  const observedCtr = observed?.gsc.ctr ?? null
  const observedImpressions = observed?.gsc.impressions ?? null

  const classification = classifyMetaChangeOutcome(
    { ctr: row.baseline_ctr, position: row.baseline_position, impressions: row.baseline_impressions },
    { ctr: observedCtr, position: observed?.gsc.position ?? null, impressions: observedImpressions, clicks: observed?.gsc.clicks ?? null },
  )

  if (!dryRun) {
    await supabase
      .from('seo_meta_log')
      .update({ checked_at: now.toISOString(), outcome: classification.outcome, observed_ctr: observedCtr, observed_impressions: observedImpressions })
      .eq('id', row.id)
  }

  if (classification.outcome !== 'regressed') {
    return { outcome: classification.outcome, manualAction: null }
  }

  const what = `/${row.page_slug} 改动 14 天后效果变差：标题从「${row.old_title}」改成了「${row.new_title}」，点击率 ${pct(row.baseline_ctr)} → ${pct(observedCtr)}（曝光 ${observedImpressions ?? '—'} 次）。`
  const how = '打开 PR 链接，在 GitHub 上点 Revert 按钮，再合并那个 revert PR 就改回去了'
  const meta = { page_slug: row.page_slug, page_url: row.page_url, keyword: row.keyword }
  return { outcome: 'regressed', manualAction: buildManualAction(`seo_meta_log:${row.id}`, meta, what, how, row.pr_url ?? undefined) }
}

export async function runStep1CheckDue(
  supabase: SupabaseClient,
  adapter: ApplyAdapter,
  config: MetaCycleClientConfig,
  weekKey: string,
  dryRun: boolean,
  now: Date = new Date(),
): Promise<Step1Result> {
  const result: Step1Result = { checked: 0, improved: 0, flat: 0, insufficientData: 0, regressed: 0, routedToManual: 0 }

  const cutoff = new Date(now.getTime() - CHECK_AFTER_DAYS * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from('seo_meta_log')
    .select('id, page_slug, page_url, keyword, old_title, new_title, baseline_ctr, baseline_position, baseline_impressions, pr_url')
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
    const outcome = await processCheckDueRow(supabase, config, row, now, dryRun)
    if (outcome.outcome === 'improved') result.improved += 1
    else if (outcome.outcome === 'flat') result.flat += 1
    else if (outcome.outcome === 'insufficient_data') result.insufficientData += 1
    else result.regressed += 1

    if (outcome.manualAction) {
      result.routedToManual += 1
      manualActions.push(outcome.manualAction)
    }
  }

  if (!dryRun && manualActions.length > 0) {
    await persistZhugeActions(supabase, {
      clientId: config.clientId,
      discoveryId: `seo_meta_cycle:${weekKey}:check_due`,
      diagnosticRunId: null,
      output: { top_actions: manualActions, generated_at: now.toISOString(), cost_usd: 0, input_tokens: 0, output_tokens: 0 },
    }).catch(() => undefined)
  }

  return result
}

// ── Step 2: candidates_ready (discover + merge + snapshot-enrich) ─────────────

export interface Step2Result {
  candidates: MetaCycleCandidate[]
}

export async function runStep2CandidatesReady(
  supabase: SupabaseClient,
  config: MetaCycleClientConfig,
): Promise<Step2Result> {
  const cooldownCutoff = new Date(Date.now() - config.cooldownDays * 86_400_000).toISOString()

  const [{ data: recentRows }, { data: gscRow }] = await Promise.all([
    supabase.from('seo_meta_log').select('page_slug').eq('client_id', config.clientId).gte('optimised_at', cooldownCutoff),
    supabase.from('gsc_performance_snapshots').select('top_pages, top_queries').eq('client_id', config.clientId).order('period_end', { ascending: false }).limit(1).maybeSingle(),
  ])

  const cooldownSlugs = new Set(((recentRows ?? []) as Array<{ page_slug: string }>).map((r) => r.page_slug))
  const gscSnapshot = gscRow as { top_pages?: RawGscPage[]; top_queries?: RawGscQuery[] } | null

  const merged = mergeCandidates(
    fromGscPages(gscSnapshot?.top_pages ?? [], gscSnapshot?.top_queries ?? []),
    cooldownSlugs,
    config.maxPagesPerRun * 3, // wide pool before the difficulty skip filter — same rationale as cts-meta-pr.ts's pickCandidates(..., 12)
  )

  const enriched = await enrichWithSnapshots(merged, { id: config.clientId, domain: config.domain, semrush_db: config.semrushDb })
  return { candidates: enriched }
}

// ── Step 3: prescribed (score → title_rewrite vs skip, pure) ──────────────────

export interface Step3Result {
  titleRewrites: MetaCyclePrescription[]
  skipCount: number
  deferredCount: number
}

export function runStep3Prescribe(candidates: MetaCycleCandidate[], maxAutoActions: number): Step3Result {
  const prescriptions = candidates.map((c) => deriveMetaCycleAction(c))
  const skipped = prescriptions.filter((p) => p.actionType === 'skip')
  const eligible = prescriptions.filter((p) => p.actionType === 'title_rewrite')

  return {
    titleRewrites: eligible.slice(0, maxAutoActions),
    skipCount: skipped.length,
    deferredCount: Math.max(0, eligible.length - maxAutoActions),
  }
}

// ── Step 4: applied (SERP-enrich the final set, generate, apply) ──────────────

export interface Step4Result {
  applied: Array<{ slug: string; prUrl?: string }>
  routedManual: number
}

const AI_META_MAX_TITLE = 60
const AI_META_MAX_DESC = 155

export type GenerateMetaFn = (input: MetaGenerationInput) => Promise<{ title: string; desc: string }>

/** One prescription's worth of step-4 work — kept separate from runStep4Applied for the 50-line budget. */
async function applyOnePrescription(
  supabase: SupabaseClient,
  adapter: ApplyAdapter,
  config: MetaCycleClientConfig,
  weekKey: string,
  p: MetaCyclePrescription,
  competitorTitles: string[],
  generateMeta: GenerateMetaFn,
  dryRun: boolean,
): Promise<{ applied: { slug: string; prUrl?: string } | null; manualAction: PriorityAction | null }> {
  if (!p.candidate.pageUrl || !p.candidate.slug) return { applied: null, manualAction: null }

  const meta = await generateMeta({
    keyword: p.candidate.keyword,
    pageUrl: p.candidate.pageUrl,
    searchVolume: p.candidate.searchVolume,
    keywordDifficulty: p.candidate.keywordDifficulty,
    position: p.candidate.position,
    ctr: p.candidate.ctr,
    brandVoice: config.brandVoice,
    competitorTitles,
  })
  const title = meta.title.slice(0, AI_META_MAX_TITLE)
  const desc = meta.desc.slice(0, AI_META_MAX_DESC)
  const evidence = { page_slug: p.candidate.slug, page_url: p.candidate.pageUrl, keyword: p.candidate.keyword }
  if (!desc) {
    // AI generation failed (e.g. truncated/malformed JSON — cts-meta-pr.ts's
    // history, #1792, shows this really happens). Route to the manual board
    // instead of silently dropping a candidate step 3 already selected.
    return {
      applied: null,
      manualAction: buildManualAction(`meta_cycle:${weekKey}:${p.candidate.slug}`, evidence, `AI 生成 /${p.candidate.slug} 的新标题/描述失败。`, '需要人工补一个（关键词：' + p.candidate.keyword + '）', undefined),
    }
  }

  let applyResult: ApplyAdapterResult
  try {
    applyResult = await adapter.apply({ candidate: p.candidate, newTitle: title, newDesc: desc, weekKey, dryRun })
  } catch (err) {
    return {
      applied: null,
      manualAction: buildManualAction(`meta_cycle:${weekKey}:${p.candidate.slug}`, evidence, `自动改 /${p.candidate.slug} 的标题失败（${err instanceof Error ? err.message : String(err)}）。`, '需要人工处理', undefined),
    }
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
        pr_url: applyResult.prUrl ?? null,
      })
    }
    return { applied: { slug: p.candidate.slug, prUrl: applyResult.prUrl }, manualAction: null }
  }

  if (applyResult.skipReason === 'pr_opened_but_not_merged') {
    return {
      applied: null,
      manualAction: buildManualAction(`meta_cycle:${weekKey}:${p.candidate.slug}`, evidence, `/${p.candidate.slug} 的标题改动 PR 已经开了但没合并成功。`, '需要人工去合并', applyResult.prUrl),
    }
  }
  // other skip reasons (slug_not_in_file, no_slug, pr_already_exists) — nothing to route.
  return { applied: null, manualAction: null }
}

export async function runStep4Applied(
  supabase: SupabaseClient,
  adapter: ApplyAdapter,
  config: MetaCycleClientConfig,
  weekKey: string,
  titleRewrites: MetaCyclePrescription[],
  generateMeta: GenerateMetaFn,
  locationCode: number,
  dryRun: boolean,
): Promise<Step4Result> {
  const result: Step4Result = { applied: [], routedManual: 0 }
  const manualActions: PriorityAction[] = []

  // SERP-enrich ONLY the final selected set — spend is exactly bounded by
  // titleRewrites.length (≤ config.maxPagesPerRun), no cross-client breaker needed.
  const competitorTitles = await fetchCompetitorTitles(titleRewrites.map((p) => p.candidate), locationCode)

  for (const p of titleRewrites) {
    const outcome = await applyOnePrescription(supabase, adapter, config, weekKey, p, competitorTitles.get(p.candidate.keyword) ?? [], generateMeta, dryRun)
    if (outcome.applied) result.applied.push(outcome.applied)
    if (outcome.manualAction) {
      result.routedManual += 1
      manualActions.push(outcome.manualAction)
    }
  }

  if (!dryRun && manualActions.length > 0) {
    await persistZhugeActions(supabase, {
      clientId: config.clientId,
      discoveryId: `seo_meta_cycle:${weekKey}:applied`,
      diagnosticRunId: null,
      output: { top_actions: manualActions, generated_at: new Date().toISOString(), cost_usd: 0, input_tokens: 0, output_tokens: 0 },
    }).catch(() => undefined)
  }

  return result
}
