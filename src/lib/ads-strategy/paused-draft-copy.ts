/** Words shared by the confirmation card and the page that shows it. No server imports. */

import { BUDGET_CARD_WHAT_PREFIX } from '@/lib/ads-budget-card/copy'
import { isCreativeStateCard } from '@/lib/creative-state/copy'
import { isWinnerReelCard } from '@/lib/winner-reel-sync/copy'

export const PAUSED_DRAFT_WHAT = '批准建 Meta 暂停草稿并送审'
export const PAUSE_AD_SET_WHAT = '暂停这个广告组'
export const CAMPAIGN_PAUSE_WHAT = '暂停这个广告系列'
export const CAMPAIGN_RESUME_WHAT = '恢复这个广告系列'
export const VIDEO_UPLOAD_WHAT = '把这条成片传到广告账户'
export const GO_LIVE_WHAT = '开投：把暂停的广告改成在投'
export const GO_LIVE_CONFIRM_HREF = '/dashboard/ad-approval'
export const GO_LIVE_CONFIRM_LABEL = '去 等你点头的广告 页确认'

export function pausedDraftClickUrl(clientId: string, runId: string, what: string): string {
  const client = encodeURIComponent(clientId)
  const run = encodeURIComponent(runId)
  if (what === PAUSED_DRAFT_WHAT) {
    return `/api/clients/${client}/meta-ads/paused-draft-card/${run}`
  }
  if (what === PAUSE_AD_SET_WHAT) {
    return `/api/clients/${client}/meta-ads/pause-ad-set-card/${run}`
  }
  if (what === CAMPAIGN_PAUSE_WHAT || what === CAMPAIGN_RESUME_WHAT) {
    return `/api/clients/${client}/meta-ads/campaign-status-card/${run}`
  }
  if (what === VIDEO_UPLOAD_WHAT) {
    return `/api/clients/${client}/meta-ads/video-upload-card/${run}`
  }
  if (what.startsWith(BUDGET_CARD_WHAT_PREFIX)) {
    return `/api/clients/${client}/meta-ads/budget-cards/${run}`
  }
  if (isWinnerReelCard(what)) {
    return `/api/clients/${client}/meta-ads/winner-reel-cards/${run}`
  }
  if (isCreativeStateCard(what)) {
    return `/api/clients/${client}/meta-ads/creative-state-cards/${run}`
  }
  if (what === GO_LIVE_WHAT) return GO_LIVE_CONFIRM_HREF
  return `/api/clients/${client}/confirmation-cards/${run}/decision`
}
