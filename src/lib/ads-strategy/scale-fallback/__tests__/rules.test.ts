import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { restoreCents, type ChainStep } from '../chain'
import { fallbackFacts } from '../facts'
import { judgeScaleFallback, type FallbackInput } from '../rules'

const ADSET = 'set-alpha'
const raised = (before: number, after: number, executedAt: string): ChainStep => ({
  adsetId: ADSET, beforeCents: before, afterCents: after, executedAt, wroteMeta: true, status: 'executed',
})

function input(overrides: Partial<FallbackInput> = {}): FallbackInput {
  return {
    stage: 'scale',
    targetCents: 800,
    capCents: 20000,
    fresh: true,
    timezoneKnown: true,
    truncated: false,
    yesterday: '2026-11-10',
    dayBefore: '2026-11-09',
    currency: 'NZD',
    adsets: [{ adsetId: ADSET, campaignId: 'camp-1', delivering: true, dailyBudgetCents: 1440 }],
    campaigns: [{ id: 'camp-1', delivering: true, dailyBudgetCents: null }],
    days: {
      [ADSET]: {
        yesterday: { spendCents: 1100, leads: 1 },
        dayBefore: { spendCents: 1100, leads: 1 },
      },
    },
    actions: [raised(1000, 1200, '2026-11-01T00:00:00Z'), raised(1200, 1440, '2026-11-02T00:00:00Z')],
    ...overrides,
  }
}

describe('放量收回之前的日预算', () => {
  it('连续两次加预算，收回加之前的金额', () => {
    expect(restoreCents(input().actions, ADSET, 1440)).toBe(1000)
    const [card] = judgeScaleFallback(input())
    expect(card?.restoreCents).toBe(1000)
    expect(card?.currentCents).toBe(1440)
    expect(card?.reasons).toEqual(['cpl'])
    expect(card?.subjectKey.includes(ADSET)).toBe(false)
  })

  it('现预算对不上、没有加过、时间重复，都不猜', () => {
    expect(restoreCents(input().actions, ADSET, 1500)).toBeNull()
    expect(restoreCents([], ADSET, 1440)).toBeNull()
    const sameTime = [raised(1000, 1200, '2026-11-01T00:00:00Z'), raised(1200, 1440, '2026-11-01T00:00:00Z')]
    expect(restoreCents(sameTime, ADSET, 1440)).toBeNull()
  })

  it('中间减过一次，只收回这一段加预算的起点', () => {
    const steps = [
      raised(1000, 1200, '2026-11-01T00:00:00Z'),
      { ...raised(1200, 900, '2026-11-02T00:00:00Z'), afterCents: 900 },
      raised(900, 1440, '2026-11-03T00:00:00Z'),
    ]
    expect(restoreCents(steps, ADSET, 1440)).toBe(900)
  })

  it('刚好 1.3 倍不触发；再高一点才触发。零留资不算单次成本', () => {
    const exact = input({ days: { [ADSET]: { yesterday: { spendCents: 1040, leads: 1 }, dayBefore: { spendCents: 1100, leads: 1 } } } })
    expect(judgeScaleFallback(exact)).toEqual([])
    const none = input({ days: { [ADSET]: { yesterday: { spendCents: 100, leads: 0 }, dayBefore: { spendCents: 1100, leads: 1 } } } })
    expect(judgeScaleFallback(none)).toEqual([])
    const unread = input({ days: { [ADSET]: { yesterday: { spendCents: 1100, leads: null }, dayBefore: { spendCents: 1100, leads: 1 } } } })
    expect(judgeScaleFallback(unread)).toEqual([])
  })

  it('花到日预算一半且没有留资，提议收回', () => {
    const days = { [ADSET]: { yesterday: { spendCents: 720, leads: 0 }, dayBefore: { spendCents: 100, leads: 2 } } }
    const [card] = judgeScaleFallback(input({ days }))
    expect(card?.reasons).toEqual(['zero_leads'])
    const under = { [ADSET]: { yesterday: { spendCents: 719, leads: 0 }, dayBefore: { spendCents: 100, leads: 2 } } }
    expect(judgeScaleFallback(input({ days: under }))).toEqual([])
  })

  it('快照旧、时区没有、不是放量、目标或上限读不到、读断了，都不出卡', () => {
    expect(judgeScaleFallback(input({ fresh: false }))).toEqual([])
    expect(judgeScaleFallback(input({ timezoneKnown: false }))).toEqual([])
    expect(judgeScaleFallback(input({ stage: 'other' }))).toEqual([])
    expect(judgeScaleFallback(input({ targetCents: null }))).toEqual([])
    expect(judgeScaleFallback(input({ capCents: null }))).toEqual([])
    expect(judgeScaleFallback(input({ truncated: true }))).toEqual([])
  })

  it('收回金额不低于现预算、超过计划上限、或还有一张未完成的预算卡，都不出', () => {
    const down = [raised(1440, 1000, '2026-11-02T00:00:00Z')]
    expect(judgeScaleFallback(input({ actions: down, adsets: [{ adsetId: ADSET, campaignId: 'camp-1', delivering: true, dailyBudgetCents: 1000 }] }))).toEqual([])
    expect(judgeScaleFallback(input({ capCents: 900 }))).toEqual([])
    const holding = [{ ...raised(1000, 1440, '2026-11-02T00:00:00Z'), status: 'holding', wroteMeta: false }]
    expect(judgeScaleFallback(input({ actions: [...input().actions, ...holding] }))).toEqual([])
  })

  it('收回之后每天合计会超过已批准上限，或有的在投广告组读不到预算，就不出', () => {
    const adsets = [
      { adsetId: ADSET, campaignId: 'camp-1', delivering: true, dailyBudgetCents: 1440 },
      { adsetId: 'set-b', campaignId: 'camp-2', delivering: true, dailyBudgetCents: 19001 },
    ]
    const campaigns = [
      { id: 'camp-1', delivering: true, dailyBudgetCents: null },
      { id: 'camp-2', delivering: true, dailyBudgetCents: null },
    ]
    expect(judgeScaleFallback(input({ adsets, campaigns, capCents: 20000 }))).toEqual([])
    const missing = [{ ...adsets[0], dailyBudgetCents: 1440 }, { adsetId: 'set-b', campaignId: 'camp-2', delivering: true, dailyBudgetCents: null }]
    expect(judgeScaleFallback(input({ adsets: missing, campaigns }))).toEqual([])
  })

  it('系列自己带日预算的广告组不在这里改', () => {
    const campaigns = [{ id: 'camp-1', delivering: true, dailyBudgetCents: 5000 }]
    expect(judgeScaleFallback(input({ campaigns }))).toEqual([])
  })

  it('卡面不写广告编号，也不说会暂停或加预算', () => {
    const [card] = judgeScaleFallback(input())
    expect(card).toBeTruthy()
    const facts = fallbackFacts(card!)
    const text = JSON.stringify(facts)
    expect(text).not.toContain(ADSET)
    expect(text).not.toContain('act_')
    expect(facts.what).toContain('不暂停')
    expect(facts.what).toContain('不加预算')
    expect(facts.what).toContain('也不会改预算')
    const factsSource = readFileSync(join(process.cwd(), 'src/lib/ads-strategy/scale-fallback/facts.ts'), 'utf8')
    const rulesSource = readFileSync(join(process.cwd(), 'src/lib/ads-strategy/scale-fallback/rules.ts'), 'utf8')
    expect(factsSource).not.toContain('graph.facebook')
    expect(rulesSource).not.toContain('graph.facebook')
  })
})
