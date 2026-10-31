/**
 * After a paused ad is created from an existing page post, record which ME
 * creative it came from. Linking never throws: a missing link must not cause
 * a second create.
 */

import type { AdDraft } from '@/lib/ads-strategy/ad-draft'
import { linkAdToCreative } from './creative-link'

export async function linkPromotedAds(draft: AdDraft, adIds: readonly string[]): Promise<void> {
  if (!draft.existingAdSetId) return
  for (let i = 0; i < adIds.length; i += 1) {
    const story = draft.creatives[i]?.promotedPostId
    const adId = adIds[i]
    if (!story || !adId) continue
    const cut = story.indexOf('_')
    if (cut <= 0) continue
    await linkAdToCreative({
      clientId: draft.clientId,
      adId,
      pageId: story.slice(0, cut),
      postId: story.slice(cut + 1),
      createdBy: 'winner_reel_sync',
    })
  }
}
