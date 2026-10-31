/**
 * Facts for the paused-draft confirmation card.
 * Pure: no Meta calls, no database. Out of range stays a failed check.
 */

import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'
import type { AccountCapFacts } from '@/lib/marketing-plan/promo/budget-caps'
import { confirmBlockReason, contentFingerprint, type CardFacts, type HardCheck } from '@/lib/confirmation-card/facts'
import { MAX_AD_SETS, type AdDraft } from './ad-draft'
import { draftNotYetBuildable, reviewDraftAgainstCaps, reviewDraftForBuild } from './ad-draft-expansion'
import { PAUSED_DRAFT_WHAT } from './paused-draft-copy'

export const PAUSED_DRAFT_SUBJECT_PREFIX = 'meta-paused-draft:'
export const PAUSED_DRAFT_HOLD = 'ads.paused_draft_hold'

export interface PausedDraftReview {
  readonly adAccountId: string
  /** null = the cap list did not load. An empty list loaded and is empty. */
  readonly accounts: readonly AccountCapFacts[] | null
  readonly clientCapCents: number | null
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
    date: `一共 ${durationDays(draft)} 天，从点确认当天算起`,
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
  return [reviewCheck(draft), capCheck(draft, review), countCheck(draft), buildableCheck(draft)]
}

function reviewCheck(draft: AdDraft): HardCheck {
  const problems = reviewDraftForBuild(draft)
  if (problems.length === 0) return { label: '建前复核', state: 'green', reason: '' }
  return { label: '建前复核', state: 'red', reason: clip(problems[0]?.message ?? '复核没通过') }
}

function capCheck(draft: AdDraft, review: PausedDraftReview): HardCheck {
  if (!review.accounts) return { label: '日预算上限', state: 'unread', reason: '上限没读到' }
  const known = review.accounts.some((account) => account.ad_account_id === review.adAccountId && account.owned_by_client)
  if (!known) return { label: '日预算上限', state: 'unread', reason: '广告账户没读到' }
  const verdict = reviewDraftAgainstCaps(draft, review.adAccountId, review.accounts, review.clientCapCents)
  if (verdict.verdict === 'ok') return { label: '日预算上限', state: 'green', reason: '' }
  if (verdict.verdict === 'unknown') return { label: '日预算上限', state: 'unread', reason: '上限没核成' }
  return { label: '日预算上限', state: 'red', reason: '每天要花的超过了这张卡上的上限' }
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
  const daily = money(draft.dailyBudget)
  const cap = capMajor(review)
  if (!cap) return `每天 ${daily}，上限读不到`
  return `每天 ${daily} ${cap.currency}，上限 ${cap.amount} ${cap.currency}`
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
