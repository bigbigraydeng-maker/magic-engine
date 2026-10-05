/**
 * Full-market opportunity view for one client, built from keyword-idea results
 * of several seed keywords and compared with the client's own tracked keywords.
 *
 * Pure functions only: no I/O, no fetch, no supabase, no randomness, no Date.
 * Reuses the phrase-identity helpers from the weekly list so a phrase is the
 * same phrase in both views.
 */

import type { LabsKeyword } from '@/lib/dataforseo/labs-types'
import { isBrandedKeywordWithAliases } from '@/lib/seo-intelligence/intent-strategy'
import { ctrBenchmarkForPosition } from '@/lib/seo-patrol/rules'
import { competitorBrandMatch, domainRoot, tokenKey } from '@/lib/seo-weekly-list/candidates'

export const MAX_SEEDS = 15
export const MAX_IDEAS_PER_SEED = 300
/** Public DataForSEO list price, NOT verified against billing. Used only for an upper-bound estimate. */
export const EST_COST_PER_CALL_USD = 0.01
export const EST_COST_PER_ITEM_USD = 0.0001

/** Seeds come from a database column: anything that is not a usable string is dropped. */
export function pickSeeds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const seed = item.trim()
    if (seed === '' || seed.length > 80) continue
    const key = seed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(seed)
    if (out.length >= MAX_SEEDS) break
  }
  return out
}

/** Upper bound on the cost of one run: one call per seed plus one item per idea. */
export function estimateMaxCostUsd(seedCount: number, limitPerSeed: number): number {
  const total = seedCount * (EST_COST_PER_CALL_USD + limitPerSeed * EST_COST_PER_ITEM_USD)
  return Math.round(total * 10000) / 10000
}

export type SeedStatus = 'ok' | 'empty' | 'error'
export interface SeedIdeas { seed: string; status: SeedStatus; ideas: LabsKeyword[] }
export interface OwnRank { keyword: string; position: number | null }

export type RankBand = 'top3' | 'p4_10' | 'p11_30' | 'p31_plus' | 'not_tracked'
export interface OpportunityRow {
  keyword: string
  volume: number
  kd: number | null
  intent: string
  cpc: number | null
  /** every seed whose ideas contained this phrase (or a re-ordered / plural variant of it) */
  seeds: string[]
  /** position from the client's own tracked-keyword snapshot; null when the client is not tracked on it */
  ownPosition: number | null
  band: RankBand
}
export interface ExcludedCounts { brand: number; competitorBrand: number; noVolume: number; lowVolume: number }

export function bandOf(position: number | null): RankBand {
  if (position === null) return 'not_tracked'
  if (position <= 3) return 'top3'
  if (position <= 10) return 'p4_10'
  if (position <= 30) return 'p11_30'
  return 'p31_plus'
}

export interface BuildOptions {
  brandRoot: string
  brandAliases: string[] | null
  competitorDomains: string[]
  /** keep only phrases with at least this monthly volume. Default 50. */
  minVolume?: number
}

interface Group {
  row: OpportunityRow
  seeds: Set<string>
}

/** Highest volume wins; ties go to the shorter keyword, then alphabetical. */
function betterRow(a: OpportunityRow, b: OpportunityRow): OpportunityRow {
  if (a.volume !== b.volume) return a.volume > b.volume ? a : b
  if (a.keyword.length !== b.keyword.length) return a.keyword.length < b.keyword.length ? a : b
  return a.keyword <= b.keyword ? a : b
}

/** Best (lowest) non-null position per tokenKey; a null position means tracked but not ranking. */
function ownPositionsByKey(own: OwnRank[]): Map<string, number | null> {
  const map = new Map<string, number | null>()
  for (const o of own) {
    const key = tokenKey(o.keyword)
    if (!key || key === '>') continue
    const prev = map.get(key)
    if (prev === undefined) {
      map.set(key, o.position)
      continue
    }
    if (prev === null) continue
    if (o.position !== null && o.position < prev) map.set(key, o.position)
  }
  return map
}

export function buildOpportunityRows(
  results: SeedIdeas[],
  own: OwnRank[],
  opts: BuildOptions,
): { rows: OpportunityRow[]; excluded: ExcludedCounts } {
  const minVolume = opts.minVolume ?? 50
  const competitorRoots = opts.competitorDomains.map(domainRoot)
  const excluded: ExcludedCounts = { brand: 0, competitorBrand: 0, noVolume: 0, lowVolume: 0 }
  const groups = new Map<string, Group>()

  for (const result of results) {
    for (const idea of result.ideas) {
      const keyword = idea.keyword
      if (!keyword) continue
      if (idea.search_volume === null) { excluded.noVolume++; continue }
      if (isBrandedKeywordWithAliases(keyword, opts.brandRoot, opts.brandAliases)) { excluded.brand++; continue }
      if (competitorBrandMatch(keyword, competitorRoots) !== null) { excluded.competitorBrand++; continue }
      if (idea.search_volume < minVolume) { excluded.lowVolume++; continue }
      const key = tokenKey(keyword)
      if (!key || key === '>') continue
      const candidate: OpportunityRow = {
        keyword,
        volume: idea.search_volume,
        kd: idea.keyword_difficulty,
        intent: idea.intent,
        cpc: idea.cpc,
        seeds: [],
        ownPosition: null,
        band: 'not_tracked',
      }
      const group = groups.get(key)
      if (!group) {
        groups.set(key, { row: candidate, seeds: new Set([result.seed]) })
        continue
      }
      group.seeds.add(result.seed)
      group.row = betterRow(group.row, candidate)
    }
  }

  const ownByKey = ownPositionsByKey(own)
  const rows: OpportunityRow[] = []
  for (const [key, group] of Array.from(groups.entries())) {
    const ownPosition = ownByKey.get(key) ?? null
    rows.push({ ...group.row, seeds: Array.from(group.seeds).sort(), ownPosition, band: bandOf(ownPosition) })
  }
  rows.sort((a, b) => b.volume - a.volume || (a.keyword < b.keyword ? -1 : a.keyword > b.keyword ? 1 : 0))
  return { rows, excluded }
}

export interface OpportunitySummary {
  rows_total: number
  volume_total: number
  excluded: ExcludedCounts
  /** monthly volume summed per band, and keyword count per band */
  by_band: Record<RankBand, { keywords: number; volume: number }>
  /** buyer-intent = intent 'commercial' or 'transactional'; everything else = research */
  buyer: { keywords: number; volume: number; not_top10_volume: number }
  research: { keywords: number; volume: number; not_top10_volume: number }
  /** CEILING, not a forecast: extra monthly clicks if EVERY row not already in top 10 reached position 5 / position 3, using ctrBenchmarkForPosition. Current clicks of a row = volume * ctrBenchmarkForPosition(ownPosition) when ownPosition is not null, otherwise 0. gain = volume * max(0, ctr(target) - current). Round each total to an integer at the end. */
  ceiling_gain_to_p5: number
  ceiling_gain_to_p3: number
  top_buyer: OpportunityRow[]      // up to 25 buyer-intent rows NOT in top 10 (band p11_30, p31_plus or not_tracked), by volume desc
  top_research: OpportunityRow[]   // up to 25 research rows NOT in top 10, by volume desc
  seed_status: Array<{ seed: string; status: SeedStatus; ideas: number }>
}

const BANDS: RankBand[] = ['top3', 'p4_10', 'p11_30', 'p31_plus', 'not_tracked']

function isBuyerIntent(intent: string): boolean {
  return intent === 'commercial' || intent === 'transactional'
}

function isTop10(band: RankBand): boolean {
  return band === 'top3' || band === 'p4_10'
}

/** Extra clicks if this row reached `target`, over its current clicks. 0 when already in the top 10. */
function ceilingGain(row: OpportunityRow, target: number): number {
  if (isTop10(row.band)) return 0
  const current = row.ownPosition === null ? 0 : ctrBenchmarkForPosition(row.ownPosition)
  return row.volume * Math.max(0, ctrBenchmarkForPosition(target) - current)
}

export function summariseOpportunity(
  rows: OpportunityRow[],
  excluded: ExcludedCounts,
  results: SeedIdeas[],
): OpportunitySummary {
  const byBand = {} as Record<RankBand, { keywords: number; volume: number }>
  for (const band of BANDS) byBand[band] = { keywords: 0, volume: 0 }
  const buyer = { keywords: 0, volume: 0, not_top10_volume: 0 }
  const research = { keywords: 0, volume: 0, not_top10_volume: 0 }
  let volumeTotal = 0
  let gainP5 = 0
  let gainP3 = 0

  for (const row of rows) {
    volumeTotal += row.volume
    byBand[row.band].keywords++
    byBand[row.band].volume += row.volume
    const bucket = isBuyerIntent(row.intent) ? buyer : research
    bucket.keywords++
    bucket.volume += row.volume
    if (!isTop10(row.band)) bucket.not_top10_volume += row.volume
    gainP5 += ceilingGain(row, 5)
    gainP3 += ceilingGain(row, 3)
  }

  const notTop10 = rows.filter(r => !isTop10(r.band))
  const topBuyer = notTop10.filter(r => isBuyerIntent(r.intent)).slice(0, 25)
  const topResearch = notTop10.filter(r => !isBuyerIntent(r.intent)).slice(0, 25)

  return {
    rows_total: rows.length,
    volume_total: volumeTotal,
    excluded,
    by_band: byBand,
    buyer,
    research,
    ceiling_gain_to_p5: Math.round(gainP5),
    ceiling_gain_to_p3: Math.round(gainP3),
    top_buyer: topBuyer,
    top_research: topResearch,
    seed_status: results.map(r => ({ seed: r.seed, status: r.status, ideas: r.ideas.length })),
  }
}
