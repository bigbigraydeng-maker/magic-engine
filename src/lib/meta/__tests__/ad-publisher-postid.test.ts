/**
 * 用已发布的帖子当素材（`postId`）的测试。
 *
 * 守的一条：带 `postId` 的创意走 `object_story_id`，**不带** `object_story_spec` ——
 * 帖子自带内容，没有正文/标题/素材要传。其余路径（无 postId）必须一字不变。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { publishDraftPaused } from '../ad-publisher'
import type { AdDraft } from '@/lib/ads-strategy/ad-draft'

interface Call { url: string; method: string; body: URLSearchParams }
let calls: Call[] = []

/** 记下每次调用，并按 url 决定返回什么。 */
function mockGraph(fail?: { onPath: string }) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const body = new URLSearchParams(String(init?.body ?? ''))
    calls.push({ url, method: init?.method ?? 'GET', body })
    if (fail && url.includes(fail.onPath) && init?.method === 'POST') {
      return { ok: false, status: 400, text: async () => '{"error":{"message":"nope"}}' } as Response
    }
    if (init?.method === 'DELETE') return { ok: true, status: 200, text: async () => '{}' } as Response
    const id = url.includes('/campaigns') ? 'camp1'
      : url.includes('/adsets') ? 'as1'
      : url.includes('/adcreatives') ? 'cr1'
      : 'ad1'
    return { ok: true, status: 200, text: async () => JSON.stringify({ id }) } as Response
  })
}

beforeEach(() => { calls = [] })
afterEach(() => { vi.unstubAllGlobals() })

const POST_DRAFT: AdDraft = {
  kind: 'video_thruplay',
  clientId: 'c1',
  campaignName: 'C',
  adSetName: 'S',
  dailyBudget: 20,
  durationDays: 7,
  geoCountries: ['NZ'],
  pageId: 'p1',
  creatives: [
    { name: 'Reel', primaryText: '', headline: '', postId: 'p1_999' },
  ],
}

const bodyOf = (path: string) => calls.find((c) => c.url.includes(path))!.body

describe('publishDraftPaused — postId 创意走 object_story_id', () => {
  it('创意用 object_story_id，不带 object_story_spec', async () => {
    vi.stubGlobal('fetch', mockGraph())
    const r = await publishDraftPaused(POST_DRAFT, 'act_1', 'tok')
    expect(r.ok).toBe(true)
    const b = bodyOf('/adcreatives')
    expect(b.get('object_story_id')).toBe('p1_999')
    expect(b.has('object_story_spec')).toBe(false)
    expect(b.get('name')).toBe('Reel')
  })

  it('系列 / 组 / 广告三层仍是 PAUSED，组按 THRUPLAY 优化并锁版位', async () => {
    vi.stubGlobal('fetch', mockGraph())
    const r = await publishDraftPaused(POST_DRAFT, 'act_1', 'tok')
    expect(r.ok).toBe(true)

    const statuses = calls
      .filter((c) => c.method === 'POST' && c.body.has('status'))
      .map((c) => c.body.get('status'))
    expect(statuses.length).toBeGreaterThanOrEqual(3)
    expect(statuses.every((s) => s === 'PAUSED')).toBe(true)

    const adset = bodyOf('/adsets')
    expect(adset.get('optimization_goal')).toBe('THRUPLAY')
    const targeting = JSON.parse(adset.get('targeting')!) as { publisher_platforms?: string[] }
    expect(targeting.publisher_platforms).toEqual(['facebook', 'instagram'])
  })
})

describe('publishDraftPaused — 无 postId 的路径一字不变', () => {
  it('video_thruplay 无 postId → 仍走 object_story_spec', async () => {
    vi.stubGlobal('fetch', mockGraph())
    const draft: AdDraft = {
      kind: 'video_thruplay',
      clientId: 'c1',
      campaignName: 'C',
      adSetName: 'S',
      dailyBudget: 20,
      durationDays: 7,
      geoCountries: ['NZ'],
      pageId: 'p1',
      linkUrl: 'https://a.test',
      creatives: [
        { name: 'V', primaryText: 'hello', headline: 'head', videoId: 'v1' },
      ],
    }
    await publishDraftPaused(draft, 'act_1', 'tok')
    const b = bodyOf('/adcreatives')
    expect(b.has('object_story_id')).toBe(false)
    expect(JSON.parse(b.get('object_story_spec')!)).toEqual({
      page_id: 'p1',
      video_data: {
        video_id: 'v1',
        message: 'hello',
        title: 'head',
        call_to_action: { type: 'LEARN_MORE', value: { link: 'https://a.test' } },
      },
    })
  })

  it('lead_form 无 postId → 仍走 object_story_spec 的 link_data', async () => {
    vi.stubGlobal('fetch', mockGraph())
    const draft: AdDraft = {
      kind: 'lead_form',
      clientId: 'c1',
      campaignName: 'C',
      adSetName: 'S',
      dailyBudget: 20,
      durationDays: 7,
      geoCountries: ['NZ'],
      pageId: 'p1',
      leadFormId: 'f1',
      linkUrl: 'https://a.test',
      creatives: [
        { name: 'L', primaryText: 'hi', headline: 'head', imageHash: 'h1' },
      ],
    }
    await publishDraftPaused(draft, 'act_1', 'tok')
    const b = bodyOf('/adcreatives')
    expect(b.has('object_story_id')).toBe(false)
    const spec = JSON.parse(b.get('object_story_spec')!) as {
      link_data: { call_to_action: { type: string } }
    }
    expect(spec.link_data.call_to_action.type).toBe('SIGN_UP')
  })
})

describe('publishDraftPaused — postId 只允许看完视频类', () => {
  it('lead_form 带 postId → 抛错，且没有发过 /adcreatives', async () => {
    vi.stubGlobal('fetch', mockGraph())
    const draft: AdDraft = {
      kind: 'lead_form',
      clientId: 'c1',
      campaignName: 'C',
      adSetName: 'S',
      dailyBudget: 20,
      durationDays: 7,
      geoCountries: ['NZ'],
      pageId: 'p1',
      leadFormId: 'f1',
      linkUrl: 'https://a.test',
      creatives: [
        { name: 'L', primaryText: 'hi', headline: 'head', imageHash: 'h1', postId: 'p1_999' },
      ],
    }
    await expect(publishDraftPaused(draft, 'act_1', 'tok')).rejects.toThrow()
    expect(calls.some((c) => c.url.includes('/adcreatives'))).toBe(false)
  })
})
