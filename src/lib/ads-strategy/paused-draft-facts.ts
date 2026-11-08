/**
 * Facts for the paused-draft confirmation card.
 * Pure: no Meta calls, no database. Out of range stays a failed check.
 */

import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'
import type { AccountCapFacts } from '@/lib/marketing-plan/promo/budget-caps'
import { confirmBlockReason, contentFingerprint, type CardFacts, type HardCheck } from '@/lib/confirmation-card/facts'
import {
  isKnownDraftKind,
  MAX_AD_SETS,
  metaTripletFor,
  type AdDraft,
  inheritedSpendOf,
  inheritedScheduleText,
  draftUsingInheritedBudget,
} from './ad-draft'
import { draftNotYetBuildable, reviewDraftAgainstCaps, reviewDraftForBuild } from './ad-draft-expansion'
import { PAUSED_DRAFT_WHAT } from './paused-draft-copy'

export const PAUSED_DRAFT_SUBJECT_PREFIX = 'meta-paused-draft:'
export const PAUSED_DRAFT_HOLD = 'ads.paused_draft_hold'

export interface CampaignShape {
  readonly entityId: string
  readonly objective: string | null
  readonly budgetLevel: 'cbo' | 'abo' | null
}

export interface PausedDraftReview {
  readonly adAccountId: string
  /** null = the cap list did not load. An empty list loaded and is empty. */
  readonly accounts: readonly AccountCapFacts[] | null
  readonly clientCapCents: number | null
  /** null = delivering daily spend was not read. 0 = read, nothing is delivering. */
  readonly liveDeliveringCents: number | null
  /** null = campaign snapshots were not read. Empty = read, no campaigns. */
  readonly campaignShapes: readonly CampaignShape[] | null
}

export interface PriorPausedFailure {
  readonly fingerprint: string
  readonly errorClass: string
}

export function pausedDraftSubjectKey(draft: AdDraft): string {
  const names = Array.isArray(draft.adSets) ? draft.adSets.map((set) => set.name) : [draft.adSetName]
  const hash = canonicalHashOfInput({
    clientId: draft.clientId,
    kind: draft.kind,
    campaignName: draft.campaignName,
    names,
  }).slice(0, 12)
  return `${PAUSED_DRAFT_SUBJECT_PREFIX}${hash}`
}

export function pausedDraftFacts(
  draft: AdDraft,
  accountLabel: string,
  review: PausedDraftReview,
): CardFacts {
  return {
    subjectKey: pausedDraftSubjectKey(draft),
    what: PAUSED_DRAFT_WHAT,
    account: safeLabel(accountLabel),
    amount: amountLine(draft, review),
    date: dateLine(draft),
    scope: scopeLine(draft),
    hardChecks: hardChecks(draft, review),
  }
}

export function pausedDraftFingerprint(draft: AdDraft, accountLabel: string, review: PausedDraftReview): string {
  return contentFingerprint(pausedDraftFacts(draft, accountLabel, review))
}

export function pausedDraftBlock(draft: AdDraft, accountLabel: string, review: PausedDraftReview): string | null {
  return confirmBlockReason(pausedDraftFacts(draft, accountLabel, review).hardChecks)
}

/** Same unchanged draft is not sent again. A second hit of one error class stops. */
export function pausedDraftRetry(
  prior: readonly PriorPausedFailure[],
  fingerprint: string,
): 'allow' | 'same' | 'escalate' {
  if (prior.length === 0) return 'allow'
  if (prior.some((row) => row.fingerprint === fingerprint)) return 'same'
  const latest = prior[prior.length - 1]?.errorClass
  const repeats = prior.filter((row) => row.errorClass === latest).length
  return repeats >= 2 ? 'escalate' : 'allow'
}

export function metaErrorClass(error: string): string {
  const code = error.match(/\b(\d{3,6})\b/)
  return code ? `meta-${code[1]}` : 'meta-other'
}

export function plainMetaError(error: string): string {
  const cleaned = error.replace(/access_token=[^\s&]+/gi, '').replace(/\s+/g, ' ').trim()
  return `Meta 没有收下这份暂停草稿：${cleaned.slice(0, 140)}`
}

function hardChecks(draft: AdDraft, review: PausedDraftReview): HardCheck[] {
  const checks = [reviewCheck(draft), capCheck(draft, review), countCheck(draft), buildableCheck(draft)]
  const campaign = campaignCheck(draft, review)
  if (campaign) checks.push(campaign)
  return checks
}

function reviewCheck(draft: AdDraft): HardCheck {
  const problems = reviewDraftForBuild(draft)
  if (problems.length === 0) return { label: '建前复核', state: 'green', reason: '' }
  return { label: '建前复核', state: 'red', reason: clip(problems[0]?.message ?? '复核没通过') }
}

function capCheck(draft: AdDraft, review: PausedDraftReview): HardCheck {
  if (draft.existingAdSetId && !inheritedSpendOf(draft)) {
    return { label: '日预算上限', state: 'unread', reason: '还没读到这个广告组的真实每天预算' }
  }
  if (!review.accounts) return { label: '日预算上限', state: 'unread', reason: '上限没读到' }
  const known = review.accounts.some((account) => account.ad_account_id === review.adAccountId && account.owned_by_client)
  if (!known) return { label: '日预算上限', state: 'unread', reason: '广告账户没读到' }
  const live = Object.prototype.hasOwnProperty.call(review, 'liveDeliveringCents')
    ? review.liveDeliveringCents
    : null
  const verdict = reviewDraftAgainstCaps(
    draftUsingInheritedBudget(draft),
    review.adAccountId,
    review.accounts,
    review.clientCapCents,
    live,
  )
  if (verdict.verdict === 'ok') return { label: '日预算上限', state: 'green', reason: '' }
  if (verdict.verdict === 'unknown') {
    const unreadLive = verdict.reasons.some((reason) => reason.includes('已在投'))
    return { label: '日预算上限', state: 'unread', reason: unreadLive ? '读不到在投预算' : '上限没核成' }
  }
  return { label: '日预算上限', state: 'red', reason: '已在投的日预算加上这份草稿，超过了上限' }
}

function campaignCheck(draft: AdDraft, review: PausedDraftReview): HardCheck | null {
  if (!draft.existingCampaignId) return null
  const shape = review.campaignShapes?.find((row) => row.entityId === draft.existingCampaignId)
  if (!review.campaignShapes || !shape?.objective || !shape.budgetLevel) {
    return { label: '系列目标和预算', state: 'unread', reason: '这个系列的目标或预算方式没读到' }
  }
  if (shape.budgetLevel === 'cbo') {
    return {
      label: '系列目标和预算',
      state: 'red',
      reason: '这个系列用的是系列预算，这次不能加一个自己带日预算的广告组',
    }
  }
  if (!isKnownDraftKind(draft.kind) || metaTripletFor(draft.kind).objective !== shape.objective) {
    return { label: '系列目标和预算', state: 'red', reason: '系列目标和这份草稿不一致' }
  }
  return { label: '系列目标和预算', state: 'green', reason: '' }
}

function countCheck(draft: AdDraft): HardCheck {
  const count = adSetCount(draft)
  if (count >= 1 && count <= MAX_AD_SETS) return { label: '系列数量', state: 'green', reason: '' }
  return { label: '系列数量', state: 'red', reason: '广告组数量不在允许范围内' }
}

function buildableCheck(draft: AdDraft): HardCheck {
  if (!draftNotYetBuildable(draft)) return { label: '能按草稿建成暂停', state: 'green', reason: '' }
  return { label: '能按草稿建成暂停', state: 'red', reason: '这份草稿现在还不能原样建成暂停' }
}

function amountLine(draft: AdDraft, review: PausedDraftReview): string {
  const daily = shownDaily(draft)
  const cap = capMajor(review)
  if (daily === null) return '每天多少要等读到这个广告组'
  if (!cap) return `每天 ${money(daily)}，上限读不到`
  return `每天 ${money(daily)} ${cap.currency}，上限 ${cap.amount} ${cap.currency}`
}

function capMajor(review: PausedDraftReview): { amount: string; currency: string } | null {
  const row = review.accounts?.find((account) => account.ad_account_id === review.adAccountId)
  if (!row?.currency || row.daily_cap_cents === null) return null
  return { amount: (row.daily_cap_cents / 100).toFixed(2), currency: row.currency }
}

function adSetCount(draft: AdDraft): number {
  return Array.isArray(draft.adSets) ? draft.adSets.length : 1
}

function scopeLine(draft: AdDraft): string {
  const mark = draftMark(draft)
  if (draft.existingAdSetId) return `在已有广告组里加暂停广告，不新建系列、不开。稿 ${mark}`
  if (draft.existingCampaignId) return `在已有系列里加 1 个暂停广告组，不新建系列、不开。稿 ${mark}`
  return `1 个暂停系列，${adSetCount(draft)} 个广告组，不开启。稿 ${mark}`
}

function dateLine(draft: AdDraft): string {
  if (draft.existingAdSetId) {
    const spend = inheritedSpendOf(draft)
    if (!spend) return '结束日读不到'
    return inheritedScheduleText(spend)
  }
  return `一共 ${durationDays(draft)} 天，从点确认当天算起`
}

function shownDaily(draft: AdDraft): number | null {
  if (!draft.existingAdSetId) return draft.dailyBudget
  return inheritedSpendOf(draft)?.dailyBudget ?? null
}

function durationDays(draft: AdDraft): number {
  return Number.isInteger(draft.durationDays) && draft.durationDays > 0 ? draft.durationDays : 0
}

function money(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '读不到'
}

function draftMark(draft: AdDraft): string {
  return canonicalHashOfInput(draft).slice(0, 8)
}

function safeLabel(label: string): string {
  const text = label.trim()
  if (!text || text.length > 80 || /[{}[\]`]/.test(text) || /\d{10,}/.test(text)) {
    return '这位客户的广告账户'
  }
  return text
}

function clip(message: string): string {
  return message.replace(/[{}[\]`]/g, '').trim().slice(0, 80) || '复核没通过'
}
