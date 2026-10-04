import { describe, expect, it } from 'vitest'
import { computeDraftHash, type DraftHashInput } from '../draft-hash'

const HEX64 = /^[0-9a-f]{64}$/

function base(): DraftHashInput {
  return {
    kind: 'draft',
    creatives: [
      {
        name: 'creative-a',
        primaryText: 'Buy one get one',
        headline: 'Sale now',
        description: 'limited offer',
        videoId: 'vid-1',
        thumbnailImageHash: 'thumb-hash-1',
        thumbnailUrl: 'https://cdn.example.com/1.jpg',
        language: 'en',
      },
      {
        name: 'creative-b',
        primaryText: 'Free shipping',
        headline: 'Shop today',
        description: 'worldwide',
        videoId: 'vid-2',
        thumbnailImageHash: 'thumb-hash-2',
        thumbnailUrl: 'https://cdn.example.com/2.jpg',
        language: 'en',
      },
    ],
    geoCountries: ['NZ', 'AU'],
    geoCityKeys: ['akl', 'wlg'],
    ageMin: 18,
    ageMax: 45,
    dailyBudget: 20,
    durationDays: 7,
    pageId: 'page-1',
    campaignId: 'campaign-1',
    adSetId: 'adset-1',
    adIds: ['ad-1', 'ad-2'],
    buyerWillSee: [
      { adName: 'ad-1', lines: ['Buy one get one', 'Sale now'] },
      { adName: 'ad-2', lines: ['Free shipping', 'Shop today'] },
    ],
    capCentsSnapshot: 15000,
    metaFingerprint: { campaign: 'c', adSet: 's' },
  }
}

describe('computeDraftHash', () => {
  it('返回 64 位小写 hex，且同一输入算两次相同', () => {
    const first = computeDraftHash(base())
    const second = computeDraftHash(base())
    expect(first).toMatch(HEX64)
    expect(first).toBe(second)
  })

  const mutations: ReadonlyArray<readonly [string, (input: DraftHashInput) => void]> = [
    ['改创意文案 primaryText', (input) => { input.creatives[0].primaryText = 'changed' }],
    ['改创意 headline', (input) => { input.creatives[0].headline = 'changed' }],
    ['改创意 name', (input) => { input.creatives[0].name = 'changed' }],
    ['改创意 description', (input) => { input.creatives[0].description = 'changed' }],
    ['换视频号 videoId', (input) => { input.creatives[0].videoId = 'vid-9' }],
    ['换缩略图 hash', (input) => { input.creatives[0].thumbnailImageHash = 'thumb-hash-9' }],
    ['换缩略图链接', (input) => { input.creatives[0].thumbnailUrl = 'https://cdn.example.com/9.jpg' }],
    ['改语言 language', (input) => { input.creatives[0].language = 'zh' }],
    ['改预算 dailyBudget', (input) => { input.dailyBudget = 21 }],
    ['改天数 durationDays', (input) => { input.durationDays = 8 }],
    ['改年龄 ageMin', (input) => { input.ageMin = 19 }],
    ['改年龄 ageMax', (input) => { input.ageMax = 46 }],
    ['改 pageId', (input) => { input.pageId = 'page-2' }],
    ['改 campaignId', (input) => { input.campaignId = 'campaign-2' }],
    ['改 adSetId', (input) => { input.adSetId = 'adset-2' }],
    ['改 adIds 内容', (input) => { input.adIds = ['ad-1', 'ad-3'] }],
    ['改 buyerWillSee 某一行文字', (input) => { input.buyerWillSee[0].lines = ['changed', 'Sale now'] }],
    ['改 capCentsSnapshot', (input) => { input.capCentsSnapshot = 15001 }],
    ['改 metaFingerprint 里的值', (input) => { input.metaFingerprint = { campaign: 'c', adSet: 'changed' } }],
    ['改 kind', (input) => { input.kind = 'other' }],
    ['增一条创意', (input) => {
      input.creatives = [...input.creatives, {
        name: 'creative-c',
        primaryText: 'extra',
        headline: 'extra',
      }]
    }],
    ['删一条创意', (input) => { input.creatives = [input.creatives[0]] }],
  ]

  it.each(mutations)('%s → 摘要必须不同', (_label, mutate) => {
    const original = computeDraftHash(base())
    const input = base()
    mutate(input)
    expect(computeDraftHash(input)).not.toBe(original)
  })

  it('geoCountries 顺序对调 → 摘要相同', () => {
    const input = base()
    input.geoCountries = ['AU', 'NZ']
    expect(computeDraftHash(input)).toBe(computeDraftHash(base()))
  })

  it('adIds 顺序对调 → 摘要相同', () => {
    const input = base()
    input.adIds = ['ad-2', 'ad-1']
    expect(computeDraftHash(input)).toBe(computeDraftHash(base()))
  })

  it('geoCityKeys 顺序对调 → 摘要相同', () => {
    const input = base()
    input.geoCityKeys = ['wlg', 'akl']
    expect(computeDraftHash(input)).toBe(computeDraftHash(base()))
  })

  it('metaFingerprint 键顺序对调 → 摘要相同', () => {
    const input = base()
    input.metaFingerprint = { adSet: 's', campaign: 'c' }
    expect(computeDraftHash(input)).toBe(computeDraftHash(base()))
  })

  it('两条创意对调顺序 → 摘要不同', () => {
    const input = base()
    input.creatives = [input.creatives[1], input.creatives[0]]
    expect(computeDraftHash(input)).not.toBe(computeDraftHash(base()))
  })

  it('buyerWillSee 的行顺序对调 → 摘要不同', () => {
    const input = base()
    input.buyerWillSee[0].lines = ['Sale now', 'Buy one get one']
    expect(computeDraftHash(input)).not.toBe(computeDraftHash(base()))
  })

  it('description 缺失 / undefined / null 三者摘要相同', () => {
    const missing = base()
    delete missing.creatives[0].description
    const undef = base()
    undef.creatives[0].description = undefined
    const nul = base()
    nul.creatives[0].description = null
    const expected = computeDraftHash(missing)
    expect(computeDraftHash(undef)).toBe(expected)
    expect(computeDraftHash(nul)).toBe(expected)
  })

  it('description 空串与 null 摘要不同', () => {
    const empty = base()
    empty.creatives[0].description = ''
    const nul = base()
    nul.creatives[0].description = null
    expect(computeDraftHash(empty)).not.toBe(computeDraftHash(nul))
  })

  it('geoCityKeys 缺失与 null 相同、与 [] 不同', () => {
    const missing = base()
    delete missing.geoCityKeys
    const nul = base()
    nul.geoCityKeys = null
    const empty = base()
    empty.geoCityKeys = []
    const expected = computeDraftHash(missing)
    expect(computeDraftHash(nul)).toBe(expected)
    expect(computeDraftHash(empty)).not.toBe(expected)
  })

  it('多余属性不影响摘要', () => {
    const loose: DraftHashInput & { extra?: string } = {
      ...base(),
      extra: 'ignored',
    }
    loose.creatives = loose.creatives.map((creative) => ({
      ...creative,
      extraCreativeField: 'ignored',
    })) as DraftHashInput['creatives']
    expect(computeDraftHash(loose)).toBe(computeDraftHash(base()))
  })
})
