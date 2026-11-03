import { describe, expect, it } from 'vitest'
import {
  buildAdsRuleFindingItems,
  findingKey,
  ruleHits,
  type GrowthStateRow,
  type RuleFinding,
} from '../ads-rule-finding-items'

const nameOf = (id: string) => `name-${id}`
const now = new Date('2026-09-25T19:00:00Z')

function row(date: string, problems: RuleFinding[]): GrowthStateRow {
  return { client_id: 'c1', date, payload: { dataCompleteness: 'complete', problems } }
}

const d3 = (adsetId: string): RuleFinding => ({
  code: 'D3',
  status: 'hit',
  title: `花钱没结果（只提醒，不会自动暂停）：${adsetId}`,
  units: [{ level: 'adset', id: adsetId, name: adsetId }],
  reasons: ['花费 ≥ 2× 目标，且单次成本 ≥ 2× 目标'],
})

const d10: RuleFinding = {
  code: 'D10',
  status: 'hit',
  title: 'D10 ad1',
  units: [{ level: 'ad', id: 'ad1', name: 'ad1' }, { level: 'adset', id: 'as1', name: 'as1' }],
  reasons: ['建议这样做'],
}

describe('D3（花钱没结果，adset 级）进 PM 待办', () => {
  it('findingKey 用广告组 id；ruleHits（客户侧共享）仍不含 D3', () => {
    expect(findingKey(d3('as9'))).toBe('D3:as9')
    expect(ruleHits(row('2026-09-24', [d3('as9')]))).toEqual([])
  })

  it('连着 2 天命中才出，且排在 D10 前面', () => {
    const rows = [
      row('2026-09-24', [d10, d3('as9')]),
      row('2026-09-23', [d10, d3('as9')]),
    ]
    const items = buildAdsRuleFindingItems(rows, now, nameOf)
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('2 件')
    expect(items[0].what).toContain('花钱没结果')
  })

  it('只命中一天不出', () => {
    const rows = [row('2026-09-24', [d3('as9')]), row('2026-09-23', [])]
    expect(buildAdsRuleFindingItems(rows, now, nameOf)).toEqual([])
  })
})
