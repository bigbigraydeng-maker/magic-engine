/** Words shared by the confirmation card and the page that shows it. No server imports. */

import { BUDGET_CARD_WHAT_PREFIX } from '@/lib/ads-budget-card/copy'
import { isWinnerReelCard } from '@/lib/winner-reel-sync/copy'

export const PAUSED_DRAFT_WHAT = '批准建 Meta 暂停草稿并送审'
export const PAUSE_AD_SET_WHAT = '暂停这个广告组'

export function pausedDraftClickUrl(clientId: string, runId: string, what: string): string {
  const client = encodeURIComponent(clientId)
  const run = encodeURIComponent(runId)
  if (what === PAUSED_DRAFT_WHAT) {
    return `/api/clients/${client}/meta-ads/paused-draft-card/${run}`
  }
  if (what === PAUSE_AD_SET_WHAT) {
    return `/api/clients/${client}/meta-ads/pause-ad-set-card/${run}`
  }
  if (what.startsWith(BUDGET_CARD_WHAT_PREFIX)) {
    return `/api/clients/${client}/meta-ads/budget-cards/${run}`
  }
  if (isWinnerReelCard(what)) {
    return `/api/clients/${client}/meta-ads/winner-reel-cards/${run}`
  }
  return `/api/clients/${client}/confirmation-cards/${run}/decision`
}
