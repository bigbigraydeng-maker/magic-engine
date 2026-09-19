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
 *
 * PM 2026-09-20（incident follow-up, after W38's first real run auto-merged
 * two factually wrong changes）: step 3 is no longer a pure scoring function
 * — it runs the full information-completeness gate (gate.ts) per candidate,
 * which needs live GSC/DataForSEO calls. Every candidate that makes it to
 * step 4 gets an entry in Step4Result.proposals regardless of outcome — no
 * silent drops (that was root cause #4 of the incident).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { readPageMetrics } from '@/lib/seo/post-publish-monitor-store'
import { persistZhugeActions } from '@/lib/zhuge/action-persister'
import type { PriorityAction, ZhugeOutput } from '@/lib/zhuge/types'
import { checkFactPreservation } from './fact-check'
import { GATE_REASON, resolveGscSiteUrl, runGateForCandidate } from './gate'
import { fromGscPages, mergeCandidates, type RawGscPage } from './candidates'
import { classifyMetaChangeOutcome } from './outcome-classifier'
import type { MetaGenerationInput } from './ai-meta'
import type {
  ApplyAdapter,
  ApplyAdapterResult,
  MetaCycleCandidate,
  MetaCycleClientConfig,
  MetaCycleGateEvidence,
  MetaCycleGateFailure,
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
    .is('reverted_at', null)
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

// ── Step 2: candidates_ready (discover) ────────────────────────────────────────

export interface Step2Result {
  candidates: MetaCycleCandidate[]
}

export async function runStep2CandidatesReady(
  supabase: SupabaseClient,
  config: MetaCycleClientConfig,
): Promise<Step2Result> {
  const cooldownCutoff = new Date(Date.now() - config.cooldownDays * 86_400_000).toISOString()

  const [{ data: recentRows }, { data: gscRow }] = await Promise.all([
    supabase.from('seo_meta_log').select('page_slug').eq('client_id', config.clientId).is('reverted_at', null).gte('optimised_at', cooldownCutoff),
    supabase.from('gsc_performance_snapshots').select('top_pages').eq('client_id', config.clientId).order('period_end', { ascending: false }).limit(1).maybeSingle(),
  ])

  const cooldownSlugs = new Set(((recentRows ?? []) as Array<{ page_slug: string }>).map((r) => r.page_slug))
  const gscSnapshot = gscRow as { top_pages?: RawGscPage[] } | null

  const merged = mergeCandidates(
    fromGscPages(gscSnapshot?.top_pages ?? []),
    cooldownSlugs,
    config.maxPagesPerRun * 3, // wide pool the gate (step 3) works through — same rationale as cts-meta-pr.ts's pickCandidates(..., 12)
  )

  return { candidates: merged }
}

// ── Step 3: gated (information-completeness gate, PM 2026-09-20 incident follow-up) ──

export interface Step3Result {
  passed: Array<{ candidate: MetaCycleCandidate; evidence: MetaCycleGateEvidence }>
  failures: MetaCycleGateFailure[]
}

export async function runStep3Gate(
  supabase: SupabaseClient,
  config: MetaCycleClientConfig,
  candidates: MetaCycleCandidate[],
): Promise<Step3Result> {
  const siteUrl = await resolveGscSiteUrl(supabase, config.clientId)
  if (!siteUrl) {
    return {
      passed: [],
      failures: candidates.map((candidate) => ({ candidate, reason: 'no_gsc_connector', detail: 'client has no GSC connector configured (client_connectors anchor=gsc) — cannot verify page-scoped queries' })),
    }
  }

  const passed: Step3Result['passed'] = []
  const failures: MetaCycleGateFailure[] = []
  for (const candidate of candidates) {
    if (passed.length >= config.maxPagesPerRun) break // enough good candidates found — stop spending on SERP/GSC calls for the rest of the wide pool
    const result = await runGateForCandidate(supabase, config, candidate, siteUrl)
    if ('evidence' in result) passed.push({ candidate: result.candidate, evidence: result.evidence })
    else failures.push(result)
  }
  return { passed, failures }
}

// ── Step 4: applied (generate, fact-check, apply — every attempt gets a proposal record) ──

export interface MetaCycleProposal {
  slug: string
  pageUrl: string
  keyword: string
  searchVolume: number
  keywordDifficulty: number
  snapshotDate: string
  competitorTitles: string[]
  ctsRankingUrl: string | null
  chosenReason: string
  oldTitle: string
  oldDesc: string
  newTitle: string
  newDesc: string
  factCheckConsistent: boolean
  factCheckReason: string
  applied: boolean
  prUrl?: string
  skipReason?: string
}

export interface Step4Result {
  proposals: MetaCycleProposal[]
  applied: Array<{ slug: string; prUrl?: string }>
  routedManual: number
}

const AI_META_MAX_TITLE = 60
const AI_META_MAX_DESC = 155

export type GenerateMetaFn = (input: MetaGenerationInput) => Promise<{ title: string; desc: string }>

/** One candidate's worth of step-4 work — kept separate from runStep4Applied for the 50-line budget. */
async function applyOnePrescription(
  supabase: SupabaseClient,
  adapter: ApplyAdapter,
  config: MetaCycleClientConfig,
  weekKey: string,
  candidate: MetaCycleCandidate,
  evidence: MetaCycleGateEvidence,
  generateMeta: GenerateMetaFn,
  dryRun: boolean,
): Promise<{ proposal: MetaCycleProposal | null; manualAction: PriorityAction | null }> {
  if (!candidate.pageUrl || !candidate.slug) return { proposal: null, manualAction: null }

  const meta = await generateMeta({
    keyword: evidence.keyword,
    pageUrl: candidate.pageUrl,
    searchVolume: evidence.searchVolume,
    keywordDifficulty: evidence.keywordDifficulty,
    position: candidate.position,
    ctr: candidate.ctr,
    brandVoice: config.brandVoice,
    competitorTitles: evidence.competitorTitles,
  })
  const newTitle = meta.title.slice(0, AI_META_MAX_TITLE)
  const newDesc = meta.desc.slice(0, AI_META_MAX_DESC)
  const evidenceMeta = { page_slug: candidate.slug, page_url: candidate.pageUrl, keyword: evidence.keyword }

  if (!newDesc) {
    return {
      proposal: null,
      manualAction: buildManualAction(`meta_cycle:${weekKey}:${candidate.slug}`, evidenceMeta, `AI 生成 /${candidate.slug} 的新标题/描述失败。`, `需要人工补一个（关键词：${evidence.keyword}）`, undefined),
    }
  }

  // Preview (dryRun:true) first — need old content BEFORE deciding whether
  // the fact-check even allows writing anything (PM: "写之前...生成后再做
  // 一次核对...矛盾→跳过", never write first and check after).
  let preview: ApplyAdapterResult
  try {
    preview = await adapter.apply({ candidate, newTitle, newDesc, weekKey, dryRun: true, evidence })
  } catch (err) {
    return { proposal: null, manualAction: buildManualAction(`meta_cycle:${weekKey}:${candidate.slug}`, evidenceMeta, `预览 /${candidate.slug} 的改动失败（${err instanceof Error ? err.message : String(err)}）。`, '需要人工处理', undefined) }
  }
  if (preview.skipReason && preview.skipReason !== 'dry_run') {
    // slug not found in the repo's data files etc — record it, don't silently drop (PM finding #6).
    return {
      proposal: { slug: candidate.slug, pageUrl: candidate.pageUrl, keyword: evidence.keyword, searchVolume: evidence.searchVolume, keywordDifficulty: evidence.keywordDifficulty, snapshotDate: evidence.snapshotDate, competitorTitles: evidence.competitorTitles, ctsRankingUrl: evidence.ctsRankingUrl, chosenReason: evidence.chosenReason, oldTitle: '', oldDesc: '', newTitle, newDesc, factCheckConsistent: false, factCheckReason: 'not checked — preview failed first', applied: false, skipReason: preview.skipReason },
      manualAction: null,
    }
  }

  const factCheck = await checkFactPreservation(preview.oldTitle, preview.oldDesc, newTitle, newDesc)
  const base: MetaCycleProposal = {
    slug: candidate.slug, pageUrl: candidate.pageUrl, keyword: evidence.keyword,
    searchVolume: evidence.searchVolume, keywordDifficulty: evidence.keywordDifficulty, snapshotDate: evidence.snapshotDate,
    competitorTitles: evidence.competitorTitles, ctsRankingUrl: evidence.ctsRankingUrl, chosenReason: evidence.chosenReason,
    oldTitle: preview.oldTitle, oldDesc: preview.oldDesc, newTitle, newDesc,
    factCheckConsistent: factCheck.consistent, factCheckReason: factCheck.reason, applied: false,
  }

  if (!factCheck.consistent) {
    return {
      proposal: { ...base, skipReason: 'fact_contradiction_detected' },
      manualAction: buildManualAction(`meta_cycle:${weekKey}:${candidate.slug}`, evidenceMeta, `AI 判官认为 /${candidate.slug} 的新文案跟原文事实矛盾：${factCheck.reason}`, '需要人工重写', undefined),
    }
  }

  if (dryRun) return { proposal: base, manualAction: null }

  let applyResult: ApplyAdapterResult
  try {
    applyResult = await adapter.apply({ candidate, newTitle, newDesc, weekKey, dryRun: false, evidence })
  } catch (err) {
    return { proposal: { ...base, skipReason: 'apply_threw' }, manualAction: buildManualAction(`meta_cycle:${weekKey}:${candidate.slug}`, evidenceMeta, `自动改 /${candidate.slug} 的标题失败（${err instanceof Error ? err.message : String(err)}）。`, '需要人工处理', undefined) }
  }

  if (applyResult.applied) {
    await supabase.from('seo_meta_log').insert({
      client_id: config.clientId, content_type: 'meta', page_slug: candidate.slug, page_url: candidate.pageUrl,
      keyword: evidence.keyword, old_title: applyResult.oldTitle, old_desc: applyResult.oldDesc,
      new_title: applyResult.newTitle, new_desc: applyResult.newDesc, wp_updated: false, applied_channel: adapter.channel,
      optimised_at: new Date().toISOString(), baseline_ctr: candidate.ctr, baseline_position: candidate.position,
      baseline_impressions: candidate.impressions, pr_url: applyResult.prUrl ?? null,
    })
    return { proposal: { ...base, applied: true, prUrl: applyResult.prUrl }, manualAction: null }
  }

  if (applyResult.skipReason === 'pr_opened_but_not_merged') {
    return {
      proposal: { ...base, skipReason: 'pr_opened_but_not_merged', prUrl: applyResult.prUrl },
      manualAction: buildManualAction(`meta_cycle:${weekKey}:${candidate.slug}`, evidenceMeta, `/${candidate.slug} 的标题改动 PR 已经开了但没合并成功。`, '需要人工去合并', applyResult.prUrl),
    }
  }
  return { proposal: { ...base, skipReason: applyResult.skipReason ?? 'unknown' }, manualAction: null }
}

export async function runStep4Applied(
  supabase: SupabaseClient,
  adapter: ApplyAdapter,
  config: MetaCycleClientConfig,
  weekKey: string,
  passed: Step3Result['passed'],
  generateMeta: GenerateMetaFn,
  dryRun: boolean,
): Promise<Step4Result> {
  const result: Step4Result = { proposals: [], applied: [], routedManual: 0 }
  const manualActions: PriorityAction[] = []

  for (const { candidate, evidence } of passed) {
    const outcome = await applyOnePrescription(supabase, adapter, config, weekKey, candidate, evidence, generateMeta, dryRun)
    if (outcome.proposal) {
      result.proposals.push(outcome.proposal)
      if (outcome.proposal.applied) result.applied.push({ slug: outcome.proposal.slug, prUrl: outcome.proposal.prUrl })
    }
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

// ── Dry run (PM 2026-09-20, incident follow-up): full pipeline, zero writes ──

export interface DryRunResult {
  checkDue: Step1Result
  candidateCount: number
  gateFailures: MetaCycleGateFailure[]
  proposals: MetaCycleProposal[]
}

/**
 * Runs steps 1–4 exactly like a real cycle (including the full gate and
 * fact-check) but with dryRun:true throughout — no seo_meta_log writes, no
 * PR opened/merged, no manual-board items persisted. Called directly by
 * the manual trigger route (POST /api/cron/seo-meta-cycle-trigger with
 * { dry_run: true }), NOT through Inngest — Inngest's event model is
 * fire-and-forget, so a dry run that needs to hand its results back in the
 * same HTTP response has to run inline instead.
 */
export async function runDryRunCycle(
  supabase: SupabaseClient,
  adapter: ApplyAdapter,
  config: MetaCycleClientConfig,
  weekKey: string,
  generateMeta: GenerateMetaFn,
): Promise<DryRunResult> {
  const checkDue = await runStep1CheckDue(supabase, adapter, config, weekKey, true)
  const { candidates } = await runStep2CandidatesReady(supabase, config)
  const { passed, failures } = await runStep3Gate(supabase, config, candidates)
  const step4 = await runStep4Applied(supabase, adapter, config, weekKey, passed, generateMeta, true)

  return { checkDue, candidateCount: candidates.length, gateFailures: failures, proposals: step4.proposals }
}

export { GATE_REASON }
