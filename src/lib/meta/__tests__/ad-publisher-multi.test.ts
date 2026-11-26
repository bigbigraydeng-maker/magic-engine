/**
 * 多个广告组的「建成暂停」。
 *
 * 守的几条：
 *   1. 一个系列下建多个组，每个组的预算设在组上，全程 PAUSED；
 *   2. 系列花费上限只在草稿给了才传，给了就原样传；
 *   3. 中途失败只回滚本次建出来的系列 / 组 / 广告（逆序），不碰账户里已有的对象；
 *      创意永远不删（Meta 会把内容相同的创意复用成同一个对象，可能正被在投的广告用着）；
 *   4. 单组草稿的请求次数和结果形状不变；
 *   5. 补暂停会把每一个组都停掉。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { publishDraftPaused, pausePublished } from '../ad-publisher'
import type { AdDraft, AdDraftAdSet } from '@/lib/ads-strategy/ad-draft'

const CREATIVE = { name: 'EN', primaryText: 'Shanghai & Beyond', headline: 'Sign up', imageHash: 'h1' }

function set(name: string, dailyBudget: number): AdDraftAdSet {
  return { name, dailyBudget, geoCountries: ['NZ'], ageMin: 35, ageMax: 65, creatives: [{ ...CREATIVE, name: `${name} 广告` }] }
}

const MULTI: AdDraft = {
  kind: 'lead_form',
  clientId: 'c1',
  campaignName: '实验臂2',
  adSetName: '',
  dailyBudget: 30,
  durationDays: 14,
  geoCountries: [],
  pageId: 'p1',
  leadFormId: 'f1',
  creatives: [],
  budgetMode: 'ad_set',
  adSets: [set('组b', 9.5), set('组c', 10), set('组d', 10.5)],
}

const SINGLE: AdDraft = {
  kind: 'lead_form', clientId: 'c1', campaignName: '单组', adSetName: '组a', dailyBudget: 30,
  durationDays: 14, geoCountries: ['NZ'], pageId: 'p1', leadFormId: 'f1', creatives: [CREATIVE],
}

interface Call { url: string; method: string; body: URLSearchParams }
let calls: Call[] = []

/** 每次建东西返回递增的 id（camp1 / as1.. / cr1.. / ad1..）；可以让第 n 次「建组」失败。 */
function mockGraph(opts: {
  failAdSetNumber?: number
  /** 所有「建创意」都返回同一个编号（Meta 对内容相同的创意复用同一个对象），删它会被 Meta 拒。 */
  reuseCreativeId?: string
  /** 第 n 次「建创意」像断网一样抛错（不知道 Meta 建成没有）。 */
  throwOnCreativeNumber?: number
} = {}) {
  const counters = { campaigns: 0, adsets: 0, adcreatives: 0, ads: 0 }
  const prefix = { campaigns: 'camp', adsets: 'as', adcreatives: 'cr', ads: 'ad' } as const
  return vi.fn(async (url: string, init?: RequestInit) => {
    const body = new URLSearchParams(String(init?.body ?? ''))
    calls.push({ url, method: init?.method ?? 'GET', body })
    if (init?.method === 'DELETE') {
      if (opts.reuseCreativeId && url.includes(opts.reuseCreativeId)) {
        return { ok: false, status: 400, text: async () => '{"error":{"code":1487235,"message":"in use"}}' } as Response
      }
      return { ok: true, status: 200, text: async () => '{}' } as Response
    }
    const kind = (['campaigns', 'adsets', 'adcreatives', 'ads'] as const).find((k) => url.includes(`/${k}`))!
    counters[kind] += 1
    if (kind === 'adcreatives' && opts.throwOnCreativeNumber === counters.adcreatives) {
      throw new Error('The operation was aborted due to timeout')
    }
    if (kind === 'adcreatives' && opts.reuseCreativeId) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: opts.reuseCreativeId }) } as Response
    }
    if (kind === 'adsets' && opts.failAdSetNumber === counters.adsets) {
      return { ok: false, status: 400, text: async () => '{"error":{"message":"nope"}}' } as Response
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: `${prefix[kind]}${counters[kind]}` }) } as Response
  })
}

/** 按路径结尾匹配（`/ads` 不能把 `/adsets` 也算进来）；空串 = 所有 POST。 */
const posts = (part: string) => calls.filter((c) => c.method === 'POST' && c.url.endsWith(part))

beforeEach(() => { calls = [] })
afterEach(() => { vi.unstubAllGlobals() })

describe('多个广告组：一个系列、每组各自预算，全程暂停', () => {
  it('建 1 个系列、3 个组、3 条创意、3 条广告；每个组预算设在组上（分），全是 PAUSED', async () => {
    vi.stubGlobal('fetch', mockGraph())
    const r = await publishDraftPaused(MULTI, 'act_1', 'tok')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(posts('/campaigns')).toHaveLength(1)
    expect(posts('/adsets')).toHaveLength(3)
    expect(posts('/adcreatives')).toHaveLength(3)
    expect(posts('/ads')).toHaveLength(3)
    expect(posts('/adsets').map((c) => c.body.get('daily_budget'))).toEqual(['950', '1000', '1050'])
    expect(posts('/adsets').map((c) => c.body.get('name'))).toEqual(['组b', '组c', '组d'])
    for (const c of [...posts('/campaigns'), ...posts('/adsets'), ...posts('/ads')]) {
      expect(c.body.get('status')).toBe('PAUSED')
    }
    expect(r.adSetIds).toEqual(['as1', 'as2', 'as3'])
    expect(r.adSetId).toBe('as1')
    expect(r.adIds).toEqual(['ad1', 'ad2', 'ad3'])
  })

  it('每个组的广告挂在它自己的组下，所有组都挂在同一个系列下', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await publishDraftPaused(MULTI, 'act_1', 'tok')
    expect(posts('/adsets').every((c) => c.body.get('campaign_id') === 'camp1')).toBe(true)
    expect(posts('/ads').map((c) => c.body.get('adset_id'))).toEqual(['as1', 'as2', 'as3'])
  })

  it('每个组的年龄和国家都按组自己写的传（35–65、NZ），不是默认值', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await publishDraftPaused(MULTI, 'act_1', 'tok')
    for (const c of posts('/adsets')) {
      const t = JSON.parse(c.body.get('targeting')!)
      expect(t.age_min).toBe(35)
      expect(t.age_max).toBe(65)
      expect(t.geo_locations.countries).toEqual(['NZ'])
      expect(t.targeting_automation).toEqual({ advantage_audience: 0 })
    }
  })
})

describe('系列花费上限 spend_cap', () => {
  it('草稿给了就原样传给系列（分）', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await publishDraftPaused({ ...MULTI, campaignSpendCapMinor: 42000 }, 'act_1', 'tok')
    expect(posts('/campaigns')[0].body.get('spend_cap')).toBe('42000')
  })

  it('草稿没给就不传这个字段（和以前一样）', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await publishDraftPaused(MULTI, 'act_1', 'tok')
    expect(posts('/campaigns')[0].body.has('spend_cap')).toBe(false)
  })
})

describe('中途失败：只回滚本次建出来的，逆序', () => {
  it('第 2 个组建失败 → 按逆序删本次建出的广告、第 1 组、系列（创意不删）；不碰别的编号', async () => {
    vi.stubGlobal('fetch', mockGraph({ failAdSetNumber: 2 }))
    const r = await publishDraftPaused(MULTI, 'act_1', 'tok')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.step).toBe('adset')
    const deleted = calls.filter((c) => c.method === 'DELETE').map((c) => c.url.split('?')[0].split('/').pop())
    expect(deleted).toEqual(['ad1', 'as1', 'camp1'])
    expect(r.orphans).toEqual([])
    expect(posts('/adsets')).toHaveLength(2)
    expect(posts('/adcreatives')).toHaveLength(1)
  })

  it('3 个组共用同一个创意编号、第 3 个组建失败 → 一次都不去删那个创意，孤儿名单里也没有它', async () => {
    const SHARED = '2210869679828612'
    vi.stubGlobal('fetch', mockGraph({ failAdSetNumber: 3, reuseCreativeId: SHARED }))
    const r = await publishDraftPaused(MULTI, 'act_1', 'tok')
    expect(r.ok).toBe(false)
    if (r.ok) return
    const deleted = calls.filter((c) => c.method === 'DELETE').map((c) => c.url.split('?')[0].split('/').pop())
    expect(deleted).toEqual(['ad2', 'as2', 'ad1', 'as1', 'camp1'])
    expect(calls.some((c) => c.url.includes(SHARED) && c.method === 'DELETE')).toBe(false)
    expect(r.orphans).toEqual([])
    expect(r.orphans.join('')).not.toContain(SHARED)
  })

  it('建创意时断网（不知道建成没有）→ 回滚已建的；孤儿名单里不出现「创意」', async () => {
    vi.stubGlobal('fetch', mockGraph({ throwOnCreativeNumber: 2 }))
    const r = await publishDraftPaused(MULTI, 'act_1', 'tok')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.step).toBe('creative')
    expect(r.orphans.join('')).not.toContain('创意')
    expect(r.orphans).toEqual([])
    const deleted = calls.filter((c) => c.method === 'DELETE').map((c) => c.url.split('?')[0].split('/').pop())
    expect(deleted).toEqual(['as2', 'ad1', 'as1', 'camp1'])
  })
})

describe('单组草稿：请求次数和结果形状不变', () => {
  it('1 系列 + 1 组 + 1 创意 + 1 广告；adSetIds 只有一个、等于 adSetId', async () => {
    vi.stubGlobal('fetch', mockGraph())
    const r = await publishDraftPaused(SINGLE, 'act_1', 'tok')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(4)
    expect(r.adSetIds).toEqual([r.adSetId])
    expect(posts('/adsets')[0].body.get('daily_budget')).toBe('3000')
  })
})

describe('补暂停：每一个组都要停', () => {
  it('给了 adSetIds 就把所有组、所有广告、系列都暂停；重复的编号只停一次', async () => {
    vi.stubGlobal('fetch', mockGraph())
    const r = await pausePublished(
      { campaignId: 'camp1', adSetId: 'as1', adSetIds: ['as1', 'as2', 'as3'], adIds: ['ad1', 'ad2', 'ad3'] },
      'tok',
    )
    expect(r).toEqual({ ok: true, failed: [] })
    const paused = posts('').map((c) => c.url.split('/').pop()).sort()
    expect(paused).toEqual(['ad1', 'ad2', 'ad3', 'as1', 'as2', 'as3', 'camp1'])
    expect(posts('').every((c) => c.body.get('status') === 'PAUSED')).toBe(true)
  })

  it('没给 adSetIds（旧调用方）：和以前一样，只停 adSetId 一个组', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await pausePublished({ campaignId: 'camp1', adSetId: 'as1', adIds: ['ad1'] }, 'tok')
    expect(posts('').map((c) => c.url.split('/').pop()).sort()).toEqual(['ad1', 'as1', 'camp1'])
  })
})
