/**
 * Check-stage funnel health for a lead ad — pure, no I/O, no Meta writes.
 *
 * Cost per lead is three multiplied pieces. This check scores each piece
 * against one winner inside the same ad account and names the weakest piece.
 * It never pauses, budgets, or edits an ad. A prescription is only a candidate
 * lesson (see toLessonInput); adoption is a separate human step.
 *
 * Verdict words are the existing outcome enum: confirmed, inconclusive,
 * reversed. There is no UNKNOWN verdict. A thin sample is still inconclusive;
 * the direction is kept on `reading` and `strength: 'tendency'` in candidate
 * lesson evidence, never in the temporal attribution outcome.
 *
 * Winner baseline (one ad, not a blend, not another account, not an industry
 * number):
 *   1. Same ad account as the delivery being checked.
 *   2. At least WINNER_MIN_LEADS leads. Fewer leads cannot be a baseline.
 *   3. Lowest cost per lead (spend / leads).
 *   4. Ties: more leads, then more link clicks, then the id sorted ascending
 *      so the choice does not flicker between runs.
 *   5. The ad being checked is excluded, so it is never its own baseline.
 *   6. If the check has no named ad, the winner is chosen from the whole
 *      account and the subject is the sum of the other ads.
 *
 * Link clicks are the Meta `actions` entry `link_click` only. The stored
 * `ctr` and all-clicks fields are not a substitute. video_p100 (played to
 * 100% of the video length) and ThruPlay (15 seconds, or the whole video
 * when it is shorter) are recorded separately and are not funnel segments
 * and are never copied into each other.
 *
 * Form opens are included only when that action was actually reported.
 * They are not invented as zero. When they are absent, form completion is
 * leads / link clicks and the basis is labelled `link_click`.
 */

import type { OutcomeVerdict } from '../adapters/types'
import type { LessonInput } from '@/lib/memory/write-lesson'

/** Below this many link clicks, a direction is only a tendency. */
export const TENDENCY_MIN_LINK_CLICKS = 100
/** Below this many leads, a direction is only a tendency. */
export const TENDENCY_MIN_LEADS = 5
/** A winner needs at least this many leads before it can be a baseline. */
export const WINNER_MIN_LEADS = 20

/** Meta actions action_type. Not the ctr field, not inline_link_clicks. */
export const LINK_CLICK_ACTION = 'link_click'

/**
 * Instant-form open, if Meta included it in `actions`.
 * Not a lead, not a link click, not a landing-page view.
 * Absent from the array means "not reported" (null), which is not zero.
 */
export const FORM_OPEN_ACTION = 'onsite_conversion.leadgen_form_open'

export const VIDEO_P100_MEANING =
  'video_p100 is plays that reached 100% of the video length (video_p100_watched_actions). It is not ThruPlay.'

export const VIDEO_THRUPLAY_MEANING =
  'ThruPlay is a view of 15 seconds, or the whole video when the video is shorter (video_thruplay_watched_actions). It is not video_p100.'

export const FUNNEL_REASON = {
  missing_data: 'missing_data',
  plan_actual_mismatch: 'plan_actual_mismatch',
  no_baseline: 'no_baseline',
  below_min_sample: 'below_min_sample',
  rate_undefined: 'rate_undefined',
} as const

export type FunnelReason = (typeof FUNNEL_REASON)[keyof typeof FUNNEL_REASON]
export type FunnelSegment = 'cpm' | 'link_ctr' | 'form_completion'
export type FunnelStrength = 'decided' | 'tendency'
export type FormCompletionBasis = 'form_open' | 'link_click'

const SEGMENT_TIE_BREAK: readonly FunnelSegment[] = ['form_completion', 'link_ctr', 'cpm']

export interface ActionStat {
  action_type: string
  value: string
}

export interface DeliverySide {
  objective: string | null
  destinationType: string | null
  entityId: string | null
  adAccountId: string | null
}

/** One ad over the check window, already summed. Null means "not reported". */
export interface FunnelUnit {
  id: string
  adAccountId: string
  spend: number | null
  impressions: number | null
  linkClicks: number | null
  leads: number | null
  formOpens: number | null
  videoP100: number | null
  videoThruPlay: number | null
}

/** One stored day before it is summed onto a FunnelUnit. */
export interface DeliveryDay {
  adAccountId: string
  entityId: string
  spend: number | null
  impressions: number | null
  leads: number | null
  /** null = the actions array was not stored. An empty array was stored. */
  actions: readonly ActionStat[] | null
  videoP100: number | null
  videoThruPlay: number | null
}

export interface FunnelCheckInput {
  /** Null when no plan was attached. That is not treated as a match. */
  plan: DeliverySide | null
  /** What was actually delivered. Required when `plan` names a field. */
  actual: DeliverySide | null
  subject: FunnelUnit
  /** Other ads in the same account. The subject must not be in this list. */
  peers: readonly FunnelUnit[]
}

export interface FunnelCheckResult {
  verdict: OutcomeVerdict
  reading: 'confirmed' | 'reversed' | null
  strength: FunnelStrength | null
  reasonCode: FunnelReason | null
  weakestSegment: FunnelSegment | null
  suggestion: string | null
  planCompared: boolean
  formCompletionBasis: FormCompletionBasis | null
  videoP100Meaning: string
  videoThruPlayMeaning: string
  subjectCpl: number | null
  winnerCpl: number | null
  winnerId: string | null
  subjectVideoP100: number | null
  subjectVideoThruPlay: number | null
  winnerVideoP100: number | null
  winnerVideoThruPlay: number | null
}

interface Rates {
  cpm: number
  linkCtr: number
  formCompletion: number
  basis: FormCompletionBasis
  cpl: number | null
}

const SUGGESTION: Record<FunnelSegment, { decided: string; tendency: string }> = {
  cpm: {
    decided: '单线索成本比本账户赢家贵时，若链接点击和表单完成仍接近赢家，最弱的是千次展示成本：先收紧受众或版位，不要先加预算，也不要自动改投放。',
    tendency: '样本还薄，这只是倾向：单线索成本看起来卡在千次展示成本这一段，先收紧受众看，不要据此自动改投放。',
  },
  link_ctr: {
    decided: '单线索成本比本账户赢家贵时，若千次展示成本和表单完成仍接近赢家，最弱的是链接点击率：先换钩子和开头画面，不要先加预算，也不要自动改投放。',
    tendency: '样本还薄，这只是倾向：单线索成本看起来卡在链接点击这一段，先换钩子看，不要据此自动改投放。',
  },
  form_completion: {
    decided: '单线索成本比本账户赢家贵时，若展示成本和链接点击仍接近赢家，最弱的是表单完成：先改表单和点进去之后的那一步，不要先加预算，也不要自动改投放。',
    tendency: '样本还薄，这只是倾向：单线索成本看起来卡在表单完成这一段，先改表单看，不要据此自动改投放。',
  },
}

const MISMATCH_SUGGESTION =
  '计划和实际投放对不上时，先不要判断漏斗哪一段最弱，也不要据此改投放。'

export function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(n) ? n : null
}

/** Count one action type. Null actions → null. A stored list without the type → 0. */
export function countAction(actions: readonly ActionStat[] | null, actionType: string): number | null {
  if (actions === null) return null
  let total = 0
  for (const entry of actions) {
    if (entry.action_type !== actionType) continue
    const n = Number(entry.value)
    if (!Number.isFinite(n)) return null
    total += n
  }
  return total
}

/**
 * Form opens are optional. Missing type → null (not reported), never a guessed 0.
 * A present type with value 0 stays 0.
 */
export function countFormOpens(actions: readonly ActionStat[] | null): number | null {
  if (actions === null) return null
  const present = actions.some((entry) => entry.action_type === FORM_OPEN_ACTION)
  if (!present) return null
  return countAction(actions, FORM_OPEN_ACTION)
}

export function linkClicksFromActions(actions: readonly ActionStat[] | null): number | null {
  return countAction(actions, LINK_CLICK_ACTION)
}

function blank(reason: FunnelReason | null, planCompared: boolean): FunnelCheckResult {
  return {
    verdict: 'inconclusive',
    reading: null,
    strength: null,
    reasonCode: reason,
    weakestSegment: null,
    suggestion: reason === FUNNEL_REASON.plan_actual_mismatch ? MISMATCH_SUGGESTION : null,
    planCompared,
    formCompletionBasis: null,
    videoP100Meaning: VIDEO_P100_MEANING,
    videoThruPlayMeaning: VIDEO_THRUPLAY_MEANING,
    subjectCpl: null,
    winnerCpl: null,
    winnerId: null,
    subjectVideoP100: null,
    subjectVideoThruPlay: null,
    winnerVideoP100: null,
    winnerVideoThruPlay: null,
  }
}

function normalizeToken(value: string): string {
  return value.trim().toUpperCase()
}

function planField(plan: string | null, actual: string | null): 'ok' | 'mismatch' | 'missing' {
  if (plan === null) return 'ok'
  if (actual === null || actual.trim() === '') return 'missing'
  return normalizeToken(plan) === normalizeToken(actual) ? 'ok' : 'mismatch'
}

/** A plan object whose every field is null is treated as "no plan". */
export function planOrNull(plan: DeliverySide | null): DeliverySide | null {
  if (!plan) return null
  if (plan.objective === null && plan.destinationType === null && plan.entityId === null && plan.adAccountId === null) {
    return null
  }
  return plan
}

function comparePlan(plan: DeliverySide | null, actual: DeliverySide | null): FunnelCheckResult | null {
  const stated = planOrNull(plan)
  if (!stated) return null
  const fields = [
    planField(stated.objective, actual?.objective ?? null),
    planField(stated.destinationType, actual?.destinationType ?? null),
    planField(stated.entityId, actual?.entityId ?? null),
    planField(stated.adAccountId, actual?.adAccountId ?? null),
  ]
  if (fields.some((field) => field === 'mismatch')) return blank(FUNNEL_REASON.plan_actual_mismatch, true)
  if (fields.some((field) => field === 'missing')) return blank(FUNNEL_REASON.missing_data, true)
  return null
}

function requiredNumber(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null
  return value
}

function ratesOf(unit: FunnelUnit): Rates | null {
  const spend = requiredNumber(unit.spend)
  const impressions = requiredNumber(unit.impressions)
  const linkClicks = requiredNumber(unit.linkClicks)
  const leads = requiredNumber(unit.leads)
  if (spend === null || impressions === null || linkClicks === null || leads === null) return null
  if (impressions === 0) return null
  const formOpens = unit.formOpens
  if (formOpens !== null && (!Number.isFinite(formOpens) || formOpens < 0)) return null
  const basis: FormCompletionBasis = formOpens === null ? 'link_click' : 'form_open'
  const trials = basis === 'form_open' ? formOpens : linkClicks
  if (trials === null || trials === 0) return null
  return {
    cpm: (spend / impressions) * 1000,
    linkCtr: linkClicks / impressions,
    formCompletion: leads / trials,
    basis,
    cpl: leads > 0 ? spend / leads : null,
  }
}

function eligibleWinner(unit: FunnelUnit): boolean {
  const leads = requiredNumber(unit.leads)
  return leads !== null && leads >= WINNER_MIN_LEADS && ratesOf(unit) !== null && ratesOf(unit)?.cpl !== null
}

/**
 * Pick the account's winner. See the file header for the rule.
 * `excludeId` is the ad being checked; pass null only when the caller has
 * not named one yet.
 */
export function selectWinner(peers: readonly FunnelUnit[], excludeId: string | null): FunnelUnit | null {
  const eligible = peers.filter((unit) => unit.id !== excludeId && eligibleWinner(unit))
  if (eligible.length === 0) return null
  const ranked = [...eligible].sort((a, b) => {
    const aCpl = (a.spend ?? 0) / (a.leads ?? 1)
    const bCpl = (b.spend ?? 0) / (b.leads ?? 1)
    if (aCpl !== bCpl) return aCpl - bCpl
    if ((b.leads ?? 0) !== (a.leads ?? 0)) return (b.leads ?? 0) - (a.leads ?? 0)
    if ((b.linkClicks ?? 0) !== (a.linkClicks ?? 0)) return (b.linkClicks ?? 0) - (a.linkClicks ?? 0)
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  return ranked[0] ?? null
}

function weakness(segment: FunnelSegment, subject: Rates, winner: Rates): number | null {
  if (segment === 'cpm') {
    if (winner.cpm === 0) return subject.cpm === 0 ? 1 : Number.POSITIVE_INFINITY
    return subject.cpm / winner.cpm
  }
  const subjectRate = segment === 'link_ctr' ? subject.linkCtr : subject.formCompletion
  const winnerRate = segment === 'link_ctr' ? winner.linkCtr : winner.formCompletion
  if (winnerRate === 0) return null
  if (subjectRate === 0) return Number.POSITIVE_INFINITY
  return winnerRate / subjectRate
}

function pickWeakest(subject: Rates, winner: Rates): { segment: FunnelSegment; worst: number } | null {
  const ratios: Record<FunnelSegment, number> = { cpm: 0, link_ctr: 0, form_completion: 0 }
  for (const segment of SEGMENT_TIE_BREAK) {
    const score = weakness(segment, subject, winner)
    if (score === null) return null
    ratios[segment] = score
  }
  let worst = -Infinity
  for (const segment of SEGMENT_TIE_BREAK) worst = Math.max(worst, ratios[segment])
  for (const segment of SEGMENT_TIE_BREAK) {
    if (ratios[segment] === worst) return { segment, worst }
  }
  return null
}

function withVideo(result: FunnelCheckResult, subject: FunnelUnit, winner: FunnelUnit | null): FunnelCheckResult {
  return {
    ...result,
    subjectVideoP100: subject.videoP100,
    subjectVideoThruPlay: subject.videoThruPlay,
    winnerVideoP100: winner?.videoP100 ?? null,
    winnerVideoThruPlay: winner?.videoThruPlay ?? null,
  }
}

function judgeSample(input: FunnelCheckInput, subjectRates: Rates, winner: FunnelUnit, winnerRates: Rates, picked: { segment: FunnelSegment; worst: number }): FunnelCheckResult {
  const reading = picked.worst > 1 ? 'reversed' : 'confirmed'
  const thin = (input.subject.linkClicks ?? 0) < TENDENCY_MIN_LINK_CLICKS || (input.subject.leads ?? 0) < TENDENCY_MIN_LEADS
  const suggestion = reading === 'reversed'
    ? SUGGESTION[picked.segment][thin ? 'tendency' : 'decided']
    : null
  return withVideo({
    verdict: thin ? 'inconclusive' : reading,
    reading,
    strength: thin ? 'tendency' : 'decided',
    reasonCode: thin ? FUNNEL_REASON.below_min_sample : null,
    weakestSegment: picked.segment,
    suggestion,
    planCompared: planOrNull(input.plan) !== null,
    formCompletionBasis: subjectRates.basis,
    videoP100Meaning: VIDEO_P100_MEANING,
    videoThruPlayMeaning: VIDEO_THRUPLAY_MEANING,
    subjectCpl: subjectRates.cpl,
    winnerCpl: winnerRates.cpl,
    winnerId: winner.id,
    subjectVideoP100: null,
    subjectVideoThruPlay: null,
    winnerVideoP100: null,
    winnerVideoThruPlay: null,
  }, input.subject, winner)
}

/**
 * Score one delivery against its account winner.
 * Missing numbers and a plan/actual contradiction are inconclusive.
 * Nothing in this function writes an ad, a budget, or a lesson.
 */
export function checkAdsFunnel(input: FunnelCheckInput): FunnelCheckResult {
  const mismatch = comparePlan(input.plan, input.actual)
  if (mismatch) return withVideo(mismatch, input.subject, null)
  const subjectRates = ratesOf(input.subject)
  if (!subjectRates) {
    const hole = requiredNumber(input.subject.spend) === null
      || requiredNumber(input.subject.impressions) === null
      || requiredNumber(input.subject.linkClicks) === null
      || requiredNumber(input.subject.leads) === null
    return withVideo(blank(hole ? FUNNEL_REASON.missing_data : FUNNEL_REASON.rate_undefined, planOrNull(input.plan) !== null), input.subject, null)
  }
  const winner = selectWinner(input.peers, input.subject.id)
  if (!winner) return withVideo(blank(FUNNEL_REASON.no_baseline, planOrNull(input.plan) !== null), input.subject, null)
  const winnerRates = ratesOf(winner)
  if (!winnerRates || winnerRates.basis !== subjectRates.basis) {
    return withVideo(blank(FUNNEL_REASON.rate_undefined, planOrNull(input.plan) !== null), input.subject, winner)
  }
  const picked = pickWeakest(subjectRates, winnerRates)
  if (!picked) return withVideo(blank(FUNNEL_REASON.rate_undefined, planOrNull(input.plan) !== null), input.subject, winner)
  return judgeSample(input, subjectRates, winner, winnerRates, picked)
}

function sumNumbers(values: readonly (number | null)[]): number | null {
  let total = 0
  for (const value of values) {
    if (value === null) return null
    total += value
  }
  return total
}

/** All null → null. Any hole → null. Never fills a missing day with zero. */
function sumOptional(values: readonly (number | null)[]): number | null {
  if (values.length === 0) return null
  return sumNumbers(values)
}

function sumGroup(days: readonly DeliveryDay[]): FunnelUnit | null {
  const first = days[0]
  if (!first) return null
  const linkClicks = days.map((day) => linkClicksFromActions(day.actions))
  const formOpens = days.map((day) => countFormOpens(day.actions))
  return {
    id: first.entityId,
    adAccountId: first.adAccountId,
    spend: sumNumbers(days.map((day) => day.spend)),
    impressions: sumNumbers(days.map((day) => day.impressions)),
    leads: sumNumbers(days.map((day) => day.leads)),
    linkClicks: sumNumbers(linkClicks),
    formOpens: sumOptional(formOpens),
    videoP100: sumOptional(days.map((day) => day.videoP100)),
    videoThruPlay: sumOptional(days.map((day) => day.videoThruPlay)),
  }
}

/** Sum days onto one unit per ad. A null field on any day keeps that field null. */
export function aggregateDelivery(days: readonly DeliveryDay[]): FunnelUnit[] {
  const groups = new Map<string, DeliveryDay[]>()
  for (const day of days) {
    const key = `${day.adAccountId}\n${day.entityId}`
    const list = groups.get(key)
    if (list) list.push(day)
    else groups.set(key, [day])
  }
  const units: FunnelUnit[] = []
  for (const group of groups.values()) {
    const unit = sumGroup(group)
    if (unit) units.push(unit)
  }
  return units
}

function addUnits(units: readonly FunnelUnit[], id: string, adAccountId: string): FunnelUnit {
  return {
    id,
    adAccountId,
    spend: sumNumbers(units.map((unit) => unit.spend)),
    impressions: sumNumbers(units.map((unit) => unit.impressions)),
    leads: sumNumbers(units.map((unit) => unit.leads)),
    linkClicks: sumNumbers(units.map((unit) => unit.linkClicks)),
    formOpens: sumOptional(units.map((unit) => unit.formOpens)),
    videoP100: sumOptional(units.map((unit) => unit.videoP100)),
    videoThruPlay: sumOptional(units.map((unit) => unit.videoThruPlay)),
  }
}

/**
 * Turn summed ads into the check input.
 * More than one account and no plan account → mismatch, not a blended winner.
 */
export function buildFunnelInput(
  units: readonly FunnelUnit[],
  plan: DeliverySide | null,
  actual: DeliverySide | null,
): FunnelCheckInput | FunnelCheckResult {
  const stated = planOrNull(plan)
  const accounts = [...new Set(units.map((unit) => unit.adAccountId))]
  if (stated?.adAccountId && !accounts.includes(stated.adAccountId)) {
    return blank(FUNNEL_REASON.plan_actual_mismatch, true)
  }
  if (accounts.length > 1 && stated?.adAccountId == null) {
    return blank(FUNNEL_REASON.plan_actual_mismatch, false)
  }
  const accountId = stated?.adAccountId ?? accounts[0] ?? null
  const inAccount = accountId ? units.filter((unit) => unit.adAccountId === accountId) : []
  if (inAccount.length === 0) return blank(FUNNEL_REASON.missing_data, stated !== null)
  const named = stated?.entityId ?? null
  if (named) {
    const subject = inAccount.find((unit) => unit.id === named)
    if (!subject) return blank(FUNNEL_REASON.plan_actual_mismatch, true)
    return {
      plan: stated,
      actual: sideFor(actual, subject.id, accountId),
      subject,
      peers: inAccount.filter((unit) => unit.id !== subject.id),
    }
  }
  const winner = selectWinner(inAccount, null)
  if (!winner) return blank(FUNNEL_REASON.no_baseline, stated !== null)
  const rest = inAccount.filter((unit) => unit.id !== winner.id)
  if (rest.length === 0) return blank(FUNNEL_REASON.no_baseline, stated !== null)
  return {
    plan: stated,
    actual: sideFor(actual, null, accountId),
    subject: addUnits(rest, 'account-except-winner', accountId ?? ''),
    peers: [winner],
  }
}

function sideFor(actual: DeliverySide | null, entityId: string | null, adAccountId: string | null): DeliverySide {
  return {
    objective: actual?.objective ?? null,
    destinationType: actual?.destinationType ?? null,
    entityId: actual?.entityId ?? entityId,
    adAccountId: actual?.adAccountId ?? adAccountId,
  }
}

export function isFunnelCheckInput(value: unknown): value is FunnelCheckInput {
  if (!value || typeof value !== 'object') return false
  const record = value as FunnelCheckInput
  return isUnit(record.subject) && Array.isArray(record.peers) && record.peers.every(isUnit)
}

function isUnit(value: unknown): value is FunnelUnit {
  if (!value || typeof value !== 'object') return false
  const unit = value as FunnelUnit
  return typeof unit.id === 'string' && unit.id !== '' && typeof unit.adAccountId === 'string'
}

/** Candidate lesson. isActive is false on purpose — write-lesson defaults to true. */
export function toLessonInput(result: FunnelCheckResult): LessonInput | null {
  if (!result.suggestion) return null
  const segment = result.weakestSegment ?? 'mismatch'
  return {
    lessonKey: `ads-funnel-${segment}`,
    scope: 'global',
    flywheel: 'ads',
    lesson: result.suggestion,
    rationale: '这是漏斗体检的候选句，采纳前不进提示词，也不会改投放。',
    confidence: result.strength === 'decided' ? 0.6 : 0.3,
    isActive: false,
    evidence: {
      candidate: true,
      kind: 'candidate',
      reason_code: result.reasonCode,
      verdict: result.verdict,
      strength: result.strength,
      segment: result.weakestSegment,
      form_completion_basis: result.formCompletionBasis,
      video_p100: VIDEO_P100_MEANING,
      video_thruplay: VIDEO_THRUPLAY_MEANING,
    },
  }
}
