/**
 * Confirming a winner-reel card adds paused ads to the existing ad set.
 * It does not create a campaign, change a budget, or turn anything on.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdDraft } from '@/lib/ads-strategy/ad-draft'
import { publishDraftPaused } from '../ad-publisher'

const draft: AdDraft = {
  kind: 'video_thruplay',
  clientId: 'c1',
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

interface Call { url: string; method: string; body: string }

let calls: Call[] = []

function graph(accountId = '1', budget = '2000') {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: String(init?.body ?? '') })
    if (method === 'GET') {
      const json = { account_id: accountId, campaign_id: 'camp9', daily_budget: budget }
      return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) } as Response
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: `ad-${calls.length}` }) } as Response
  })
}

function posts(): Call[] {
  return calls.filter((call) => call.method === 'POST')
}

beforeEach(() => { calls = [] })
afterEach(() => { vi.unstubAllGlobals() })

describe('publishDraftPaused on an existing ad set', () => {
  it('posts one paused ad and does not create a campaign, ad set, or budget', async () => {
    vi.stubGlobal('fetch', graph())
    const result = await publishDraftPaused(draft, 'act_1', 'tok')
    expect(result.ok).toBe(true)
    expect(posts()).toHaveLength(1)
    const body = new URLSearchParams(posts()[0].body)
    expect(posts()[0].url).toContain('/act_1/ads')
    expect(body.get('status')).toBe('PAUSED')
    expect(body.get('adset_id')).toBe('123456')
    expect(body.get('creative')).toBe(JSON.stringify({ object_story_id: '11111_12345678' }))
    expect(body.get('daily_budget')).toBeNull()
    expect(posts().some((call) => call.url.includes('/campaigns') || call.url.includes('/adsets'))).toBe(false)
  })

  it('writes nothing when the ad set belongs to another account', async () => {
    vi.stubGlobal('fetch', graph('999'))
    const result = await publishDraftPaused(draft, 'act_1', 'tok')
    expect(result.ok).toBe(false)
    expect(posts()).toHaveLength(0)
  })

  it('writes nothing when the daily budget no longer matches the card', async () => {
    vi.stubGlobal('fetch', graph('1', '9000'))
    const result = await publishDraftPaused(draft, 'act_1', 'tok')
    expect(result.ok).toBe(false)
    expect(posts()).toHaveLength(0)
  })

  it('writes nothing when the ad set has no daily budget to show', async () => {
    vi.stubGlobal('fetch', graph('1', ''))
    const result = await publishDraftPaused({ ...draft, dailyBudget: 0 }, 'act_1', 'tok')
    expect(result.ok).toBe(false)
    expect(posts()).toHaveLength(0)
  })
})
