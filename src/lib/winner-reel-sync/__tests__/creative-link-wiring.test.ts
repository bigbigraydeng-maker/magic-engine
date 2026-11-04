/**
 * The link from a new ad back to the ME creative is recorded when the paused
 * ad is actually created (after the confirmation card), not while the card is
 * only being asked for.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const linkAdToCreative = vi.fn()

vi.mock('@/lib/ads/creative-link', () => ({
  linkAdToCreative: (...args: unknown[]) => linkAdToCreative(...args),
}))

import { linkPromotedAds } from '@/lib/ads/link-promoted-posts'
import type { AdDraft } from '@/lib/ads-strategy/ad-draft'

const draft: AdDraft = {
  kind: 'video_thruplay',
  clientId: 'client-1',
  campaignName: '赢家素材暂停草稿',
  adSetName: 'Pool',
  dailyBudget: 20,
  durationDays: 0,
  geoCountries: [],
  pageId: '11111',
  existingAdSetId: '123456',
  creatives: [{
    name: 'Reel',
    primaryText: 'hello world reel',
    headline: 'hello world reel',
    promotedPostId: '11111_12345678',
  }],
}

beforeEach(() => {
  linkAdToCreative.mockReset().mockResolvedValue({ creativeRef: 'wo-1' })
})

describe('paused post promotion records the creative link at create time', () => {
  it('uses the new ad id and the page post, and does not guess', async () => {
    await linkPromotedAds(draft, ['ad-1'])
    expect(linkAdToCreative).toHaveBeenCalledTimes(1)
    expect(linkAdToCreative.mock.calls[0][0]).toMatchObject({
      clientId: 'client-1',
      adId: 'ad-1',
      postId: '12345678',
      pageId: '11111',
      createdBy: 'winner_reel_sync',
    })
  })

  it('the scan does not link, because it does not create the ad', () => {
    const engine = readFileSync(join(process.cwd(), 'src/lib/winner-reel-sync/engine.ts'), 'utf8')
    expect(engine).not.toContain('linkAdToCreative')
    expect(engine).not.toContain('createAdFromPost')
    const gate = readFileSync(join(process.cwd(), 'src/lib/ads-strategy/draft-and-gate.ts'), 'utf8')
    expect(gate).toContain('linkPromotedAds')
  })
})
