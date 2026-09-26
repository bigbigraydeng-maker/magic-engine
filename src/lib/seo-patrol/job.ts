/**
 * SEO Patrol job (Phase 22.E.S2b).
 *
 * Orchestrates the daily SEO patrol for one or all clients:
 *   1. Read keyword_snapshots (current + prior) + gsc_performance_snapshots
 *   2. Shape into SeoPatrolInput
 *   3. Run the pure rule engine → SeoPatrolFinding[]
 *   4. Persist findings to seo_patrol_findings (status='fresh')
 *   5. Convert top findings → PriorityAction[] → persistZhugeActions()
 *      which writes pending execution_items onto the SEO kanban column.
 *
 * DATA COVERAGE NOTE (MVP):
 *   R1 (low CTR), R3 (stale), R4 (opportunity) run on real data that is
 *   already collected (keyword_snapshots + GSC top_queries).
 *   R2 (missing internal link) and R5 (not indexed) need data ME does not yet
 *   collect (site-crawl link graph, GSC Index Coverage API). Their inputs are
 *   left empty here so the rules simply never fire until that collection lands
 *   (tracked as future work, see ROADMAP § Phase 22.E). The rules themselves
 *   are tested and ready.
 *
 * Reference: docs/seo-sop-implementation-design.md · ROADMAP § Phase 22.E
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { persistZhugeActions, executionItemDedupKey } from '@/lib/zhuge/action-persister'
import type { PriorityAction, ZhugeOutput } from '@/lib/zhuge/types'
import { runSeoPatrolRules } from './rules'
import { buildPageSignals } from './page-signals'
import type {
  SeoPatrolFinding,
  SeoPatrolInput,
  KeywordSignal,
} from './types'

// Max actions to surface per client per day. Iris SOP: "max 3, ranked by impact".
const MAX_ACTIONS_PER_CLIENT = 3

/** At most this many NEW patrol cards per client in any rolling 7 days (PM: 每周只出几条最值得做的). */
export const WEEKLY_CARD_CAP_PER_CLIENT = 3

/** A card a human closed (completed / skipped) holds its target back this many days. */
export const DECIDED_CARD_HOLD_DAYS = 14

/** PostgREST returns at most this many rows per request — a full page may be a partial list. */
const CARD_READ_LIMIT = 1000

// Finding type → priority rank (1 = highest). Drives the "today's 3 things" order.
const RULE_RANK: Record<SeoPatrolFinding['ruleId'], number> = {
  low_ctr_title: 1, // quick win, already ranking — highest leverage
  stale_content: 2, // protect existing traffic
  keyword_opportunity: 3, // new content, higher effort
  missing_internal_link: 4,
  not_indexed: 5,
}

const RULE_IMPACT: Record<SeoPatrolFinding['ruleId'], 'low' | 'medium' | 'high'> = {
  low_ctr_title: 'high',
  stale_content: 'high',
  keyword_opportunity: 'medium',
  missing_internal_link: 'medium',
  // 'low' was a placeholder from the data-less era; a page Google won't
  // index earns zero traffic — resubmission is cheap and unblocks it all.
  not_indexed: 'medium',
}

const RULE_EFFORT: Record<SeoPatrolFinding['ruleId'], 'low' | 'medium' | 'high'> = {
  low_ctr_title: 'low',
  stale_content: 'medium',
  keyword_opportunity: 'high',
  missing_internal_link: 'low',
  not_indexed: 'low',
}

export interface SeoPatrolClient {
  id: string
  domain: string
  semrush_db: string | null
}

export interface SeoPatrolClientResult {
  client_id: string
  domain: string
  findings_detected: number
  findings_persisted: number
  actions_created: number
  /** R2 page-signal feed health — 'missing'/'error' means R2 was off this run. */
  page_data_status?: PageDataStatus
  /** Why no card was opened today although there were findings. */
  cards_withheld_reason?: 'card_lookup_failed' | 'weekly_cap'
  /** Findings held back because their target already has a card. */
  findings_held_existing_card?: number
  error?: string
}

// ── Data loading ────────────────────────────────────────────────────────────────

interface KeywordSnapshotRow {
  keyword: string
  position: number | null
  search_volume: number | null
  keyword_difficulty: number | null
  snapshot_date: string
}

interface GscQueryRow {
  query: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

const LOCATION_CODE_BY_DB: Record<string, number> = { au: 2036, nz: 2554 }

function locationCodeFor(db: string | null): number {
  return LOCATION_CODE_BY_DB[db ?? 'au'] ?? LOCATION_CODE_BY_DB.au
}

/**
 * Build the rule input for one client from the latest two keyword snapshots
 * and the latest GSC snapshot. Pure assembly once rows are fetched.
 */
export function assembleSeoPatrolInput(
  clientId: string,
  currentKeywords: KeywordSnapshotRow[],
  priorKeywords: KeywordSnapshotRow[],
  gscQueries: GscQueryRow[],
): SeoPatrolInput {
  const priorByKeyword = new Map<string, number | null>()
  for (const row of priorKeywords) priorByKeyword.set(row.keyword, row.position)

  const ctrByQuery = new Map<string, number>()
  for (const q of gscQueries) ctrByQuery.set(q.query.toLowerCase(), q.ctr)

  const keywords: KeywordSignal[] = currentKeywords.map((row) => {
    const ranked = row.position !== null && row.position > 0
    return {
      keyword: row.keyword,
      position: row.position,
      priorPosition: priorByKeyword.get(row.keyword) ?? null,
      searchVolume: row.search_volume,
      keywordDifficulty: row.keyword_difficulty,
      gscCtr: ctrByQuery.get(row.keyword.toLowerCase()) ?? null,
      // "covered" = client already ranks somewhere for it (position present).
      covered: ranked,
    }
  })

  // Page signals are attached by loadSeoPatrolInput (buildPageSignals, S15) —
  // this pure assembler only shapes the keyword side.
  return { clientId, keywords, pages: [] }
}

/** Health of the R2 page-signal feed for one client (surfaced in cron summary). */
export type PageDataStatus = 'ok' | 'missing' | 'error'

async function loadSeoPatrolInput(
  supabase: SupabaseClient,
  client: SeoPatrolClient,
): Promise<{ input: SeoPatrolInput; pageDataStatus: PageDataStatus }> {
  const locationCode = locationCodeFor(client.semrush_db)

  // Latest snapshot date, then the newest date strictly before it. Two point
  // queries instead of scanning N rows: a row-limit scan breaks once a single
  // snapshot exceeds the limit (Oztop: 124 rows/snapshot ate a 60-row window,
  // so priorDate was always null and R3 could never fire).
  const { data: currentRow } = await supabase
    .from('keyword_snapshots')
    .select('snapshot_date')
    .eq('client_id', client.id)
    .eq('location_code', locationCode)
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  const currentDate = (currentRow as { snapshot_date: string } | null)?.snapshot_date ?? null

  let priorDate: string | null = null
  if (currentDate) {
    const { data: priorRow } = await supabase
      .from('keyword_snapshots')
      .select('snapshot_date')
      .eq('client_id', client.id)
      .eq('location_code', locationCode)
      .lt('snapshot_date', currentDate)
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .maybeSingle()
    priorDate = (priorRow as { snapshot_date: string } | null)?.snapshot_date ?? null
  }

  const currentKeywords = currentDate
    ? await fetchKeywordRows(supabase, client.id, locationCode, currentDate)
    : []
  const priorKeywords = priorDate
    ? await fetchKeywordRows(supabase, client.id, locationCode, priorDate)
    : []

  // Latest GSC snapshot for CTR enrichment (R1).
  const { data: gsc } = await supabase
    .from('gsc_performance_snapshots')
    .select('top_queries, period_end')
    .eq('client_id', client.id)
    .order('period_end', { ascending: false })
    .limit(1)
    .maybeSingle()

  const gscQueries = ((gsc as { top_queries?: GscQueryRow[] } | null)?.top_queries ?? [])

  const input = assembleSeoPatrolInput(client.id, currentKeywords, priorKeywords, gscQueries)

  // 22.E.S15: page signals (crawl link graph × GSC top_pages) feed R2.
  // A signals failure degrades to keyword-only patrol, never breaks it —
  // but the degradation is REPORTED via page_data_status, not swallowed
  // (a silent pages:[] is exactly how R2 stayed dead for months).
  let pageDataStatus: PageDataStatus = 'error'
  try {
    const { pages, meta } = await buildPageSignals(client.id, client.domain, supabase)
    input.pages = pages
    pageDataStatus = meta.crawl_data_missing ? 'missing' : 'ok'
  } catch (err) {
    console.warn(
      `[seo-patrol] page signals failed for ${client.domain} (R2 off this run):`,
      err instanceof Error ? err.message : String(err),
    )
  }

  return { input, pageDataStatus }
}

async function fetchKeywordRows(
  supabase: SupabaseClient,
  clientId: string,
  locationCode: number,
  snapshotDate: string,
): Promise<KeywordSnapshotRow[]> {
  const { data } = await supabase
    .from('keyword_snapshots')
    .select('keyword, position, search_volume, keyword_difficulty, snapshot_date')
    .eq('client_id', clientId)
    .eq('location_code', locationCode)
    .eq('snapshot_date', snapshotDate)
    .limit(200)
  return (data ?? []) as KeywordSnapshotRow[]
}

// ── Finding → action conversion ──────────────────────────────────────────────────

/**
 * Convert findings into a ranked, de-duplicated PriorityAction[] capped at
 * MAX_ACTIONS_PER_CLIENT. One action per (rule, subject) — the finding's
 * description becomes why_now so the kanban card explains itself.
 *
 * NOTE: rank here is the *priority order* (1..N). persistZhugeActions writes
 * it to execution_items.sort_order so the card surfaces in the right slot.
 */
export function findingsToActions(
  findings: SeoPatrolFinding[],
  opts: { blockedKeys?: ReadonlySet<string>; limit?: number } = {},
): PriorityAction[] {
  const sorted = [...findings].sort(
    (a, b) => RULE_RANK[a.ruleId] - RULE_RANK[b.ruleId],
  )
  // One action per (rule, subject): duplicate findings for the same keyword
  // (e.g. duplicate snapshot rows) must not become duplicate kanban cards.
  const seen = new Set<string>()
  const deduped = sorted.filter((f) => {
    const key = `${f.ruleId}::${(f.keyword ?? f.url ?? 'site').toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  // Drop targets that already have a card (see buildCardSuppression) and keep one card
  // per card key — the key the persister de-duplicates on — so the daily slots are spent
  // on targets that are new. This runs BEFORE the daily cut on purpose.
  const cardKeys = new Set<string>()
  const fresh = deduped.filter((f) => {
    const key = executionItemDedupKey(f.suggestedActionType, f.keyword, f.url)
    if (opts.blockedKeys?.has(key)) return false
    if (cardKeys.has(key)) return false
    cardKeys.add(key)
    return true
  })
  const limit = Math.max(0, Math.min(MAX_ACTIONS_PER_CLIENT, opts.limit ?? MAX_ACTIONS_PER_CLIENT))
  const top = fresh.slice(0, limit)

  return top.map((f, idx) => {
    const subject = f.keyword ?? f.url ?? 'site'
    return {
      rank: idx + 1,
      dimension: 'seo',
      action_type: f.suggestedActionType,
      why_now: f.description,
      // Pre-fill payload for the Content Workbench (and any UI that opens this
      // action): the keyword the rule identified, plus rule context. The
      // article studio reads steps_json.keyword to prefill the keyword field,
      // so the FDE doesn't have to extract it from the description by eye.
      //
      // Phase 22.E.S9: also carry the full signal set so the "expected impact"
      // card can compute 90-day uplift without a second DB read. position_delta
      // and ctr/ctr_benchmark/impressions are what `computeExpectedImpact`
      // reads for stale_content and low_ctr_title branches respectively.
      metadata: {
        keyword: f.keyword,
        url: f.url,
        rule_id: f.ruleId,
        position: f.position,
        prior_position:
          f.position !== null && f.positionDelta !== null
            ? f.position - f.positionDelta
            : null,
        position_delta: f.positionDelta,
        search_volume: f.searchVolume,
        keyword_difficulty: f.keywordDifficulty,
        ctr: f.ctr,
        ctr_benchmark: f.ctrBenchmark,
      },
      evidence_refs: [`seo_patrol:${f.ruleId}:${subject}`],
      expected_impact: RULE_IMPACT[f.ruleId],
      effort: RULE_EFFORT[f.ruleId],
      execution_mode: 'in_house',
      executable_by: null,
    }
  })
}

/** A kanban card row as far as patrol suppression cares. */
export interface PatrolCardRow {
  action_type: string
  status: string
  source: string | null
  steps_json: Record<string, unknown> | null
  created_at: string | null
  updated_at: string | null
}

export interface CardSuppression {
  /** Card keys (executionItemDedupKey) the patrol must not open a new card for today. */
  blockedKeys: Set<string>
  /** Patrol cards opened for this client in the last 7 days, whatever their status now. */
  openedLast7Days: number
}

/** Pure: which targets are held back, and how many patrol cards the last 7 days already opened. */
export function buildCardSuppression(rows: readonly PatrolCardRow[], now: Date): CardSuppression {
  const holdSince = now.getTime() - DECIDED_CARD_HOLD_DAYS * 86_400_000
  const weekSince = now.getTime() - 7 * 86_400_000
  const blockedKeys = new Set<string>()
  let openedLast7Days = 0
  for (const row of rows) {
    const meta = row.steps_json ?? {}
    const key = executionItemDedupKey(row.action_type, meta.keyword, meta.url ?? meta.page_url)
    if (row.status === 'pending' || row.status === 'in_progress') {
      blockedKeys.add(key)
    } else if (
      (row.status === 'completed' || row.status === 'skipped') &&
      row.updated_at !== null &&
      Date.parse(row.updated_at) >= holdSince
    ) {
      blockedKeys.add(key)
    }
    const isPatrolCard = row.source === 'zhuge' && typeof meta.rule_id === 'string'
    if (isPatrolCard && row.created_at !== null && Date.parse(row.created_at) >= weekSince) {
      openedLast7Days++
    }
  }
  return { blockedKeys, openedLast7Days }
}

/**
 * Read this client's SEO cards that can still hold a target back: open ones, and ones
 * updated or created within the hold window. Fails closed: an error, or a full page at
 * the row limit (possibly partial), is reported instead of guessed at.
 */
export async function loadCardSuppression(
  supabase: SupabaseClient,
  clientId: string,
  now: Date,
): Promise<{ ok: true; value: CardSuppression } | { ok: false; error: string }> {
  const since = new Date(now.getTime() - DECIDED_CARD_HOLD_DAYS * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from('execution_items')
    .select('action_type, status, source, steps_json, created_at, updated_at')
    .eq('client_id', clientId)
    .eq('dimension', 'seo')
    .or(`status.in.(pending,in_progress),updated_at.gte.${since},created_at.gte.${since}`)
    .limit(CARD_READ_LIMIT)
  if (error) return { ok: false, error: error.message }
  const rows = (data ?? []) as PatrolCardRow[]
  if (rows.length >= CARD_READ_LIMIT) {
    return { ok: false, error: `card read hit the ${CARD_READ_LIMIT}-row limit; refusing to decide on a partial list` }
  }
  return { ok: true, value: buildCardSuppression(rows, now) }
}

export interface PatrolCardPlan {
  actions: PriorityAction[]
  /** Why no card was opened although there were findings, if that is the case. */
  withheldReason: 'weekly_cap' | null
  /** Findings whose target already has a card (open, or closed by a human recently). */
  heldExistingCard: number
}

/** Pure: today's cards after the existing-card hold and the rolling weekly cap. */
export function planPatrolCards(findings: SeoPatrolFinding[], suppression: CardSuppression): PatrolCardPlan {
  const heldExistingCard = findings.filter((f) =>
    suppression.blockedKeys.has(executionItemDedupKey(f.suggestedActionType, f.keyword, f.url)),
  ).length
  const remaining = Math.max(0, WEEKLY_CARD_CAP_PER_CLIENT - suppression.openedLast7Days)
  if (remaining === 0) return { actions: [], withheldReason: 'weekly_cap', heldExistingCard }
  const actions = findingsToActions(findings, { blockedKeys: suppression.blockedKeys, limit: remaining })
  return { actions, withheldReason: null, heldExistingCard }
}

// ── Persistence ──────────────────────────────────────────────────────────────────

/**
 * Persist findings for one client as the day's fresh set.
 *
 * Uses a clear-then-insert pattern rather than upsert: the unique index that
 * prevents duplicate open findings is a PARTIAL index (WHERE status='fresh')
 * over COALESCE expressions, which PostgREST's onConflict cannot target
 * reliably. So we delete this client's still-fresh findings (un-actioned
 * leftovers from a prior run) and insert the current set. Already-actioned or
 * dismissed findings are preserved (we only clear status='fresh').
 *
 * The clear runs even when `findings` is empty: a client whose issues have all
 * resolved must not keep last week's fresh rows on display.
 *
 * All findings in `findings` belong to a single client (per-client orchestration).
 */
async function persistFindings(
  supabase: SupabaseClient,
  clientId: string,
  findings: SeoPatrolFinding[],
): Promise<number> {
  // Clear prior un-actioned findings so re-running refreshes rather than
  // accumulating duplicate or stale fresh rows.
  const { error: deleteErr } = await supabase
    .from('seo_patrol_findings')
    .delete()
    .eq('client_id', clientId)
    .eq('status', 'fresh')

  if (deleteErr) {
    throw new Error(`seo_patrol_findings clear failed: ${deleteErr.message}`)
  }

  if (findings.length === 0) return 0

  const rows = findings.map((f) => ({
    client_id: f.clientId,
    rule_id: f.ruleId,
    keyword: f.keyword,
    url: f.url,
    position: f.position,
    ctr: f.ctr,
    ctr_benchmark: f.ctrBenchmark,
    search_volume: f.searchVolume,
    keyword_difficulty: f.keywordDifficulty,
    position_delta: f.positionDelta,
    suggested_action_type: f.suggestedActionType,
    description: f.description,
    status: 'fresh' as const,
  }))

  const { data, error } = await supabase
    .from('seo_patrol_findings')
    .insert(rows)
    .select('id')

  if (error) {
    throw new Error(`seo_patrol_findings persist failed: ${error.message}`)
  }
  return data?.length ?? rows.length
}

// ── Per-client orchestration ─────────────────────────────────────────────────────

export async function runSeoPatrolForClient(
  client: SeoPatrolClient,
  supabase: SupabaseClient = supabaseAdmin,
  now: Date = new Date(),
): Promise<SeoPatrolClientResult> {
  const base: SeoPatrolClientResult = {
    client_id: client.id,
    domain: client.domain,
    findings_detected: 0,
    findings_persisted: 0,
    actions_created: 0,
  }

  try {
    const { input, pageDataStatus } = await loadSeoPatrolInput(supabase, client)
    base.page_data_status = pageDataStatus
    const findings = runSeoPatrolRules(input)
    base.findings_detected = findings.length

    // Runs even with zero findings: clears stale fresh rows from prior days.
    base.findings_persisted = await persistFindings(supabase, client.id, findings)

    if (findings.length === 0) return base

    const suppression = await loadCardSuppression(supabase, client.id, now)
    if (!suppression.ok) {
      // Fail closed: without the list of existing cards a repeat cannot be told from a
      // new target, so no card today. The findings are already saved above.
      base.cards_withheld_reason = 'card_lookup_failed'
      base.error = `card lookup failed: ${suppression.error}`
      return base
    }
    const plan = planPatrolCards(findings, suppression.value)
    base.findings_held_existing_card = plan.heldExistingCard
    if (plan.withheldReason) base.cards_withheld_reason = plan.withheldReason
    const actions = plan.actions
    if (actions.length === 0) return base

    const output: ZhugeOutput = {
      top_actions: actions,
      generated_at: new Date().toISOString(),
      cost_usd: 0,
      input_tokens: 0,
      output_tokens: 0,
    }

    // Route through 诸葛亮's persister so SEO actions land on the kanban with
    // source='zhuge', identical to every other recommended action.
    // discoveryId/diagnosticRunId namespaced to the patrol so idempotency is
    // per-day (date in the discovery id).
    const day = output.generated_at.slice(0, 10)
    const result = await persistZhugeActions(supabase, {
      clientId: client.id,
      discoveryId: `seo_patrol:${day}`,
      diagnosticRunId: null,
      output,
    })
    base.actions_created = result.inserted

    return base
  } catch (err) {
    base.error = err instanceof Error ? err.message : String(err)
    return base
  }
}

// ── Batch entry point (cron) ─────────────────────────────────────────────────────

export interface SeoPatrolBatchResult {
  clients_processed: number
  total_findings: number
  total_actions: number
  failed: number
  /** Clients whose R2 page-signal feed was missing or errored this run. */
  page_data_problems: number
  results: SeoPatrolClientResult[]
}

export async function runSeoPatrol(
  supabase: SupabaseClient = supabaseAdmin,
): Promise<SeoPatrolBatchResult> {
  // 真客户闸门：周期性监测只对 active 客户跑（DataForSEO 计划 阶段 0）
  const { data: clients, error } = await supabase
    .from('clients')
    .select('id, domain, semrush_db')
    .eq('client_status', 'active')
    .not('domain', 'is', null)

  if (error) {
    throw new Error(`Failed to load clients: ${error.message}`)
  }

  const eligible = ((clients ?? []) as Array<{ id: string; domain: string | null; semrush_db: string | null }>)
    .filter((c): c is SeoPatrolClient =>
      typeof c.id === 'string' && typeof c.domain === 'string' && c.domain.trim().length > 0,
    )

  const results: SeoPatrolClientResult[] = []
  for (const client of eligible) {
    results.push(await runSeoPatrolForClient(client, supabase))
  }

  return {
    clients_processed: results.length,
    total_findings: results.reduce((s, r) => s + r.findings_detected, 0),
    total_actions: results.reduce((s, r) => s + r.actions_created, 0),
    failed: results.filter((r) => r.error).length,
    page_data_problems: results.filter(
      (r) => r.page_data_status && r.page_data_status !== 'ok',
    ).length,
    results,
  }
}
