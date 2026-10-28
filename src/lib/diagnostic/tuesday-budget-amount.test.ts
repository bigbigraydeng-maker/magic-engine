/**
 * Tuesday supervision emits one amount inside the existing caps, or a reason.
 * It does not invent a zero and it does not change a budget.
 */
import { describe, expect, it } from 'vitest'
import { checkBudgetWithinSafeRange, MAX_BUDGET_ADJUSTMENT_RATIO } from '@/lib/meta/guardrails'
import type { RuleFinding } from '@/lib/ads-strategy/rules/patrol-findings'
import {
  budgetIntent,
  fillTuesdayBudgets,
  judgeUnit,
  supervisionAmountSentence,
  type SupervisionState,
  type UnitRead,
} from './tuesday-budget-amount'
import type { WeeklyCheckSummary } from './prescription-weekly-check'

const NOW = new Date('2026-10-27T08:00:00.000Z')
const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const UNIT = 'adset-a'

const READY: UnitRead = {
  budgetLevel: 'abo',
  cents: 3000,
  active: true,
  currency: 'NZD',
  capturedAt: '2026-10-27T07:00:00.000Z',
  capCents: 10000,
  capReadable: true,
}

function hit(code: 'O1' | 'D3', id = UNIT): RuleFinding {
  return { code, status: 'hit', title: '命中', units: [{ level: 'adset', id, name: null }] }
}

function days(code: 'O1' | 'D3', count: number, id = UNIT): SupervisionState[] {
  return Array.from({ length: count }, (_, index) => ({
    clientId: CLIENT,
    date: `2026-10-${String(27 - index).padStart(2, '0')}`,
    dataCompleteness: 'complete' as const,
    problems: code === 'D3' ? [hit('D3', id)] : [],
    opportunities: code === 'O1' ? [hit('O1', id)] : [],
  }))
}

function summary(): WeeklyCheckSummary {
  return {
    considered: 1,
    checked: 1,
    outcomes: [{
      clientId: CLIENT,
      clientName: '示例',
      result: 'checked',
      suggestion: '这周先看进度。',
    }],
  }
}

describe('周二督导的金额', () => {
  it('加预算用现有上限，不超过一次允许的幅度，也不超过日上限', () => {
    const judged = judgeUnit(READY, 'increase', NOW)
    expect(judged).toEqual({ before: 3000, after: 3600, currency: '纽元' })
    if (!('after' in judged)) return
    expect(judged.after - judged.before).toBe(Math.round(3000 * MAX_BUDGET_ADJUSTMENT_RATIO))
    expect(checkBudgetWithinSafeRange(judged.before, judged.after).ok).toBe(true)
    const clamped = judgeUnit({ ...READY, capCents: 3400 }, 'increase', NOW)
    expect(clamped).toMatchObject({ after: 3400 })
  })

  it('日上限没配或读不到时不加，也不写成 0', () => {
    expect(judgeUnit({ ...READY, capCents: null }, 'increase', NOW)).toEqual({
      blocked: '日预算上限没配，这次不加。',
    })
    const unread = judgeUnit({ ...READY, capReadable: false, capCents: null }, 'increase', NOW)
    expect('blocked' in unread && unread.blocked).toContain('读不到')
    const text = JSON.stringify(judgeUnit({ ...READY, cents: null }, 'increase', NOW))
    expect(text).not.toContain('0.00')
    expect(text).toContain('没有按 0')
  })

  it('减预算用现有减幅，低过还能投的最低线就不出数', () => {
    const judged = judgeUnit(READY, 'decrease', NOW)
    expect(judged).toMatchObject({ before: 3000, after: 2400 })
    if (!('after' in judged)) return
    expect(checkBudgetWithinSafeRange(judged.before, judged.after).ok).toBe(true)
    const tooSmall = judgeUnit({ ...READY, cents: 200 }, 'decrease', NOW)
    expect('blocked' in tooSmall && tooSmall.blocked).toContain('最低日预算')
  })

  it('连续达标才建议加，不止一处或数据不全就挡住', () => {
    expect(budgetIntent(days('O1', 3), NOW)).toMatchObject({ kind: 'need', direction: 'increase' })
    expect(budgetIntent(days('O1', 2), NOW)).toEqual({ kind: 'none' })
    expect(budgetIntent(days('D3', 2), NOW)).toMatchObject({ kind: 'need', direction: 'decrease' })
    const two = days('O1', 3).map((row) => ({
      ...row,
      opportunities: [hit('O1', 'adset-a'), hit('O1', 'adset-b')],
    }))
    expect(budgetIntent(two, NOW).kind).toBe('block')
    const partial = days('O1', 1)
    partial[0] = { ...partial[0], dataCompleteness: 'partial' }
    expect(budgetIntent(partial, NOW)).toMatchObject({ kind: 'block' })
    expect(budgetIntent([], NOW)).toEqual({ kind: 'none' })
  })

  it('人话里有具体金额，没有原始数据，也写明不会自动改', async () => {
    const filled = await fillTuesdayBudgets(summary(), {
      loadStates: async () => days('O1', 3),
      loadUnit: async () => READY,
    }, NOW)
    const row = filled.budgetSuggestions?.[0]
    expect(row?.beforeCents).toBe(3000)
    expect(row?.afterCents).toBe(3600)
    expect(row?.subjectKey).not.toContain(UNIT)
    expect(row?.why).not.toContain('{')
    const sentence = filled.outcomes[0]?.suggestion ?? ''
    expect(sentence).toContain('30.00')
    expect(sentence).toContain('36.00')
    expect(sentence).toContain('纽元')
    expect(sentence).toContain('不会自动改')
    expect(sentence).not.toContain('{')
    expect(supervisionAmountSentence(row!)).toContain('往上加')
  })

  it('金额读不到时把原因写进督导，不出一个数', async () => {
    const filled = await fillTuesdayBudgets(summary(), {
      loadStates: async () => days('D3', 2),
      loadUnit: async () => ({ error: '现日预算读不到，没有按 0 出卡。' }),
    }, NOW)
    expect(filled.budgetSuggestions ?? []).toEqual([])
    expect(filled.budgetBlocks?.[0]?.reason).toContain('没有按 0')
    expect(filled.outcomes[0]?.suggestion).toContain('没有按 0')
    expect(filled.outcomes[0]?.suggestion).not.toContain('0.00')
  })
})
