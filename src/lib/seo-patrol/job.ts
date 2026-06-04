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
import { persistZhugeActions } from '@/lib/zhuge/action-persister'
import type { PriorityAction, ZhugeOutput } from '@/lib/zhuge/types'
import { runSeoPatrolRules } from './rules'
import type {
  SeoPatrolFinding,
  SeoPatrolInput,
  KeywordSignal,
} from './types'

// Max actions to surface per client per day. Iris SOP: "max 3, ranked by impact".
const MAX_ACTIONS_PER_CLIENT = 3

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
  not_indexed: 'low',
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

  // R2/R5 page signals are not yet collectable (see file header note).
  return { clientId, keywords, pages: [] }
}

async function loadSeoPatrolInput(
  supabase: SupabaseClient,
  client: SeoPatrolClient,
): Promise<SeoPatrolInput> {
  const locationCode = locationCodeFor(client.semrush_db)

  // Distinct snapshot dates, newest first (need current + one prior).
  const { data: dates } = await supabase
    .from('keyword_snapshots')
    .select('snapshot_date')
    .eq('client_id', client.id)
    .eq('location_code', locationCode)
    .order('snapshot_date', { ascending: false })
    .limit(60)

  const distinctDates = Array.from(
    new Set(((dates ?? []) as { snapshot_date: string }[]).map((d) => d.snapshot_date)),
  )
  const currentDate = distinctDates[0] ?? null
  const priorDate = distinctDates[1] ?? null

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

  return assembleSeoPatrolInput(client.id, currentKeywords, priorKeywords, gscQueries)
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
export function findingsToActions(findings: SeoPatrolFinding[]): PriorityAction[] {
  const sorted = [...findings].sort(
    (a, b) => RULE_RANK[a.ruleId] - RULE_RANK[b.ruleId],
  )
  const top = sorted.slice(0, MAX_ACTIONS_PER_CLIENT)

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
 * All findings in `findings` belong to a single client (per-client orchestration).
 */
async function persistFindings(
  supabase: SupabaseClient,
  findings: SeoPatrolFinding[],
): Promise<number> {
  if (findings.length === 0) return 0

  const clientId = findings[0].clientId

  // Clear prior un-actioned findings so re-running the same day refreshes
  // rather than accumulating duplicate fresh rows.
  const { error: deleteErr } = await supabase
    .from('seo_patrol_findings')
    .delete()
    .eq('client_id', clientId)
    .eq('status', 'fresh')

  if (deleteErr) {
    throw new Error(`seo_patrol_findings clear failed: ${deleteErr.message}`)
  }

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
): Promise<SeoPatrolClientResult> {
  const base: SeoPatrolClientResult = {
    client_id: client.id,
    domain: client.domain,
    findings_detected: 0,
    findings_persisted: 0,
    actions_created: 0,
  }

  try {
    const input = await loadSeoPatrolInput(supabase, client)
    const findings = runSeoPatrolRules(input)
    base.findings_detected = findings.length

    if (findings.length === 0) return base

    base.findings_persisted = await persistFindings(supabase, findings)

    const actions = findingsToActions(findings)
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
  results: SeoPatrolClientResult[]
}

export async function runSeoPatrol(
  supabase: SupabaseClient = supabaseAdmin,
): Promise<SeoPatrolBatchResult> {
  const { data: clients, error } = await supabase
    .from('clients')
    .select('id, domain, semrush_db')
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
    results,
  }
}
