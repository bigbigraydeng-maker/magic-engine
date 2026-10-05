import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { publishDraftPaused } from '@/lib/meta/ad-publisher'
import type { AdDraft } from '@/lib/ads-strategy/ad-draft'
import { checkLaunch, type LaunchReadbackInput } from '@/lib/ads-strategy/launch-readback'
import { adaptMetaAdSet, type RawMetaTargeting } from '@/lib/ads-strategy/meta-readback-adapter'

const DRAFT: AdDraft = {
  kind: 'lead_form', clientId: 'c1', campaignName: '留资', adSetName: '买家',
  dailyBudget: 30, durationDays: 7, geoCountries: ['NZ'], pageId: 'p1', leadFormId: 'f1',
  linkUrl: 'https://example.co.nz',
  creatives: [{ name: 'EN', primaryText: 'Brand new home', headline: 'Book', imageHash: 'h1' }],
}

interface Call { url: string; method: string; body: URLSearchParams }
let calls: Call[] = []

/** 记下每次调用，并按 url 决定返回什么。 */
function mockGraph() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const body = new URLSearchParams(String(init?.body ?? ''))
    calls.push({ url, method: init?.method ?? 'GET', body })
    const id = url.includes('/campaigns') ? 'camp1'
      : url.includes('/adsets') ? 'as1'
      : url.includes('/adcreatives') ? 'cr1'
      : 'ad1'
    return { ok: true, status: 200, text: async () => JSON.stringify({ id }) } as Response
  })
}

beforeEach(() => { calls = [] })
afterEach(() => { vi.unstubAllGlobals() })

const targetingOf = () => JSON.parse(calls.find((c) => c.url.includes('/adsets'))!.body.get('targeting')!)

describe('建广告组：看完类视频必须锁版位', () => {
  it('看完类视频 → 版位锁死 facebook + instagram', async () => {
    vi.stubGlobal('fetch', mockGraph())
    const video = { name: 'V', primaryText: 'x', headline: 'y', videoId: 'v1' }
    await publishDraftPaused({ ...DRAFT, kind: 'video_thruplay', creatives: [video] }, 'act_1', 'tok')
    expect(targetingOf().publisher_platforms).toEqual(['facebook', 'instagram'])
  })

  it('留资广告不受影响 —— 版位不写，交给 Meta 默认', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await publishDraftPaused(DRAFT, 'act_1', 'tok')
    expect(targetingOf().publisher_platforms).toBeUndefined()
  })
})

const input = (goal: string, platforms?: string[]): LaunchReadbackInput => ({
  adSet: {
    adSetId: 'AS1', adSetName: 'ThruPlay 测试', optimizationGoal: goal,
    targeting: { geoNames: ['Auckland Region'], ...(platforms ? { publisherPlatforms: platforms } : {}) },
    creatives: [{ adId: 'A1', adName: 'EN', buyerFacingText: ['Watch our story'] }],
  },
})

const codes = (i: LaunchReadbackInput) => checkLaunch(i).findings.map((f) => f.code)

describe('回读闸门：看完类视频版位', () => {
  it('🔴 自动版位（没读到版位）→ blocker，且说清是自动版位', () => {
    const r = checkLaunch(input('THRUPLAY'))
    expect(r.findings.map((f) => f.code)).toContain('playback_placement_not_locked')
    expect(r.safeToActivate).toBe(false)
    expect(r.findings.find((f) => f.code === 'playback_placement_not_locked')!.message).toContain('自动版位')
  })

  it('🔴 混进 Audience Network → blocker', () => {
    const r = checkLaunch(input('THRUPLAY', ['facebook', 'instagram', 'audience_network']))
    expect(r.safeToActivate).toBe(false)
    expect(r.findings.find((f) => f.code === 'playback_placement_not_locked')!.message).toContain('Audience Network')
  })

  it('🔴 只锁 facebook 不够 —— 必须正好 facebook + instagram', () => {
    expect(codes(input('VIDEO_VIEWS', ['facebook']))).toContain('playback_placement_not_locked')
  })

  it('顺序反了也算锁对', () => {
    const i = input('THRUPLAY', ['instagram', 'facebook'])
    expect(codes(i)).not.toContain('playback_placement_not_locked')
    expect(checkLaunch(i).safeToActivate).toBe(true)
  })

  it('非看完类目标不拿这条去要求它', () => {
    for (const goal of ['LEAD_GENERATION', 'CONVERSATIONS']) {
      expect(codes(input(goal)), goal).not.toContain('playback_placement_not_locked')
      expect(checkLaunch(input(goal)).safeToActivate, goal).toBe(true)
    }
  })

  it('🔴 空数组不是「锁好了」→ blocker', () => {
    expect(codes(input('THRUPLAY', []))).toContain('playback_placement_not_locked')
  })
})

describe('回读适配器 → 闸门（端到端）', () => {
  const raw = (targeting?: RawMetaTargeting) => ({
    id: '1', name: '养受众', optimization_goal: 'THRUPLAY', targeting,
  })
  const creatives = [{ adId: 'a', adName: 'EN', texts: ['Watch our story'] }]

  it('适配器读出版位 → 闸门放行', () => {
    const t = { geo_locations: { countries: ['NZ'] }, publisher_platforms: ['facebook', 'instagram'] }
    expect(checkLaunch(adaptMetaAdSet(raw(t), creatives)).safeToActivate).toBe(true)
  })

  it('🔴 没读到版位 → 闸门拦下', () => {
    const r = checkLaunch(adaptMetaAdSet(raw({ geo_locations: { countries: ['NZ'] } }), creatives))
    expect(r.safeToActivate).toBe(false)
    expect(r.findings.map((f) => f.code)).toContain('playback_placement_not_locked')
  })

  it('🔴 整个 targeting 读不到 → 读不到就是不安全', () => {
    const r = checkLaunch(adaptMetaAdSet(raw(undefined), creatives))
    expect(r.safeToActivate).toBe(false)
  })
})
