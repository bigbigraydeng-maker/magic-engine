/**
 * SEO Meta-Cycle — daily target-keyword rank sampler (2026-10-04 rank-verification redesign).
 *
 * For every seo_meta_log row that has a rank baseline and no verdict yet:
 *   - from T+18 (FIRST_SAMPLE_AFTER_DAYS) take one live SERP rank reading, at most one per
 *     calendar day and at least SAMPLE_SPACING_DAYS apart, until 3 valid samples exist;
 *   - then write rank_verdict via the pure state machine (rank-verdict.ts).
 * A reverted row, a row whose page was changed again, a row with no usable baseline, and a
 * row whose live <title> is not the one we wrote are finalised as `not_measured` WITHOUT
 * spending a SERP call.
 *
 * Hard rules this file enforces (each has a test):
 *   - one sample per row per day (a re-run, a retry, a manual re-trigger never double-samples
 *     or double-spends);
 *   - the sample uses the BASELINE's own depth (ranks at different depths are not comparable);
 *   - a verdict is never overwritten (`.is('rank_verdict', null)` on the write);
 *   - every database error throws — nothing here reports success it did not achieve;
 *   - shadow period: this module writes ONLY to seo_meta_log. It does not touch
 *     flywheel_outcomes or the memory/experience tables.
 *
 * Client-agnostic: domain / country come from the clients row; nothing names a client.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchTargetRank, type FetchTargetRankFn, type RankReading } from './rank-check'
import {
  FIRST_SAMPLE_AFTER_DAYS,
  SAMPLE_SPACING_DAYS,
  decideRankVerdict,
  type RankVerdict,
  type StoredRankSample,
  type VerdictDetail,
} from './rank-verdict'

export const RANK_SAMPLER_JOB = 'seo-meta-rank-sampler'
export const RANK_SAMPLE_DUE_EVENT = 'seo/meta-rank.sample.due'
/** Daily, 20:20 UTC. Any fixed time works; keeping it fixed keeps the daily SERP readings comparable. */
export const RANK_SAMPLER_CRON = '20 20 * * *'
/** Per-run ceiling on rows (and therefore SERP calls): a runaway backlog cannot become a runaway bill. */
export const MAX_ROWS_PER_RUN = 30

const DAY_MS = 86_400_000

export interface RankLogRow {
  id: string
  client_id: string
  page_slug: string
  page_url: string
  keyword: string
  new_title: string | null
  optimised_at: string
  reverted_at: string | null
  baseline_rank_group: number | null
  baseline_rank_status: 'ranked' | 'not_in_top_n' | 'other_own_page' | 'fetch_failed' | null
  baseline_serp_depth: number | null
  rank_samples: StoredRankSample[] | null
  rank_verdict: string | null
  verdict_detail: Record<string, unknown> | null
}

const ROW_COLUMNS =
  'id, client_id, page_slug, page_url, keyword, new_title, optimised_at, reverted_at, baseline_rank_group, baseline_rank_status, baseline_serp_depth, rank_samples, rank_verdict, verdict_detail'

/** UTC calendar day, YYYY-MM-DD. */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function daysBetween(fromIso: string, to: Date): number {
  return (to.getTime() - new Date(fromIso).getTime()) / DAY_MS
}

/**
 * Pure: does this row need work today?
 * Rows from before the feature (no baseline status) are not tracked at all — they stay NULL
 * rather than being labelled "not measured" for a measurement that was never set up.
 */
export function isDue(row: RankLogRow, now: Date): boolean {
  if (row.rank_verdict !== null || row.baseline_rank_status === null) return false
  if (row.reverted_at !== null) return true // finalise promptly, no need to wait out the window
  if (daysBetween(row.optimised_at, now) < FIRST_SAMPLE_AFTER_DAYS) return false
  const samples = row.rank_samples ?? []
  if (samples.length === 0) return true
  const lastDay = samples.map((s) => s.day).sort().pop() as string
  return daysBetween(`${lastDay}T00:00:00Z`, now) >= SAMPLE_SPACING_DAYS
}

export async function loadDueRows(supabase: SupabaseClient, now: Date): Promise<RankLogRow[]> {
  const { data, error } = await supabase
    .from('seo_meta_log')
    .select(ROW_COLUMNS)
    .is('rank_verdict', null)
    .not('baseline_rank_status', 'is', null)
    .order('optimised_at', { ascending: true })
    .limit(200)
  if (error) throw new Error(`rank_sampler_load_failed:${error.message}`)
  return ((data ?? []) as RankLogRow[]).filter((row) => isDue(row, now)).slice(0, MAX_ROWS_PER_RUN)
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&apos;': "'", '&nbsp;': ' ' }

function normaliseTitle(raw: string): string {
  return raw.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39|#x27);/g, (m) => ENTITIES[m] ?? m).replace(/\s+/g, ' ').trim().toLowerCase()
}

export type FetchLiveTitleFn = (pageUrl: string, expectedTitle: string) => Promise<boolean | null>

/**
 * Does the page that is live right now carry the title we wrote? (A merged PR is not proof of
 * a deployed page.) Template suffixes such as " | Brand" are fine — we check the written
 * title is contained. null = could not tell (network, no <title>): it never blocks a verdict.
 */
export const checkLiveTitle: FetchLiveTitleFn = async (pageUrl, expectedTitle) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(pageUrl, { signal: controller.signal, redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (compatible; MagicEngineVerify/1.0)' } })
    if (!res.ok) return null
    const html = await res.text()
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    if (!match) return null
    return normaliseTitle(match[1]).includes(normaliseTitle(expectedTitle))
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function isSuperseded(supabase: SupabaseClient, row: RankLogRow): Promise<boolean> {
  const { data, error } = await supabase
    .from('seo_meta_log')
    .select('id')
    .eq('client_id', row.client_id)
    .eq('page_slug', row.page_slug)
    .gt('optimised_at', row.optimised_at)
    .limit(1)
  if (error) throw new Error(`rank_sampler_superseded_lookup_failed:${error.message}`)
  return (data ?? []).length > 0
}

async function loadClient(supabase: SupabaseClient, clientId: string): Promise<{ domain: string; countryCode: 'au' | 'nz' }> {
  const { data, error } = await supabase.from('clients').select('domain, semrush_db').eq('id', clientId).maybeSingle()
  const row = data as { domain?: string | null; semrush_db?: string | null } | null
  if (error || !row?.domain) throw new Error(`rank_sampler_client_lookup_failed:${error?.message ?? 'no domain'}`)
  return { domain: row.domain, countryCode: row.semrush_db === 'nz' ? 'nz' : 'au' }
}

export interface SampleOutcome {
  kind: 'skipped' | 'sampled' | 'finalised'
  rowId: string
  verdict: RankVerdict | null
  /** DataForSEO cost of the SERP call made for this row (USD), null if none/unknown. */
  costUsd: number | null
  /** SERP calls made for this row (0 or 1). */
  providerCalls: number
  reason?: string
}

export interface SamplerDeps {
  supabase: SupabaseClient
  fetchRank?: FetchTargetRankFn
  fetchLiveTitle?: FetchLiveTitleFn
  now?: Date
}

function toStoredSample(reading: RankReading, day: string): StoredRankSample {
  return { day, status: reading.status, rank_group: reading.rankGroup, url: reading.url, depth: reading.depth, fetched_at: reading.fetchedAt, cost: reading.cost }
}

async function persist(supabase: SupabaseClient, row: RankLogRow, patch: Record<string, unknown>): Promise<void> {
  const { data, error } = await supabase.from('seo_meta_log').update(patch).eq('id', row.id).is('rank_verdict', null).select('id')
  if (error) throw new Error(`rank_sampler_write_failed:${error.message}`)
  // An update that matched nothing is not a success — it means the row got a verdict (or vanished) underneath us.
  if ((data ?? []).length !== 1) throw new Error(`rank_sampler_write_matched_${(data ?? []).length}_rows`)
}

function finalPatch(samples: StoredRankSample[], verdict: RankVerdict, detail: VerdictDetail, live: { ok: boolean | null; at: string | null }, now: Date) {
  return {
    rank_samples: samples,
    rank_verdict: verdict,
    checked_at: now.toISOString(),
    verdict_detail: { ...detail, live_title_ok: live.ok, live_title_checked_at: live.at },
  }
}

/**
 * Take today's sample (or finalise without one) for ONE row. Re-reads the row so a stale
 * event cannot act on old state, and returns without any provider call when today is done.
 */
export async function sampleOneRow(rowId: string, deps: SamplerDeps): Promise<SampleOutcome> {
  const { supabase } = deps
  const now = deps.now ?? new Date()
  const fetchRank = deps.fetchRank ?? fetchTargetRank
  const fetchLiveTitle = deps.fetchLiveTitle ?? checkLiveTitle
  const skip = (reason: string): SampleOutcome => ({ kind: 'skipped', rowId, verdict: null, costUsd: null, providerCalls: 0, reason })

  const { data, error } = await supabase.from('seo_meta_log').select(ROW_COLUMNS).eq('id', rowId).maybeSingle()
  if (error) throw new Error(`rank_sampler_row_lookup_failed:${error.message}`)
  const row = data as RankLogRow | null
  if (!row) return skip('row_not_found')
  if (!isDue(row, now)) return skip(row.rank_verdict !== null ? 'already_has_verdict' : 'not_due')

  // One sample per row per day needs no separate check: isDue() already requires SAMPLE_SPACING_DAYS
  // since the last sample, so a same-day re-run, retry or manual re-trigger is "not_due" above.
  const day = isoDay(now)
  const samples = row.rank_samples ?? []

  const superseded = await isSuperseded(supabase, row)
  const stored = row.verdict_detail ?? {}
  const live = { ok: (stored.live_title_ok as boolean | null | undefined) ?? null, at: (stored.live_title_checked_at as string | null | undefined) ?? null }
  if (live.ok === null && row.reverted_at === null && row.new_title) {
    live.ok = await fetchLiveTitle(row.page_url, row.new_title)
    live.at = now.toISOString()
  }

  const baseline = { status: row.baseline_rank_status, rank_group: row.baseline_rank_group, depth: row.baseline_serp_depth }
  const base = { baseline, revertedAt: row.reverted_at, supersededByLaterChange: superseded, liveTitleOk: live.ok }

  const before = decideRankVerdict({ ...base, samples })
  if (before.kind === 'final') {
    await persist(supabase, row, finalPatch(samples, before.verdict, before.detail, live, now))
    return { kind: 'finalised', rowId, verdict: before.verdict, costUsd: null, providerCalls: 0 }
  }

  const { domain, countryCode } = await loadClient(supabase, row.client_id)
  const reading = await fetchRank({ keyword: row.keyword, countryCode, domain, targetUrl: row.page_url, depth: row.baseline_serp_depth as number })
  const next = [...samples, toStoredSample(reading, day)]
  const after = decideRankVerdict({ ...base, samples: next })
  const cost = { costUsd: reading.cost, providerCalls: 1 }
  if (after.kind === 'final') {
    await persist(supabase, row, finalPatch(next, after.verdict, after.detail, live, now))
    return { kind: 'finalised', rowId, verdict: after.verdict, ...cost }
  }
  await persist(supabase, row, { rank_samples: next, verdict_detail: { ...stored, live_title_ok: live.ok, live_title_checked_at: live.at } })
  return { kind: 'sampled', rowId, verdict: null, ...cost }
}
