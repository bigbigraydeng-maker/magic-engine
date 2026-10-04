import { describe, it, expect } from 'vitest'
import { computeMetaFingerprint, diffMetaFingerprint, type MetaFingerprint } from '../meta-fingerprint'

function isRec(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 把宽松的测试数据收窄成严格类型再算指纹（用类型收窄，不用强转）。 */
function fp(r: Record<string, unknown>): MetaFingerprint {
  const { campaign, adSet, ads } = r
  if (!isRec(campaign) || !isRec(adSet) || !Array.isArray(ads)) throw new Error('测试数据结构不对')
  return computeMetaFingerprint({ campaign, adSet, ads: ads.filter(isRec) })
}

/** 构造一份完整的原始数据（可变对象，不用类型强转）。 */
function raw(): Record<string, unknown> {
  return {
    campaign: {
      id: 'c1',
      objective: 'OUTCOME_ENGAGEMENT',
      spend_cap: null,
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      daily_budget: null,
      lifetime_budget: null,
      status: 'PAUSED',
      name: 'camp',
    },
    adSet: {
      id: 's1',
      name: 'set',
      status: 'PAUSED',
      daily_budget: '500',
      lifetime_budget: null,
      billing_event: 'IMPRESSIONS',
      bid_amount: null,
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      optimization_goal: 'CONVERSATIONS',
      destination_type: 'MESSENGER',
      start_time: '2026-10-05T09:00:00+1300',
      end_time: '2026-10-12T09:00:00+1300',
      promoted_object: { page_id: 'p1' },
      frequency_control_specs: [],
      targeting: {
        geo_locations: { countries: ['NZ', 'AU'], cities: [{ key: 'k1' }], regions: [] },
        age_min: 25,
        age_max: 65,
        targeting_automation: { advantage_audience: 0 },
        custom_audiences: [{ id: 'aud1' }],
        publisher_platforms: ['facebook', 'instagram'],
        facebook_positions: ['feed'],
        instagram_positions: ['stream'],
        messenger_positions: [],
        audience_network_positions: [],
      },
    },
    ads: [
      {
        id: '111',
        name: 'ad-111',
        status: 'PAUSED',
        creative: {
          id: 'cr-111',
          object_story_spec: {
            page_id: 'p1',
            video_data: {
              video_id: 'v1',
              message: '正文一',
              title: '标题一',
              link_description: '描述一',
              image_hash: 'h1',
              call_to_action: { type: 'MESSAGE_PAGE', value: { app_destination: 'MESSENGER' } },
            },
          },
        },
      },
      {
        id: '222',
        name: 'ad-222',
        status: 'PAUSED',
        creative: {
          id: 'cr-222',
          object_story_spec: {
            page_id: 'p1',
            video_data: {
              video_id: 'v2',
              message: '正文二',
              title: '标题一',
              link_description: '描述一',
              image_hash: 'h1',
              page_welcome_message: '你好',
              call_to_action: { type: 'MESSAGE_PAGE', value: { app_destination: 'MESSENGER' } },
            },
          },
        },
      },
    ],
  }
}

/** 逐层取嵌套对象；每层用 typeof 收窄，不做类型强转。 */
function getPath(obj: Record<string, unknown>, path: string[]): Record<string, unknown> {
  let cur: Record<string, unknown> = obj
  for (const key of path) {
    const next = cur[key]
    if (typeof next !== 'object' || next === null) {
      throw new Error(`getPath: 路径不存在 ${path.join('.')}`)
    }
    cur = next as Record<string, unknown>
  }
  return cur
}

/** 逐层取嵌套对象并设置叶子字段。 */
function setPath(obj: Record<string, unknown>, path: string[], value: unknown): void {
  const parent = getPath(obj, path.slice(0, -1))
  parent[path[path.length - 1]] = value
}

/** 取 ads 数组里指定 id 的那条广告对象。 */
function adById(obj: Record<string, unknown>, id: string): Record<string, unknown> {
  const ads = obj.ads
  if (!Array.isArray(ads)) throw new Error('adById: ads 不是数组')
  for (const ad of ads) {
    if (typeof ad === 'object' && ad !== null && (ad as Record<string, unknown>).id === id) {
      return ad as Record<string, unknown>
    }
  }
  throw new Error(`adById: 找不到广告 ${id}`)
}

/** 取某条广告的 video_data 对象。 */
function videoDataOf(obj: Record<string, unknown>, id: string): Record<string, unknown> {
  const ad = adById(obj, id)
  const creative = ad.creative
  if (typeof creative !== 'object' || creative === null) throw new Error('videoDataOf: creative 缺失')
  const story = (creative as Record<string, unknown>).object_story_spec
  if (typeof story !== 'object' || story === null) throw new Error('videoDataOf: story 缺失')
  const video = (story as Record<string, unknown>).video_data
  if (typeof video !== 'object' || video === null) throw new Error('videoDataOf: video_data 缺失')
  return video as Record<string, unknown>
}

/** 取某条广告的 creative 对象。 */
function creativeOf(obj: Record<string, unknown>, id: string): Record<string, unknown> {
  const ad = adById(obj, id)
  const creative = ad.creative
  if (typeof creative !== 'object' || creative === null) throw new Error('creativeOf: creative 缺失')
  return creative as Record<string, unknown>
}

describe('computeMetaFingerprint 稳定性', () => {
  it('同一输入算两次结果相同', () => {
    const a = fp(raw())
    const b = fp(raw())
    expect(a).toEqual(b)
  })

  it('ads 数组顺序对调后指纹相同', () => {
    const base = fp(raw())
    const swapped = structuredClone(raw())
    const ads = swapped.ads
    if (!Array.isArray(ads)) throw new Error('ads 不是数组')
    ads.reverse()
    expect(fp(swapped)).toEqual(base)
  })
})

describe('adSet 预算改动', () => {
  it('daily_budget 500 → 50000 只影响 adSet', () => {
    const before = fp(raw())
    const after = structuredClone(raw())
    setPath(after, ['adSet', 'daily_budget'], '50000')
    const next = fp(after)
    expect(diffMetaFingerprint(before, next)).toEqual(['adSet'])
    expect(next.campaign).toBe(before.campaign)
    expect(next.ads['111']).toBe(before.ads['111'])
    expect(next.ads['222']).toBe(before.ads['222'])
  })
})

describe('归一化等价', () => {
  it('数字 500 与字符串 500 指纹相同', () => {
    const base = fp(raw())
    const numeric = structuredClone(raw())
    setPath(numeric, ['adSet', 'daily_budget'], 500)
    expect(fp(numeric)).toEqual(base)
  })

  it('同一时刻的不同时区写法指纹相同', () => {
    const base = fp(raw())
    const shifted = structuredClone(raw())
    setPath(shifted, ['adSet', 'end_time'], '2026-10-11T20:00:00+0000')
    expect(fp(shifted)).toEqual(base)
  })
})

describe('adSet 各字段单独改动', () => {
  const cases: Array<[string, (obj: Record<string, unknown>) => void]> = [
    ['billing_event', (o) => setPath(o, ['adSet', 'billing_event'], 'LINK_CLICKS')],
    ['bid_amount', (o) => setPath(o, ['adSet', 'bid_amount'], '100')],
    ['bid_strategy', (o) => setPath(o, ['adSet', 'bid_strategy'], 'LOWEST_COST_WITH_BID_CAP')],
    ['optimization_goal', (o) => setPath(o, ['adSet', 'optimization_goal'], 'LINK_CLICKS')],
    ['destination_type', (o) => setPath(o, ['adSet', 'destination_type'], 'WEBSITE')],
    ['start_time', (o) => setPath(o, ['adSet', 'start_time'], '2026-10-06T09:00:00+1300')],
    ['end_time', (o) => setPath(o, ['adSet', 'end_time'], '2026-10-13T09:00:00+1300')],
    ['promoted_object.page_id', (o) => setPath(o, ['adSet', 'promoted_object', 'page_id'], 'p2')],
    [
      'targeting.geo_locations.countries',
      (o) => setPath(o, ['adSet', 'targeting', 'geo_locations', 'countries'], ['NZ', 'AU', 'US']),
    ],
    [
      'targeting.geo_locations.cities',
      (o) => setPath(o, ['adSet', 'targeting', 'geo_locations', 'cities'], [{ key: 'k1' }, { key: 'k2' }]),
    ],
    ['targeting.age_min', (o) => setPath(o, ['adSet', 'targeting', 'age_min'], 30)],
    ['targeting.age_max', (o) => setPath(o, ['adSet', 'targeting', 'age_max'], 55)],
    [
      'targeting.targeting_automation.advantage_audience',
      (o) => setPath(o, ['adSet', 'targeting', 'targeting_automation', 'advantage_audience'], 1),
    ],
    [
      'targeting.custom_audiences',
      (o) => setPath(o, ['adSet', 'targeting', 'custom_audiences'], [{ id: 'aud1' }, { id: 'aud2' }]),
    ],
    [
      'targeting.publisher_platforms',
      (o) => setPath(o, ['adSet', 'targeting', 'publisher_platforms'], ['facebook', 'instagram', 'messenger']),
    ],
    [
      'targeting.facebook_positions',
      (o) => setPath(o, ['adSet', 'targeting', 'facebook_positions'], ['feed', 'story']),
    ],
    ['frequency_control_specs', (o) => setPath(o, ['adSet', 'frequency_control_specs'], [{ event: 'IMPRESSIONS' }])],
  ]

  it.each(cases)('改动 %s 只影响 adSet', (_name, mutate) => {
    const before = fp(raw())
    const after = structuredClone(raw())
    mutate(after)
    expect(diffMetaFingerprint(before, fp(after))).toEqual(['adSet'])
  })
})

describe('列表顺序无关', () => {
  it('countries 顺序对调指纹相同', () => {
    const base = fp(raw())
    const swapped = structuredClone(raw())
    setPath(swapped, ['adSet', 'targeting', 'geo_locations', 'countries'], ['AU', 'NZ'])
    expect(fp(swapped)).toEqual(base)
  })

  it('publisher_platforms 顺序对调指纹相同', () => {
    const base = fp(raw())
    const swapped = structuredClone(raw())
    setPath(swapped, ['adSet', 'targeting', 'publisher_platforms'], ['instagram', 'facebook'])
    expect(fp(swapped)).toEqual(base)
  })
})

describe('Meta 异步补的字段不进指纹', () => {
  it('status/name/updated_time 与异步字段改动后指纹不变', () => {
    const before = fp(raw())
    const after = structuredClone(raw())
    setPath(after, ['adSet', 'targeting', 'expanded_implicit_custom_audiences'], [{ id: 'x' }])
    setPath(after, ['adSet', 'targeting', 'targeting_relaxation_types'], { lookalike: 1 })
    setPath(after, ['campaign', 'status'], 'ACTIVE')
    setPath(after, ['campaign', 'name'], 'camp-2')
    setPath(after, ['campaign', 'updated_time'], '2026-10-01T00:00:00+0000')
    setPath(after, ['adSet', 'status'], 'ACTIVE')
    setPath(after, ['adSet', 'name'], 'set-2')
    setPath(after, ['adSet', 'updated_time'], '2026-10-01T00:00:00+0000')
    setPath(after, ['ads', '0', 'status'], 'ACTIVE')
    setPath(after, ['ads', '0', 'name'], 'ad-111-2')
    setPath(after, ['ads', '0', 'updated_time'], '2026-10-01T00:00:00+0000')
    expect(diffMetaFingerprint(before, fp(after))).toEqual([])
  })
})

describe('campaign 各字段单独改动', () => {
  const cases: Array<[string, (obj: Record<string, unknown>) => void]> = [
    ['objective', (o) => setPath(o, ['campaign', 'objective'], 'OUTCOME_TRAFFIC')],
    ['spend_cap', (o) => setPath(o, ['campaign', 'spend_cap'], '10000')],
    ['bid_strategy', (o) => setPath(o, ['campaign', 'bid_strategy'], 'LOWEST_COST_WITH_BID_CAP')],
    ['daily_budget', (o) => setPath(o, ['campaign', 'daily_budget'], '800')],
  ]

  it.each(cases)('改动 %s 只影响 campaign', (_name, mutate) => {
    const before = fp(raw())
    const after = structuredClone(raw())
    mutate(after)
    expect(diffMetaFingerprint(before, fp(after))).toEqual(['campaign'])
  })
})

describe('单条广告创意改动', () => {
  const cases: Array<[string, (obj: Record<string, unknown>) => void]> = [
    ['message', (o) => setPath(videoDataOf(o, '111'), ['message'], '改过的正文')],
    ['title', (o) => setPath(videoDataOf(o, '111'), ['title'], '改过的标题')],
    ['video_id', (o) => setPath(videoDataOf(o, '111'), ['video_id'], 'v9')],
    ['image_hash', (o) => setPath(videoDataOf(o, '111'), ['image_hash'], 'h9')],
    ['call_to_action.type', (o) => setPath(videoDataOf(o, '111'), ['call_to_action', 'type'], 'LEARN_MORE')],
    [
      'call_to_action.value.app_destination',
      (o) => setPath(videoDataOf(o, '111'), ['call_to_action', 'value', 'app_destination'], 'WEBSITE'),
    ],
    ['page_welcome_message', (o) => setPath(videoDataOf(o, '111'), ['page_welcome_message'], '欢迎')],
    ['creative.url_tags', (o) => setPath(creativeOf(o, '111'), ['url_tags'], 'a=b')],
  ]

  it.each(cases)('改动 %s 只影响 ad:111', (_name, mutate) => {
    const before = fp(raw())
    const after = structuredClone(raw())
    mutate(after)
    expect(diffMetaFingerprint(before, fp(after))).toEqual(['ad:111'])
  })
})

describe('安全用例', () => {
  it('给按钮 value 加 link 会触发 ad:111', () => {
    const before = fp(raw())
    const after = structuredClone(raw())
    setPath(videoDataOf(after, '111'), ['call_to_action', 'value', 'link'], 'https://evil.example')
    expect(diffMetaFingerprint(before, fp(after))).toEqual(['ad:111'])
  })

  it('video_data 换成 link_data 会触发 ad:111', () => {
    const before = fp(raw())
    const after = structuredClone(raw())
    const story = getPath(after, ['ads', '0', 'creative', 'object_story_spec'])
    delete story.video_data
    story.link_data = { message: '正文一', link: 'https://x.example' }
    expect(diffMetaFingerprint(before, fp(after))).toEqual(['ad:111'])
  })

  it('video_data 里塞未知字段 foo 会触发 ad:111', () => {
    const before = fp(raw())
    const after = structuredClone(raw())
    setPath(videoDataOf(after, '111'), ['foo'], 1)
    expect(diffMetaFingerprint(before, fp(after))).toEqual(['ad:111'])
  })
})

describe('广告增减与排序', () => {
  it('多一条 333 只报 ad:333', () => {
    const before = fp(raw())
    const after = structuredClone(raw())
    const ads = after.ads
    if (!Array.isArray(ads)) throw new Error('ads 不是数组')
    ads.push({ id: '333', name: 'ad-333', status: 'PAUSED', creative: { id: 'cr-333' } })
    expect(diffMetaFingerprint(before, fp(after))).toEqual(['ad:333'])
  })

  it('少一条 222 只报 ad:222', () => {
    const before = fp(raw())
    const after = structuredClone(raw())
    const ads = after.ads
    if (!Array.isArray(ads)) throw new Error('ads 不是数组')
    after.ads = ads.filter((ad) => {
      if (typeof ad !== 'object' || ad === null) return true
      return (ad as Record<string, unknown>).id !== '222'
    })
    expect(diffMetaFingerprint(before, fp(after))).toEqual(['ad:222'])
  })

  it('两边完全相同返回空数组', () => {
    const a = fp(raw())
    const b = fp(raw())
    expect(diffMetaFingerprint(a, b)).toEqual([])
  })

  it('多处改动时结果按 JS 默认字符串升序', () => {
    const before = fp(raw())
    const after = structuredClone(raw())
    setPath(after, ['adSet', 'daily_budget'], '999')
    setPath(videoDataOf(after, '111'), ['message'], '改一')
    setPath(videoDataOf(after, '222'), ['message'], '改二')
    // JS 默认排序按 UTF-16 码元：'adSet' 与 'ad:…' 前两个字符相同，第三个字符 ':'(58) < 'S'(83)，
    // 所以 'ad:111' < 'ad:222' < 'adSet'（用 node 实际排过一遍核对）。
    expect(diffMetaFingerprint(before, fp(after))).toEqual(['ad:111', 'ad:222', 'adSet'])
  })
})

describe('异常与缺失', () => {
  it('广告缺少字符串 id 时抛错', () => {
    const bad = structuredClone(raw())
    const ads = bad.ads
    if (!Array.isArray(ads)) throw new Error('ads 不是数组')
    ads.push({ name: 'no-id', status: 'PAUSED' })
    expect(() => fp(bad)).toThrow()
  })

  it('缺失键与 null 等价', () => {
    const base = fp(raw())
    const missing = structuredClone(raw())
    const adSet = getPath(missing, ['adSet'])
    delete adSet.bid_amount
    expect(fp(missing)).toEqual(base)
  })
})

describe('买家可见文字', () => {
  it('creative.body 顶层正文改动只影响 ad:222', () => {
    const before = fp(raw())
    const after = structuredClone(raw())
    setPath(creativeOf(after, '222'), ['body'], '顶层正文')
    expect(diffMetaFingerprint(before, fp(after))).toEqual(['ad:222'])
  })
})
