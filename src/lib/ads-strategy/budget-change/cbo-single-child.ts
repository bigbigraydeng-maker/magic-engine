/**
 * 系列预算（CBO）只在「系列下恰好一个在投广告组」时能按单组信号加（内核 ads.scale_unit_budget 的要求，
 * `envelope-facts.ts` 同一判据）。O1 路由和成绩单调预算共用这一份，免得两处各写一份分家（子牙 11-04）。
 *
 * 当场读 Meta 完整列表（快照是增量的，没变的组这一轮可能没有行）；读不全、有组归属或状态认不出 → 判不了。
 */
import { listAdSetsInCampaign } from '@/lib/meta/adsets'
import { DELIVERING_STATUSES } from '@/lib/ads-strategy/portfolio/diagnostics/context'

const KNOWN_ADSET_STATUSES = new Set([
  'ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED', 'PENDING_REVIEW', 'DISAPPROVED',
  'PREAPPROVED', 'PENDING_BILLING_INFO', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED',
  'IN_PROCESS', 'WITH_ISSUES', 'INACTIVE',
])

export type SingleChildResult =
  | { readonly ok: true; readonly adsetId: string }
  | { readonly ok: false; readonly reason: 'unreadable' | 'unknown_child' | 'not_single'; readonly detail: string; readonly deliveringCount: number | null }

export async function findSingleDeliveringChild(
  campaignId: string, adAccountId: string, accessToken: string,
): Promise<SingleChildResult> {
  const siblings = await listAdSetsInCampaign(campaignId, accessToken)
  if (!siblings) return { ok: false, reason: 'unreadable', detail: '无法完整读取该系列下的广告组', deliveringCount: null }
  const bareAccount = adAccountId.replace(/^act_/, '')
  if (siblings.some(row => row.account_id !== bareAccount || !KNOWN_ADSET_STATUSES.has(row.effective_status ?? ''))) {
    return { ok: false, reason: 'unknown_child', detail: '该系列有广告组归属或投放状态无法确认', deliveringCount: null }
  }
  const delivering = siblings.filter(row => DELIVERING_STATUSES.has(row.effective_status ?? ''))
  if (delivering.length !== 1 || !delivering[0]) {
    return { ok: false, reason: 'not_single', detail: `该系列下有 ${delivering.length} 个在投广告组`, deliveringCount: delivering.length }
  }
  return { ok: true, adsetId: delivering[0].id }
}
