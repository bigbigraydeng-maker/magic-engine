import { describe, expect, it } from 'vitest'
import {
  adsHealthHref,
  buildAdsRuleFindingItems,
  findingKey,
  ruleHits,
  stopLossText,
  streakFor,
  type GrowthStateRow,
  type RuleFinding,
} from '../ads-rule-finding-items'

function hit(code: 'D2' | 'D10' | 'D3', adId: string, title = `${code} ${adId}`): RuleFinding {
  return {
    code,
    status: 'hit',
    title,
    units: [
      { level: 'ad', id: adId, name: adId },
      { level: 'adset', id: 'as1', name: 'as1' },
    ],
    reasons: ['对照：…', '建议', '止损：7 天后（约 2026-10-01）回头看——条件，就退回'],
  }
}

function row(
  clientId: string,
  date: string,
  problems: RuleFinding[],
  completeness = 'complete',
): GrowthStateRow {
  return { client_id: clientId, date, payload: { dataCompleteness: completeness, problems } }
}

const nameOf = (id: string) => `name-${id}`

describe('adsHealthHref', () => {
  it('builds the ads-health URL for a client', () => {
    expect(adsHealthHref('c1')).toBe(
      'https://app.magicengine.com.au/dashboard/clients/c1/ads-health',
    )
  })
})

describe('findingKey', () => {
  it('returns code:adId for the first ad-level unit', () => {
    expect(findingKey(hit('D10', 'ad1'))).toBe('D10:ad1')
  })

  it('returns null when there is no ad-level unit', () => {
    const noAd: RuleFinding = {
      code: 'D10',
      status: 'hit',
      title: 'no ad unit',
      units: [{ level: 'adset', id: 'as1', name: 'as1' }],
    }
    expect(findingKey(noAd)).toBeNull()
  })
})

describe('ruleHits', () => {
  it('keeps only D2/D10 with status hit', () => {
    const r = row('c1', '2026-09-24', [
      hit('D10', 'ad1'),
      hit('D2', 'ad2'),
      hit('D3', 'ad3'),
      { ...hit('D10', 'ad4'), status: 'not_comparable' },
    ])
    expect(ruleHits(r).map((f) => findingKey(f))).toEqual(['D10:ad1', 'D2:ad2'])
  })

  it('returns empty when payload/problems is missing', () => {
    const r: GrowthStateRow = { client_id: 'c1', date: '2026-09-24', payload: null }
    expect(ruleHits(r)).toEqual([])
  })
})

describe('stopLossText', () => {
  it('uses the 止损： reason when present', () => {
    expect(stopLossText(hit('D10', 'ad1'))).toContain('止损：')
  })

  it('falls back to checkBack when no 止损： reason', () => {
    const f: RuleFinding = {
      code: 'D10',
      status: 'hit',
      title: 't',
      reasons: ['对照：…'],
      checkBack: { after: '7 天后', condition: '没回升', fallback: '退回' },
    }
    const text = stopLossText(f)
    expect(text.startsWith('止损：')).toBe(true)
    expect(text).toContain('没回升')
  })

  it('returns empty string when neither exists', () => {
    const f: RuleFinding = { code: 'D10', status: 'hit', title: 't' }
    expect(stopLossText(f)).toBe('')
  })
})

describe('streakFor', () => {
  it('counts consecutive hits within the gap and stops past it', () => {
    const rows: GrowthStateRow[] = [
      row('c1', '2026-09-24', [hit('D10', 'ad1')]),
      row('c1', '2026-09-23', [hit('D10', 'ad1')]),
      row('c1', '2026-09-21', [hit('D10', 'ad1')]),
      row('c1', '2026-09-15', [hit('D10', 'ad1')]),
    ]
    expect(streakFor('D10:ad1', rows)).toBe(3)
  })

  it('does not break the streak on rows without the key', () => {
    const rows: GrowthStateRow[] = [
      row('c1', '2026-09-24', [hit('D10', 'ad1')]),
      row('c1', '2026-09-23', [hit('D2', 'other')]),
      row('c1', '2026-09-22', [hit('D10', 'ad1')]),
    ]
    expect(streakFor('D10:ad1', rows)).toBe(2)
  })
})

describe('buildAdsRuleFindingItems', () => {
  it('produces one item for a fresh hit', () => {
    const rows = [row('c1', '2026-09-24', [hit('D10', 'ad1')])]
    const now = new Date('2026-09-25T19:00:00Z')
    const items = buildAdsRuleFindingItems(rows, now, nameOf)

    expect(items).toHaveLength(1)
    const item = items[0]
    expect(item.kind).toBe('ads_rule_finding')
    expect(item.client_name).toBe('name-c1')
    expect(item.href).toBe('https://app.magicengine.com.au/dashboard/clients/c1/ads-health')
    expect(item.href.startsWith('https://')).toBe(true)
    expect(item.what).toContain('1 条广告')
    expect(item.what).toContain('D10 ad1')
    expect(item.how).toContain('止损：')
    expect(item.how).toContain('系统不会自动改')
  })

  it('ignores non-D2/D10 codes and non-hit statuses', () => {
    const rows = [
      row('c1', '2026-09-24', [
        hit('D3', 'ad1'),
        { ...hit('D10', 'ad2'), status: 'not_comparable' },
      ]),
    ]
    const now = new Date('2026-09-25T19:00:00Z')
    expect(buildAdsRuleFindingItems(rows, now, nameOf)).toEqual([])
  })

  it('skips a partial newest day even if an older complete row has hits', () => {
    const rows = [
      row('c1', '2026-09-24', [hit('D10', 'ad1')], 'partial'),
      row('c1', '2026-09-23', [hit('D10', 'ad1')]),
    ]
    const now = new Date('2026-09-25T19:00:00Z')
    expect(buildAdsRuleFindingItems(rows, now, nameOf)).toEqual([])
  })

  it('skips a stale newest row', () => {
    const rows = [row('c1', '2026-09-20', [hit('D10', 'ad1')])]
    const now = new Date('2026-09-25T19:00:00Z')
    expect(buildAdsRuleFindingItems(rows, now, nameOf)).toEqual([])
  })

  it('orders D10 before D2', () => {
    const rows = [row('c1', '2026-09-24', [hit('D2', 'a'), hit('D10', 'b')])]
    const now = new Date('2026-09-25T19:00:00Z')
    const items = buildAdsRuleFindingItems(rows, now, nameOf)

    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('D10 b')
    const firstBullet = items[0].how.split('\n')[0]
    expect(firstBullet).toContain('D10 b')
  })

  it('lists at most 3 bullets and summarizes the rest', () => {
    const rows = [
      row('c1', '2026-09-24', [
        hit('D10', 'a1'),
        hit('D10', 'a2'),
        hit('D10', 'a3'),
        hit('D10', 'a4'),
        hit('D10', 'a5'),
      ]),
    ]
    const now = new Date('2026-09-25T19:00:00Z')
    const items = buildAdsRuleFindingItems(rows, now, nameOf)

    expect(items).toHaveLength(1)
    const bullets = items[0].how.split('\n').filter((l) => l.startsWith('• '))
    expect(bullets).toHaveLength(3)
    expect(items[0].how).toContain('另有 2 条')
  })

  it('suppresses a long streak on a non-anchor day but reminds on Sunday', () => {
    const days = ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24']
    const rows = days.map((d) => row('c1', d, [hit('D10', 'ad1')]))

    const thursday = new Date('2026-09-25T19:00:00Z')
    expect(buildAdsRuleFindingItems(rows, thursday, nameOf)).toEqual([])

    const withSaturday = [...rows, row('c1', '2026-09-26', [hit('D10', 'ad1')])]
    const sunday = new Date('2026-09-27T19:00:00Z')
    expect(buildAdsRuleFindingItems(withSaturday, sunday, nameOf)).toHaveLength(1)
  })

  it('produces no item when the finding has no ad-level unit', () => {
    const noAd: RuleFinding = {
      code: 'D10',
      status: 'hit',
      title: 'no ad unit',
      units: [{ level: 'adset', id: 'as1', name: 'as1' }],
    }
    const rows = [row('c1', '2026-09-24', [noAd])]
    const now = new Date('2026-09-25T19:00:00Z')
    expect(buildAdsRuleFindingItems(rows, now, nameOf)).toEqual([])
  })

  it('produces one item per client with its own href', () => {
    const rows = [
      row('c1', '2026-09-24', [hit('D10', 'ad1')]),
      row('c2', '2026-09-24', [hit('D2', 'ad2')]),
    ]
    const now = new Date('2026-09-25T19:00:00Z')
    const items = buildAdsRuleFindingItems(rows, now, nameOf)

    expect(items).toHaveLength(2)
    const byClient = new Map(items.map((i) => [i.client_id, i]))
    expect(byClient.get('c1')?.href).toBe(
      'https://app.magicengine.com.au/dashboard/clients/c1/ads-health',
    )
    expect(byClient.get('c2')?.href).toBe(
      'https://app.magicengine.com.au/dashboard/clients/c2/ads-health',
    )
  })
})
