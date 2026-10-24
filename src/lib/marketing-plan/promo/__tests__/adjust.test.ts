import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PromoAdjustmentRecord } from '../../types'
import {
  CONSECUTIVE_BEHIND_WINDOWS,
  isAbnormalWindow,
  nextRecheckDate,
  suggestAdjustment,
  type AdjustInput,
} from '../adjust'
import type { WatchFinding } from '../daily-watch'
import type { Reconciliation, ReconcileRow, RowStatus } from '../reconcile'

const WIN = { start: '2026-11-09', end: '2026-11-15' }

function mkRow(key: ReconcileRow['key'], status: RowStatus, planned: number | null = 10, actual: number | null = 10): ReconcileRow {
  return { key, label: key === 'spend' ? '广告花费（全部）' : key, planned, actual, unit: '', status, reason: 'r', as_of: null }
}

function recon(rows: ReconcileRow[], blind = false): Reconciliation {
  return { window: WIN, week_index: 2, rows, headline: 'h', blind }
}

const OK_ROWS = (): ReconcileRow[] => [mkRow('spend', 'on_track'), mkRow('results_goal', 'on_track'), mkRow('content', 'on_track')]

function input(over: Partial<AdjustInput> = {}): AdjustInput {
  return {
    reconcile: recon(OK_ROWS()),
    findings: [],
    checkEvidence: { status: 'declared' },
    experiment: null,
    spentCentsInExperiment: null,
    priorAdjustments: [],
    ...over,
  }
}

function withRow(key: ReconcileRow['key'], status: RowStatus, planned?: number | null, actual?: number | null): Reconciliation {
  return recon(OK_ROWS().map(r => (r.key === key ? mkRow(key, status, planned, actual) : r)))
}

function prior(start: string, goalStatus: RowStatus, hit: 'stop_rule' | 'max_loss' | null = null): PromoAdjustmentRecord {
  return {
    id: `p-${start}`, v: 1, window: { start, end: start }, goal_id: 'goal-a',
    trigger: { watch_codes: [], rows: [{ key: 'results_goal', status: goalStatus, planned: 5, actual: 1, unit: '', reason: 'r', as_of: null }], check_evidence: null, experiment_hit: hit },
    suggested_decision: 'continue', suggestion_reasons: [], decision: 'continue', override_reason: null, note: '',
    status: 'confirmed', proposed_by: 'system', proposed_at: start, confirmed_by: 'u', confirmed_at: start,
    recheck_due: start, recheck: null,
  }
}

const finding = (code: WatchFinding['code']): WatchFinding => ({ code, what: 'w', how: 'h' })

describe('suggestAdjustment', () => {
  it('T1 花费行 unknown 且目标行 behind → 补数据优先', () => {
    const r = recon([mkRow('spend', 'unknown', 10, null), mkRow('results_goal', 'behind'), mkRow('content', 'on_track')])
    expect(suggestAdjustment(input({ reconcile: r })).decision).toBe('fix_data')
  })

  it('T1 没有检查证据 / 检查证据 unknown → 补数据', () => {
    expect(suggestAdjustment(input({ checkEvidence: null })).decision).toBe('fix_data')
    expect(suggestAdjustment(input({ checkEvidence: { status: 'unknown', reason: '来源缺周期' } })).decision).toBe('fix_data')
  })

  it('T1 每日检查报数据读不出 → 补数据', () => {
    expect(suggestAdjustment(input({ findings: [finding('daily_plan_unreadable')] })).decision).toBe('fix_data')
  })

  it('T2 数据齐全、内容 planned 3 / actual 0 → 补执行', () => {
    const r = withRow('content', 'behind', 3, 0)
    expect(suggestAdjustment(input({ reconcile: r })).decision).toBe('fix_execution')
  })

  it('T2 花费落后 / 阶段检查没过 → 补执行（即使目标也落后）', () => {
    const r = recon([mkRow('spend', 'behind'), mkRow('results_goal', 'behind'), mkRow('content', 'on_track')])
    expect(suggestAdjustment(input({ reconcile: r })).decision).toBe('fix_execution')
    expect(suggestAdjustment(input({ findings: [finding('phase_gate_failed')] })).decision).toBe('fix_execution')
  })

  it('T3 数据齐全、执行到位，目标连续 2 个窗口落后 → 改处方', () => {
    expect(CONSECUTIVE_BEHIND_WINDOWS).toBe(2)
    const s = suggestAdjustment(input({ reconcile: withRow('results_goal', 'behind'), priorAdjustments: [prior('2026-11-02', 'behind')] }))
    expect(s.decision).toBe('revise_prescription')
    expect(s.experiment_hit).toBeNull()
  })

  it('T3 上一个窗口不是紧邻的（中间断了）不算连续', () => {
    const s = suggestAdjustment(input({ reconcile: withRow('results_goal', 'behind'), priorAdjustments: [prior('2026-10-26', 'behind')] }))
    expect(s.decision).toBe('continue')
  })

  it('T4 只落后 1 个窗口 → 继续', () => {
    expect(suggestAdjustment(input({ reconcile: withRow('results_goal', 'behind') })).decision).toBe('continue')
    expect(suggestAdjustment(input({ reconcile: withRow('results_goal', 'behind'), priorAdjustments: [prior('2026-11-02', 'on_track')] })).decision).toBe('continue')
  })

  it('T5 实验花费达到 max_loss_cents → 改处方并记 max_loss', () => {
    const s = suggestAdjustment(input({ experiment: { max_loss_cents: 50_000 }, spentCentsInExperiment: 50_000 }))
    expect(s.decision).toBe('revise_prescription')
    expect(s.experiment_hit).toBe('max_loss')
    expect(suggestAdjustment(input({ experiment: { max_loss_cents: 50_000 }, spentCentsInExperiment: 49_999 })).decision).toBe('continue')
  })

  it('上一条记录标了 stop_rule 命中 → 改处方', () => {
    const s = suggestAdjustment(input({ priorAdjustments: [prior('2026-11-02', 'on_track', 'stop_rule')] }))
    expect(s.decision).toBe('revise_prescription')
    expect(s.experiment_hit).toBe('stop_rule')
  })

  it('花费超出且目标没跟上 → 改处方；目标 on_track 则继续', () => {
    const over = recon([mkRow('spend', 'over'), mkRow('results_goal', 'behind'), mkRow('content', 'on_track')])
    expect(suggestAdjustment(input({ reconcile: over })).decision).toBe('revise_prescription')
    const okGoal = recon([mkRow('spend', 'over'), mkRow('results_goal', 'on_track'), mkRow('content', 'on_track')])
    expect(suggestAdjustment(input({ reconcile: okGoal })).decision).toBe('continue')
  })
})

describe('isAbnormalWindow', () => {
  it('T6 结果行 immature 不算异常', () => {
    expect(isAbnormalWindow(withRow('results_goal', 'immature'), [])).toBe(false)
  })

  it('T6 只有 results_meta 偏差（unknown / behind）不算异常', () => {
    const base = OK_ROWS()
    expect(isAbnormalWindow(recon([...base, mkRow('results_meta', 'unknown', null, null)]), [])).toBe(false)
    expect(isAbnormalWindow(recon([...base, mkRow('results_meta', 'behind')]), [])).toBe(false)
  })

  it('全部按计划、没有告警 → 正常', () => {
    expect(isAbnormalWindow(recon(OK_ROWS()), [])).toBe(false)
  })

  it('落后 / 超出 / 核心行看不清 / 对账看不清 / 执行告警 → 异常', () => {
    expect(isAbnormalWindow(withRow('content', 'behind'), [])).toBe(true)
    expect(isAbnormalWindow(withRow('spend', 'over'), [])).toBe(true)
    expect(isAbnormalWindow(withRow('spend', 'unknown'), [])).toBe(true)
    expect(isAbnormalWindow(recon(OK_ROWS(), true), [])).toBe(true)
    expect(isAbnormalWindow(recon(OK_ROWS()), [finding('daily_plan_gap')])).toBe(true)
  })

  it('等批准的草稿提醒不算异常', () => {
    expect(isAbnormalWindow(recon(OK_ROWS()), [finding('draft_ready_to_approve')])).toBe(false)
  })
})

describe('nextRecheckDate', () => {
  const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay()
  const gap = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)

  it('T7 默认 6 天', () => {
    expect(nextRecheckDate('2026-11-09')).toBe('2026-11-15') // 周一 → 周日
    expect(nextRecheckDate('2026-11-10')).toBe('2026-11-16') // 周二 → 周一
  })

  it('T7 周四起 +6 = 周三，不顺延（6 天）', () => {
    expect(nextRecheckDate('2026-11-05')).toBe('2026-11-11')
  })

  it('T7 任何起始日都不落在周五 / 周六，间隔只会是 6 或 8 天，永不为 7 的倍数', () => {
    let day = '2026-11-01'
    for (let i = 0; i < 28; i++) {
      const out = nextRecheckDate(day)
      expect([5, 6]).not.toContain(dow(out))
      expect([6, 8]).toContain(gap(day, out))
      day = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
    }
  })

  it('T7 具体：周六起 +6 = 周五 → 周日；周日起 +6 = 周六 → 周一', () => {
    expect(nextRecheckDate('2026-11-07')).toBe('2026-11-15')
    expect(nextRecheckDate('2026-11-08')).toBe('2026-11-16')
  })
})

describe('T20 客户中立', () => {
  const files = ['../adjust.ts', '../../types.ts']
  const banned = /\b(cts|roman|oztop|east\s*inter)\b|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

  it.each(files)('%s 不含客户名或客户 id', rel => {
    const src = readFileSync(join(__dirname, rel), 'utf8')
    expect(src).not.toMatch(banned)
  })
})
