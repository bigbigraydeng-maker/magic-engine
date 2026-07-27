/**
 * Pure comparison builders for the weekly SEO loop.
 *
 * Three tables, all derived from stored ranked-keyword snapshots:
 *   1. week-over-week movement  -> already covered by
 *      `src/lib/seo-intelligence/position-changes.ts` (reused, not duplicated)
 *   2. head-to-head             -> `buildHeadToHead`
 *   3. opportunity gap          -> `buildOpportunityGap`
 *   plus striking distance      -> `buildStrikingDistance`
 *
 * REPORTING SCOPE (deliberate): these builders describe *positions* only —
 * what we rank for, where, and how that compares to competitors. They
 * intentionally emit no traffic, conversion or revenue attribution. ME's
 * outcome engine is known-unreliable for SEO (a 28-day window does not fit a
 * channel that takes 3–5 months to move, and site-wide average position
 * misreads "we published new pages" as "our rankings got worse"). Do not add
 * effect attribution to this module.
 */

export interface RankedKeyword {
  keyword: string
  position: number | null
  search_volume: number | null
  keyword_difficulty: number | null
  intent?: string | null
}

/** Ranked keywords for one competitor domain. */
export type CompetitorRankings = Record<string, RankedKeyword[]>

export interface HeadToHeadRow {
  keyword: string
  search_volume: number | null
  my_position: number | null
  competitor_positions: Record<string, number>
  best_competitor_domain: string
  best_competitor_position: number
  /** Whose result sits higher on the page. */
  verdict: 'ahead' | 'behind' | 'tied'
}

export interface OpportunityGapRow {
  keyword: string
  search_volume: number | null
  keyword_difficulty: number | null
  intent: string | null
  competitor_positions: Record<string, number>
  /** How many configured competitors rank for this keyword. */
  competitor_count: number
  best_competitor_position: number
}

export interface StrikingDistanceRow {
  keyword: string
  position: number
  search_volume: number | null
  keyword_difficulty: number | null
}

export interface GapOptions {
  /** Drop keywords thinner than this. Defaults to 50 searches/month. */
  minVolume?: number
  /**
   * Business-relevance gate. Compose
   * `isBusinessRelevantKeyword` with `isCompetitorBrandKeyword` here — the gap
   * list is worthless without both (see competitor-brands.ts for why).
   */
  isEligible?: (keyword: string) => boolean
}

function indexByKeyword(rows: readonly RankedKeyword[]): Map<string, RankedKeyword> {
  const map = new Map<string, RankedKeyword>()
  for (const row of rows) {
    const key = row.keyword?.trim().toLowerCase()
    if (!key) continue
    const existing = map.get(key)
    // Keep the strongest (numerically lowest) position when a domain has
    // several URLs ranking for the same keyword.
    if (!existing) { map.set(key, row); continue }
    if (existing.position == null) { map.set(key, row); continue }
    if (row.position != null && row.position < existing.position) map.set(key, row)
  }
  return map
}

function bestOf(positions: Record<string, number>): { domain: string; position: number } {
  let bestDomain = ''
  let bestPosition = Number.POSITIVE_INFINITY
  for (const [domain, position] of Object.entries(positions)) {
    if (position < bestPosition) { bestPosition = position; bestDomain = domain }
  }
  return { domain: bestDomain, position: bestPosition }
}

/**
 * Table 2 — keywords we rank for that at least one competitor also ranks for.
 * Sorted by search volume desc so the commercially important fights come first.
 */
export function buildHeadToHead(
  mine: readonly RankedKeyword[],
  competitors: CompetitorRankings,
): HeadToHeadRow[] {
  const competitorIndexes = Object.entries(competitors)
    .map(([domain, rows]) => [domain, indexByKeyword(rows)] as const)

  const rows: HeadToHeadRow[] = []

  for (const [keyword, mineRow] of indexByKeyword(mine)) {
    const competitorPositions: Record<string, number> = {}
    for (const [domain, index] of competitorIndexes) {
      const hit = index.get(keyword)
      if (hit?.position != null) competitorPositions[domain] = hit.position
    }
    if (Object.keys(competitorPositions).length === 0) continue

    const best = bestOf(competitorPositions)
    const myPosition = mineRow.position

    let verdict: HeadToHeadRow['verdict']
    if (myPosition == null) verdict = 'behind'
    else if (myPosition < best.position) verdict = 'ahead'
    else if (myPosition > best.position) verdict = 'behind'
    else verdict = 'tied'

    rows.push({
      keyword: mineRow.keyword,
      search_volume: mineRow.search_volume,
      my_position: myPosition,
      competitor_positions: competitorPositions,
      best_competitor_domain: best.domain,
      best_competitor_position: best.position,
      verdict,
    })
  }

  return rows.sort((a, b) => (b.search_volume ?? 0) - (a.search_volume ?? 0))
}

/**
 * Table 3 — the money table. Keywords a competitor ranks for and we do not.
 *
 * Ordered by how many competitors rank (a keyword three rivals hold is a
 * proven category term, not a fluke) and then by volume.
 */
export function buildOpportunityGap(
  mine: readonly RankedKeyword[],
  competitors: CompetitorRankings,
  options: GapOptions = {},
): OpportunityGapRow[] {
  const minVolume = options.minVolume ?? 50
  const isEligible = options.isEligible ?? (() => true)
  const mineIndex = indexByKeyword(mine)

  const merged = new Map<string, OpportunityGapRow>()

  for (const [domain, rows] of Object.entries(competitors)) {
    for (const [keyword, row] of indexByKeyword(rows)) {
      if (mineIndex.has(keyword)) continue
      if (row.position == null) continue
      if ((row.search_volume ?? 0) < minVolume) continue
      if (!isEligible(row.keyword)) continue

      const existing = merged.get(keyword)
      if (existing) {
        existing.competitor_positions[domain] = row.position
        existing.competitor_count = Object.keys(existing.competitor_positions).length
        existing.best_competitor_position = bestOf(existing.competitor_positions).position
        if (existing.keyword_difficulty == null) existing.keyword_difficulty = row.keyword_difficulty
        if (existing.intent == null) existing.intent = row.intent ?? null
        continue
      }

      merged.set(keyword, {
        keyword: row.keyword,
        search_volume: row.search_volume,
        keyword_difficulty: row.keyword_difficulty,
        intent: row.intent ?? null,
        competitor_positions: { [domain]: row.position },
        competitor_count: 1,
        best_competitor_position: row.position,
      })
    }
  }

  return Array.from(merged.values()).sort((a, b) =>
    (b.competitor_count - a.competitor_count) ||
    ((b.search_volume ?? 0) - (a.search_volume ?? 0))
  )
}

/**
 * Keywords sitting just off page one (positions 11–20) — cheapest wins
 * available, because the page already ranks and only needs a push.
 */
export function buildStrikingDistance(
  mine: readonly RankedKeyword[],
  lowerBound = 11,
  upperBound = 20,
): StrikingDistanceRow[] {
  return Array.from(indexByKeyword(mine).values())
    .filter((row): row is RankedKeyword & { position: number } =>
      row.position != null && row.position >= lowerBound && row.position <= upperBound)
    .map(row => ({
      keyword: row.keyword,
      position: row.position,
      search_volume: row.search_volume,
      keyword_difficulty: row.keyword_difficulty,
    }))
    .sort((a, b) => (b.search_volume ?? 0) - (a.search_volume ?? 0))
}
