/**
 * Read the budget and schedule an existing ad set already has.
 * Does not create or update anything. Callers use the result for confirmation
 * and cap checks. Draft numbers are not written onto the ad set.
 */

import type { InheritedAdSetSpend } from '@/lib/ads-strategy/ad-draft'
import { assertOwnedByAccount, isMetaObjectId } from './owned-ad-object'

const AD_SET_FIELDS = 'id,account_id,campaign_id,daily_budget,lifetime_budget,start_time,end_time'
const CAMPAIGN_FIELDS = 'id,account_id,daily_budget,lifetime_budget'
const NO_DAILY = 'NEED_CAMPAIGN'

export type SpendRead =
  | { ok: true; campaignId: string; spend: InheritedAdSetSpend }
  | { ok: false; error: string }

export async function readExistingAdSetSpend(
  adSetId: string,
  adAccountId: string,
  accessToken: string,
): Promise<SpendRead> {
  const owned = await assertOwnedByAccount(adSetId, adAccountId, accessToken, AD_SET_FIELDS)
  if (!owned.ok) return owned
  const campaignId = owned.body.campaign_id
  if (!isMetaObjectId(campaignId)) {
    return { ok: false, error: '读不到这个广告组属于哪个系列，没有去建。' }
  }
  const own = inheritedSpendFrom(owned.body, null)
  if (own.ok) return { ok: true, campaignId, spend: own.spend }
  if (own.error !== NO_DAILY) return { ok: false, error: own.error }
  const campaign = await assertOwnedByAccount(campaignId, adAccountId, accessToken, CAMPAIGN_FIELDS)
  if (!campaign.ok) return { ok: false, error: '读不到这个广告组所属系列的预算，没有去建。' }
  const shared = inheritedSpendFrom(owned.body, campaign.body)
  if (!shared.ok) {
    const error = shared.error === NO_DAILY ? '读不到这个广告组每天多少钱，没有去建。' : shared.error
    return { ok: false, error }
  }
  return { ok: true, campaignId, spend: shared.spend }
}

/** Pure. `NEED_CAMPAIGN` means the ad set itself has no daily or lifetime budget. */
export function inheritedSpendFrom(
  adSet: Record<string, unknown>,
  campaign: Record<string, unknown> | null,
): { ok: true; spend: InheritedAdSetSpend } | { ok: false; error: string } {
  const schedule = scheduleOf(adSet.start_time, adSet.end_time)
  if (schedule === 'unreadable') return { ok: false, error: '这个广告组的结束日读不准，没有去建。' }
  const ownDaily = positiveCents(adSet.daily_budget)
  if (ownDaily) return { ok: true, spend: spendRow(ownDaily, schedule) }
  if (positiveCents(adSet.lifetime_budget)) {
    return { ok: false, error: '这个广告组用的是总预算，不是每天多少钱，没有去建。' }
  }
  if (!campaign) return { ok: false, error: NO_DAILY }
  const shared = positiveCents(campaign.daily_budget)
  if (shared) return { ok: true, spend: spendRow(shared, schedule) }
  if (positiveCents(campaign.lifetime_budget)) {
    return { ok: false, error: '这个广告系列用的是总预算，不是每天多少钱，没有去建。' }
  }
  return { ok: false, error: NO_DAILY }
}

function positiveCents(raw: unknown): number | null {
  const text = typeof raw === 'number' && Number.isSafeInteger(raw) ? String(raw) : typeof raw === 'string' ? raw.trim() : ''
  if (!/^\d+$/.test(text)) return null
  const cents = Number(text)
  return cents > 0 ? cents : null
}

function spendRow(
  cents: number,
  schedule: { durationDays: number | null; endTime: string | null },
): InheritedAdSetSpend {
  return { dailyBudget: cents / 100, durationDays: schedule.durationDays, endTime: schedule.endTime }
}

/**
 * Keep the ad set's end_time string exactly. The day count is only a span
 * and is not the schedule identity.
 */
function scheduleOf(
  start: unknown,
  end: unknown,
): { durationDays: number | null; endTime: string | null } | 'unreadable' {
  const endTime = absoluteEnd(end)
  if (endTime === 'unreadable') return 'unreadable'
  if (endTime === null) return { durationDays: null, endTime: null }
  const days = spanDays(start, endTime)
  if (days === 'unreadable') return 'unreadable'
  return { durationDays: days, endTime }
}

function absoluteEnd(end: unknown): string | null | 'unreadable' {
  if (end == null || end === '' || end === '0' || end === 0) return null
  if (typeof end !== 'string' || !Number.isFinite(Date.parse(end))) return 'unreadable'
  return end
}

function spanDays(start: unknown, end: string): number | 'unreadable' {
  if (typeof start !== 'string') return 'unreadable'
  const endMs = Date.parse(end)
  const startMs = Date.parse(start)
  if (!Number.isFinite(startMs) || endMs <= startMs) return 'unreadable'
  const days = Math.round((endMs - startMs) / 86_400_000)
  if (days < 1 || days > 3660) return 'unreadable'
  return days
}
