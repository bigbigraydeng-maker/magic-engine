/**
 * Creative scorecard (fix plan knife 5, rulebook C-19 / E-02③). Pure, read-only.
 * Judges, per ad inside one ad set, whether its numbers are big enough to set beside its siblings.
 * It never says which creative "won": same-ad-set comparisons are reference only (Meta picks who sees
 * each ad before it splits the money).
 */
import type { CoreMetric } from '../rules/core-metric'

export type CreativeComparability =
  | 'target_unknown'    // the ad set's destination / goal could not be read
  | 'no_result_type'    // ad set is not judged on leads / conversations (video views, reach, ...)
  | 'only_one'          // fewer than 2 ads with spend in this ad set: nothing to set it beside
  | 'no_threshold'      // the industry playbook has no click threshold yet
  | 'clicks_not_stored' // this ad's rows did not store link clicks
  | 'too_few_clicks'    // link clicks below the threshold
  | 'enough'            // big enough to look at side by side (still not causal)

export interface CreativeInput {
  spend: number
  leads: number
  messagingConversations: number
  linkClicks: number
  /** false = none of this ad's rows stored link clicks; linkClicks is then meaningless */
  linkClicksStored: boolean
}

export interface CreativeVerdict {
  resultType: CoreMetric | null
  results: number | null
  costPerResult: number | null
  linkClicks: number | null
  minLinkClicks: number | null
  comparability: CreativeComparability
}

export interface AudienceSnapshot {
  capturedAt: string
  audienceKey: string | null
}

export interface AudienceParts {
  included: readonly string[] | null
  excluded: readonly string[] | null
  targeting: unknown
  advantage: number | null
}

/** The one result this ad is judged on, or null when the ad set has no result type. */
export function resultsOf(
  m: Pick<CreativeInput, 'leads' | 'messagingConversations'>,
  resultType: CoreMetric | null,
): number | null {
  if (resultType === 'lead') return m.leads
  if (resultType === 'messaging_started') return m.messagingConversations
  return null
}

/** Judge one ad. Comparability checks run in a fixed order; first match wins. */
export function judgeCreative(
  m: CreativeInput,
  ctx: { resultType: CoreMetric | null; minLinkClicks: number | null; siblingsWithSpend: number; targetKnown?: boolean },
): CreativeVerdict {
  const results = resultsOf(m, ctx.resultType)
  const costPerResult = results !== null && results > 0 ? m.spend / results : null
  const linkClicks = m.linkClicksStored ? m.linkClicks : null

  let comparability: CreativeComparability
  if (ctx.targetKnown === false) comparability = 'target_unknown'
  else if (ctx.resultType === null) comparability = 'no_result_type'
  else if (ctx.siblingsWithSpend < 2) comparability = 'only_one'
  else if (ctx.minLinkClicks === null) comparability = 'no_threshold'
  else if (!m.linkClicksStored) comparability = 'clicks_not_stored'
  else if (m.linkClicks < ctx.minLinkClicks) comparability = 'too_few_clicks'
  else comparability = 'enough'

  return {
    resultType: ctx.resultType,
    results,
    costPerResult,
    linkClicks,
    minLinkClicks: ctx.minLinkClicks,
    comparability,
  }
}

/** Judge every ad in one ad set; siblingsWithSpend counts ads with spend > 0. */
export function judgeCreatives(
  ads: readonly CreativeInput[],
  resultType: CoreMetric | null,
  minLinkClicks: number | null,
  targetKnown = true,
): CreativeVerdict[] {
  const siblingsWithSpend = ads.filter((a) => a.spend > 0).length
  return ads.map((a) => judgeCreative(a, { resultType, minLinkClicks, siblingsWithSpend, targetKnown }))
}

/** Recursively sort object keys; arrays keep order; primitives unchanged. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') {
    const src = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(src).sort()) out[key] = canonical(src[key])
    return out
  }
  return value
}

function sortedCopy(ids: readonly string[] | null): string[] | null {
  return ids === null ? null : [...ids].sort()
}

/** Stable key for an audience definition; null when every part is empty. */
export function audienceKeyOf(p: AudienceParts): string | null {
  const included = p.included ?? null
  const excluded = p.excluded ?? null
  const targeting = p.targeting ?? null
  const advantage = p.advantage ?? null
  if (included === null && excluded === null && targeting === null && advantage === null) return null
  return JSON.stringify([sortedCopy(included), sortedCopy(excluded), canonical(targeting), advantage])
}

function makeDayFormatter(timeZone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' })
  }
}

/**
 * First day inside [since, until] on which the audience key differs from the previous snapshot.
 * A baseline before `since` that differs from the first in-window row is reported on that row's day.
 * Days are calendar days in `timeZone` (invalid zone falls back to UTC).
 */
export function audienceChangedOn(
  rows: readonly AudienceSnapshot[],
  since: string,
  until: string,
  timeZone = 'UTC',
): string | null {
  const fmt = makeDayFormatter(timeZone)
  const day = (row: AudienceSnapshot): string => fmt.format(new Date(row.capturedAt))
  const kept = rows
    .filter((r) => r.audienceKey !== null && day(r) <= until)
    .slice()
    .sort((a, b) => (a.capturedAt < b.capturedAt ? -1 : a.capturedAt > b.capturedAt ? 1 : 0))

  let prev: string | undefined
  for (const row of kept) {
    const key = row.audienceKey
    if (key === null) continue
    if (prev !== undefined && key !== prev && day(row) >= since) return day(row)
    prev = key
  }
  return null
}
