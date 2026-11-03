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
import { identityFromSlug, identityFromUrl, matchProtected, mergeIdentities } from '@/lib/seo/protected-pages'
import { readPageMetrics } from '@/lib/seo/post-publish-monitor-store'
import { persistZhugeActions } from '@/lib/zhuge/action-persister'
import type { PriorityAction, ZhugeOutput } from '@/lib/zhuge/types'
import { checkFactPreservation } from './fact-check'
import { checkHardFactsPreserved, listHardFacts } from './hard-fact-check'
import { checkTitleOnTopic, GATE_REASON, resolveGscSiteUrl, runGateForCandidate } from './gate'
import { fromGscPages, mergeCandidates, type RawGscPage } from './candidates'
import { classifyMetaChangeOutcome } from './outcome-classifier'
import { fetchTargetRank, type FetchTargetRankFn } from './rank-check'
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

export interface Step1Options {
  /**
   * The T+14 page-CTR before/after check is OFF by default (2026-10-04). A placebo
   * over a window with no title changes called 41% of eligible CTS pages
   * "improved"/"regressed" — every `regressed` here would send a human to revert a
   * change on noise — and it writes `checked_at`, which permanently removes the row
   * from the re-check queue. Effect verification now runs through the target-keyword
   * rank sampler (rank-verdict.ts). Pass true only to re-run the legacy check on purpose.
   */
  legacyCtrCheck?: boolean
}

export async function runStep1CheckDue(
  supabase: SupabaseClient,
  adapter: ApplyAdapter,
  config: MetaCycleClientConfig,
  weekKey: string,
  dryRun: boolean,
  now: Date = new Date(),
  options: Step1Options = {},
): Promise<Step1Result> {
  const result: Step1Result = { checked: 0, improved: 0, flat: 0, insufficientData: 0, regressed: 0, routedToManual: 0 }
  if (!options.legacyCtrCheck) return result

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

/**
 * PM 2026-09-20 (post-revert reselect-loop follow-up, CTS total-project-manager
 * window): a reverted row must NOT count toward the full `cooldownDays` window
 * (it never stood — that's the whole point of `reverted_at`, see the
 * `seo_meta_cycle_reverted_marker` migration), but excluding it forever meant
 * the exact same already-known-bad slug got re-picked as a candidate the SAME
 * day it was reverted, burning a `maxPagesPerRun` slot and a DataForSEO lookup
 * on a page the live gates were just going to reject again anyway. A short
 * cooldown after the revert breaks that loop without reinstating the full
 * 30-day lockout. 7 days == one weekly cron cycle (roster.ts's
 * MIN_HOURS_BETWEEN_CYCLES ≈ 6.5 days), so a reverted slug skips exactly the
 * next run, not the one after.
 */
export const POST_REVERT_COOLDOWN_DAYS = 7

interface CooldownLogRow {
  page_slug: string
  reverted_at: string | null
  optimised_at: string
}

export async function runStep2CandidatesReady(
  supabase: SupabaseClient,
  config: MetaCycleClientConfig,
): Promise<Step2Result> {
  const now = Date.now()
  const cooldownCutoff = new Date(now - config.cooldownDays * 86_400_000).toISOString()
  const revertCooldownCutoff = new Date(now - POST_REVERT_COOLDOWN_DAYS * 86_400_000).toISOString()

  const [{ data: recentRows }, { data: gscRow }] = await Promise.all([
    supabase
      .from('seo_meta_log')
      .select('page_slug, reverted_at, optimised_at')
      .eq('client_id', config.clientId)
      .or(`optimised_at.gte.${cooldownCutoff},reverted_at.gte.${revertCooldownCutoff}`),
    supabase.from('gsc_performance_snapshots').select('top_pages').eq('client_id', config.clientId).order('period_end', { ascending: false }).limit(1).maybeSingle(),
  ])

  // A reverted row is judged ONLY by the short post-revert cooldown, never
  // the standing one, even if its original optimised_at is still within
  // cooldownDays — that's the "don't count it as a standing change" half of
  // the fix. A never-reverted row keeps the full cooldownDays behaviour.
  const cooldownSlugs = new Set(
    ((recentRows ?? []) as CooldownLogRow[])
      .filter((r) => (r.reverted_at ? r.reverted_at >= revertCooldownCutoff : r.optimised_at >= cooldownCutoff))
      .map((r) => r.page_slug),
  )
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
  adapter: ApplyAdapter,
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

    // PM 2026-09-23 (incident follow-up): checked FIRST, before even
    // canEditSlug — a protected conversion page (e.g. CTS's /china-tours)
    // must never be auto-edited, no matter what the rest of the gate or the
    // fact-check would otherwise allow. Zero cost: no network call.
    const identityParts = [
      ...(candidate.pageUrl ? [identityFromUrl(candidate.pageUrl)] : []),
      ...(candidate.slug ? [identityFromSlug(candidate.slug)] : []),
    ]
    const hasIdentity = identityParts.length > 0
    const identity = mergeIdentities(...identityParts)
    if (!hasIdentity || identity.unresolved !== null || matchProtected(config.protectedSlugs, identity)) {
      failures.push({
        candidate,
        reason: GATE_REASON.PROTECTED_PAGE,
        detail: hasIdentity && identity.unresolved === null
          ? `page "${candidate.slug ?? candidate.pageUrl}" is on this client's protected-page list — meta-cycle never touches it automatically, regardless of gate/fact-check outcome`
          : `page identity could not be resolved (${identity.unresolved ?? 'no_slug_or_url'}) — fail-closed, treated as protected`,
      })
      continue
    }

    // PM 2026-09-20 (data-completeness follow-up): check this FIRST, before
    // any GSC/DataForSEO/SERP spend — a page with no matching editable data
    // file (e.g. forbidden-city-travel-guide) used to only be discovered in
    // step 4's apply() call, after the entire gate had already run on it.
    const editable = await adapter.canEditSlug(candidate.slug)
    if (!editable) {
      failures.push({ candidate, reason: GATE_REASON.SLUG_NOT_EDITABLE, detail: `slug "${candidate.slug}" not found in any editable data file — skipped before any DataForSEO/GSC spend` })
      continue
    }

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
  keywordDataSource: MetaCycleGateEvidence['keywordDataSource']
  keywordDataLocation: number | null
  keywordDataNote: string
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
  /** Target-keyword rank recorded just before the change was applied (rank verification baseline). */
  baselineRankStatus?: string
  baselineRankGroup?: number | null
}

export interface Step4Result {
  proposals: MetaCycleProposal[]
  applied: Array<{ slug: string; prUrl?: string }>
  routedManual: number
}

const AI_META_MAX_TITLE = 60
const AI_META_MAX_DESC = 155

export type GenerateMetaFn = (input: MetaGenerationInput) => Promise<{ title: string; desc: string }>

/**
 * 2026-10-28: every CTS proposal had been blocked since 09-28 because the
 * generator ran before the current text was read, so it wrote generic copy
 * that dropped the page's concrete facts. Now the generator sees the current
 * text + the facts the hard check requires, and gets exactly ONE retry with
 * the hard check's reason as feedback. Never loops; downstream checks still
 * decide.
 */
async function generateWithFactRetry(
  generateMeta: GenerateMetaFn,
  baseInput: MetaGenerationInput,
  oldTitle: string,
  oldDesc: string,
  brandTerms: string[],
): Promise<{ title: string; desc: string }> {
  const factOptions = { ignoreTerms: brandTerms }
  const factsToKeep = listHardFacts(oldTitle, oldDesc, factOptions)
  const first = await generateMeta({ ...baseInput, currentTitle: oldTitle, currentDesc: oldDesc, factsToKeep })
  const firstTitle = first.title.slice(0, AI_META_MAX_TITLE)
  const firstDesc = first.desc.slice(0, AI_META_MAX_DESC)
  const firstCheck = checkHardFactsPreserved(oldTitle, oldDesc, firstTitle, firstDesc, factOptions)
  if (firstCheck.consistent) return { title: firstTitle, desc: firstDesc }

  const retry = await generateMeta({
    ...baseInput,
    currentTitle: oldTitle,
    currentDesc: oldDesc,
    factsToKeep,
    retryFeedback: firstCheck.reason,
  })
  return { title: retry.title.slice(0, AI_META_MAX_TITLE), desc: retry.desc.slice(0, AI_META_MAX_DESC) }
}

/** The "preview failed / slug not editable" proposal record — shared by both preview calls. */
function previewFailedProposal(
  candidate: MetaCycleCandidate,
  evidence: MetaCycleGateEvidence,
  newTitle: string,
  newDesc: string,
  skipReason: string,
): MetaCycleProposal {
  return {
    slug: candidate.slug ?? '', pageUrl: candidate.pageUrl ?? '', keyword: evidence.keyword,
    searchVolume: evidence.searchVolume, keywordDifficulty: evidence.keywordDifficulty, snapshotDate: evidence.snapshotDate,
    keywordDataSource: evidence.keywordDataSource, keywordDataLocation: evidence.keywordDataLocation, keywordDataNote: evidence.keywordDataNote,
    competitorTitles: evidence.competitorTitles, ctsRankingUrl: evidence.ctsRankingUrl, chosenReason: evidence.chosenReason,
    oldTitle: '', oldDesc: '', newTitle, newDesc,
    factCheckConsistent: false, factCheckReason: 'not checked — preview failed first', applied: false, skipReason,
  }
}

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
  fetchRank: FetchTargetRankFn,
): Promise<{ proposal: MetaCycleProposal | null; manualAction: PriorityAction | null }> {
  if (!candidate.pageUrl || !candidate.slug) return { proposal: null, manualAction: null }

  const evidenceMeta = { page_slug: candidate.slug, page_url: candidate.pageUrl, keyword: evidence.keyword }

  // 2026-10-28: read the page's CURRENT text BEFORE generating. The generator
  // used to run first and never saw it, so it wrote generic copy that dropped
  // the page's concrete facts and the hard check blocked every proposal.
  let current: ApplyAdapterResult
  try {
    current = await adapter.apply({ candidate, newTitle: '', newDesc: '', weekKey, dryRun: true, evidence })
  } catch (err) {
    return { proposal: null, manualAction: buildManualAction(`meta_cycle:${weekKey}:${candidate.slug}`, evidenceMeta, `预览 /${candidate.slug} 的改动失败（${err instanceof Error ? err.message : String(err)}）。`, '需要人工处理', undefined) }
  }
  if (current.skipReason && current.skipReason !== 'dry_run') {
    // slug not found in the repo's data files etc — record it, don't silently drop (PM finding #6).
    return { proposal: previewFailedProposal(candidate, evidence, '', '', current.skipReason), manualAction: null }
  }

  const meta = await generateWithFactRetry(generateMeta, {
    keyword: evidence.keyword,
    pageUrl: candidate.pageUrl,
    searchVolume: evidence.searchVolume,
    keywordDifficulty: evidence.keywordDifficulty,
    position: candidate.position,
    ctr: candidate.ctr,
    brandVoice: config.brandVoice,
    competitorTitles: evidence.competitorTitles,
  }, current.oldTitle, current.oldDesc, config.brandTerms ?? [])
  const newTitle = meta.title.slice(0, AI_META_MAX_TITLE)
  const newDesc = meta.desc.slice(0, AI_META_MAX_DESC)

  if (!newDesc) {
    return {
      proposal: null,
      manualAction: buildManualAction(`meta_cycle:${weekKey}:${candidate.slug}`, evidenceMeta, `AI 生成 /${candidate.slug} 的新标题/描述失败。`, `需要人工补一个（关键词：${evidence.keyword}）`, undefined),
    }
  }

  // Preview (dryRun:true) again with the generated copy — need old content
  // BEFORE deciding whether the fact-check even allows writing anything (PM:
  // "写之前...生成后再做一次核对...矛盾→跳过", never write first and check after).
  let preview: ApplyAdapterResult
  try {
    preview = await adapter.apply({ candidate, newTitle, newDesc, weekKey, dryRun: true, evidence })
  } catch (err) {
    return { proposal: null, manualAction: buildManualAction(`meta_cycle:${weekKey}:${candidate.slug}`, evidenceMeta, `预览 /${candidate.slug} 的改动失败（${err instanceof Error ? err.message : String(err)}）。`, '需要人工处理', undefined) }
  }
  if (preview.skipReason && preview.skipReason !== 'dry_run') {
    // slug not found in the repo's data files etc — record it, don't silently drop (PM finding #6).
    return { proposal: previewFailedProposal(candidate, evidence, newTitle, newDesc, preview.skipReason), manualAction: null }
  }

  // 2026-09-28 incident follow-up: checked BEFORE the hard fact-check —
  // neither that check nor the AI judge verify the new copy is even about
  // the same page (chongqing-night-city-lights got a title about "The
  // Forbidden City", which drops/adds no price/date/place-name the hard
  // check watches for). Zero cost, no network call.
  const topicCheck = checkTitleOnTopic(candidate.slug, newTitle, newDesc)
  if (!topicCheck.onTopic) {
    return {
      proposal: { slug: candidate.slug, pageUrl: candidate.pageUrl, keyword: evidence.keyword, searchVolume: evidence.searchVolume, keywordDifficulty: evidence.keywordDifficulty, snapshotDate: evidence.snapshotDate, keywordDataSource: evidence.keywordDataSource, keywordDataLocation: evidence.keywordDataLocation, keywordDataNote: evidence.keywordDataNote, competitorTitles: evidence.competitorTitles, ctsRankingUrl: evidence.ctsRankingUrl, chosenReason: evidence.chosenReason, oldTitle: preview.oldTitle, oldDesc: preview.oldDesc, newTitle, newDesc, factCheckConsistent: false, factCheckReason: topicCheck.reason, applied: false, skipReason: 'generated_title_off_topic' },
      manualAction: buildManualAction(`meta_cycle:${weekKey}:${candidate.slug}`, evidenceMeta, `/${candidate.slug} 的新标题/描述跟本页主题不沾边：${topicCheck.reason}`, '需要人工重写', undefined),
    }
  }

  // PM 2026-09-23 incident follow-up: the hard, non-AI rule runs FIRST and
  // is a hard block on its own — if it fails, the AI judge (Jev) is never
  // even called, both to save the call and because a dropped price/date/
  // place-name is unambiguous, unlike "does this contradict" which needs
  // judgment. Only a candidate that clears the hard rule reaches the AI
  // judge, which still runs so it stays what it was — the primary defence
  // against semantic reversals (visa-free -> visa-required) the regex can't
  // see. Both are fail-closed; the caller doesn't need to know which one
  // blocked.
  const hardCheck = checkHardFactsPreserved(preview.oldTitle, preview.oldDesc, newTitle, newDesc, { ignoreTerms: config.brandTerms ?? [] })
  const factCheck = hardCheck.consistent
    ? await checkFactPreservation(preview.oldTitle, preview.oldDesc, newTitle, newDesc)
    : { consistent: false, reason: hardCheck.reason }
  const base: MetaCycleProposal = {
    slug: candidate.slug, pageUrl: candidate.pageUrl, keyword: evidence.keyword,
    searchVolume: evidence.searchVolume, keywordDifficulty: evidence.keywordDifficulty, snapshotDate: evidence.snapshotDate,
    keywordDataSource: evidence.keywordDataSource, keywordDataLocation: evidence.keywordDataLocation, keywordDataNote: evidence.keywordDataNote,
    competitorTitles: evidence.competitorTitles, ctsRankingUrl: evidence.ctsRankingUrl, chosenReason: evidence.chosenReason,
    oldTitle: preview.oldTitle, oldDesc: preview.oldDesc, newTitle, newDesc,
    factCheckConsistent: factCheck.consistent, factCheckReason: factCheck.reason, applied: false,
  }

  if (!factCheck.consistent) {
    return {
      proposal: { ...base, skipReason: 'fact_contradiction_detected' },
      manualAction: buildManualAction(`meta_cycle:${weekKey}:${candidate.slug}`, evidenceMeta, `/${candidate.slug} 的新文案跟原文事实有出入，没有通过：${factCheck.reason}`, '需要人工重写', undefined),
    }
  }

  if (dryRun) return { proposal: base, manualAction: null }

  // Rank baseline: a live SERP read taken immediately BEFORE the change goes live. Never
  // reuse the gate's earlier SERP result (different depth, minutes older), and never block
  // the change on it — a failed read is recorded as fetch_failed and the row is later
  // reported as not_measured:no_baseline instead of being silently unverifiable.
  const baselineRank = await fetchRank({
    keyword: evidence.keyword,
    countryCode: config.semrushDb === 'nz' ? 'nz' : 'au',
    domain: config.domain,
    targetUrl: candidate.pageUrl,
  })

  let applyResult: ApplyAdapterResult
  try {
    applyResult = await adapter.apply({ candidate, newTitle, newDesc, weekKey, dryRun: false, evidence })
  } catch (err) {
    return { proposal: { ...base, skipReason: 'apply_threw' }, manualAction: buildManualAction(`meta_cycle:${weekKey}:${candidate.slug}`, evidenceMeta, `自动改 /${candidate.slug} 的标题失败（${err instanceof Error ? err.message : String(err)}）。`, '需要人工处理', undefined) }
  }

  if (applyResult.applied) {
    const { error: logError } = await supabase.from('seo_meta_log').insert({
      client_id: config.clientId, content_type: 'meta', page_slug: candidate.slug, page_url: candidate.pageUrl,
      keyword: evidence.keyword, old_title: applyResult.oldTitle, old_desc: applyResult.oldDesc,
      new_title: applyResult.newTitle, new_desc: applyResult.newDesc, wp_updated: false, applied_channel: adapter.channel,
      optimised_at: new Date().toISOString(), baseline_ctr: candidate.ctr, baseline_position: candidate.position,
      baseline_impressions: candidate.impressions, pr_url: applyResult.prUrl ?? null,
      baseline_rank_group: baselineRank.rankGroup, baseline_rank_status: baselineRank.status,
      baseline_serp_depth: baselineRank.depth, baseline_serp_fetched_at: baselineRank.fetchedAt,
    })
    const rankFields = { baselineRankStatus: baselineRank.status, baselineRankGroup: baselineRank.rankGroup }
    if (logError) {
      // The change is already live. Without this row the cooldown, the revert pointer and the rank
      // verification all silently lose it — so say so loudly instead of reporting a clean apply.
      return {
        proposal: { ...base, ...rankFields, applied: true, prUrl: applyResult.prUrl, skipReason: 'applied_but_log_insert_failed' },
        manualAction: buildManualAction(`meta_cycle:${weekKey}:${candidate.slug}`, evidenceMeta, `/${candidate.slug} 的标题已经改上线了，但没能记进改动台账（${logError.message}），所以冷却期和效果验证都看不到这次改动。`, '需要开发补记这一行', applyResult.prUrl),
      }
    }
    return { proposal: { ...base, ...rankFields, applied: true, prUrl: applyResult.prUrl }, manualAction: null }
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
  fetchRank: FetchTargetRankFn = fetchTargetRank,
): Promise<Step4Result> {
  const result: Step4Result = { proposals: [], applied: [], routedManual: 0 }
  const manualActions: PriorityAction[] = []

  for (const { candidate, evidence } of passed) {
    const outcome = await applyOnePrescription(supabase, adapter, config, weekKey, candidate, evidence, generateMeta, dryRun, fetchRank)
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
  const { passed, failures } = await runStep3Gate(supabase, adapter, config, candidates)
  const step4 = await runStep4Applied(supabase, adapter, config, weekKey, passed, generateMeta, true)

  return { checkDue, candidateCount: candidates.length, gateFailures: failures, proposals: step4.proposals }
}

export { GATE_REASON }
