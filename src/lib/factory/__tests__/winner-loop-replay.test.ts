/**
 * 赢家闭环考卷（设计稿 2026-11-05 §6，藏经阁第九部）。合成数据，不联网、不调模型。
 * 答案「待 PM 确认」：PM 确认后把这行去掉。第 1 刀真跑 Q2、Q5，其余在后续刀加：
 *   Q1 变体不像赢家 —— 待第 2 刀
 *   Q6 事实过期     —— 待第 2 刀
 *   Q7 拆错骨架     —— 待第 2 刀（接马良 v2 复核时加）
 *   Q3 按客户主结果误判 —— 待重启 ①
 *   Q4 位置混比     —— 待重启 ⑤
 */

import { describe, expect, it } from 'vitest'
import { usableWinnerSlices, winnerDecisionEventId, type WinnerRow } from '../winner-gate'
import { decideSignal, pickWinner } from '../strategist'
import type { DemandSignal, GateContext, WinnerSlice } from '../types'

const NOW = Date.parse('2026-11-05T09:00:00Z')
const AT = '2026-11-05T08:00:00.000Z'

function signal(over: Partial<DemandSignal> = {}): DemandSignal {
  return {
    id: 'sig-1',
    client_id: 'c1',
    signal_type: 'creative_fatigue',
    source: 'test',
    dedupe_key: 'fatigue:test',
    confidence: 0.9,
    evidence: { ad_id: 'ad_1' },
    request: {},
    status: 'received',
    expires_at: new Date(NOW + 86_400_000).toISOString(),
    created_at: new Date(NOW).toISOString(),
    ...over,
  }
}

function ctx(activeWinners: WinnerSlice[]): GateContext {
  return {
    now: new Date(NOW),
    signal: signal(),
    openOrderAdIds: [],
    brief: {
      id: 'brief-1',
      core_proposition: 'Trusted China tours for Kiwis',
      content_pillars: ['Best of China group tours'],
      keyword_seeds: [],
      excluded_topics: [],
    },
    goal: { id: 'goal-1', title: 'Leads growth', primary_metric_key: 'leads_count' },
    brandRedlines: [],
    recentAngles: [],
    blocklist: [],
    activeWinners,
    balanceUsd: 20,
    dailyOrderCount: 0,
    dailyCostUsd: 0,
    clipStock: [],
    allowBTrackLandmarkAds: true,
    verifiedOffer: null,
  }
}

function confirmedRow(id: string, perf: Record<string, unknown>, extra: Partial<WinnerRow> = {}): WinnerRow {
  return {
    id,
    client_id: 'c1',
    status: 'active',
    hook_segment: { description: `price card hook ${id}` },
    middle_segment: {},
    cta_segment: {},
    win_reason_tags: [],
    cost_per_thruplay: null,
    current_frequency: null,
    updated_at: AT,
    performance: {
      program_check: { state: 'passed', at: AT },
      pm_decision: {
        decision: 'approved',
        by: 'pm@example.com',
        role: 'magic_lab',
        event_id: winnerDecisionEventId(id, 'approved', AT),
        at: AT,
        acknowledged_check_state: 'passed',
      },
      ...perf,
    },
    ...extra,
  }
}

describe('Q2 按错的尺子挑赢家（待 PM 确认）', () => {
  it('看完成本低但每个留资贵的 A 输给每个留资便宜的 B；缺单次成本的 Intake 行不可用', () => {
    const a = confirmedRow('a', { cost_per_result: 20.5 }, { cost_per_thruplay: 0.001 })
    const b = confirmedRow('b', { cost_per_result: 4.57 }, { cost_per_thruplay: 0.05 })
    const intake: WinnerRow = {
      ...confirmedRow('intake', {}, { cost_per_thruplay: 0.0001 }),
      performance: { notes: 'from airtable', source: 'winner_intake_airtable' },
    }
    const usable = usableWinnerSlices([a, intake, b], NOW)
    expect(usable.map((w) => w.id)).toEqual(['b', 'a'])
    expect(pickWinner(ctx(usable))?.id).toBe('b')
  })
})

describe('Q5 候选不出片（待 PM 确认）', () => {
  const base = confirmedRow('w', { cost_per_result: 4.57 })
  const decisionOf = (base.performance as Record<string, unknown>).pm_decision

  it('status=active 但没有 pm_decision → 共享读取函数返回空，工单不挂骨架', () => {
    const row = { ...base, performance: { program_check: { state: 'passed', at: AT }, cost_per_result: 4.57 } }
    const usable = usableWinnerSlices([row], NOW)
    expect(usable).toEqual([])
    const d = decideSignal(ctx(usable))
    expect(d.outcome).toBe('accepted')
    if (d.outcome === 'accepted') expect(d.workOrder.winner_structure_id).toBeNull()
  })

  it('确认过的同一条 → 工单挂上这条骨架（反例，证明上一题不是因为别的原因没挂）', () => {
    const d = decideSignal(ctx(usableWinnerSlices([base], NOW)))
    expect(d.outcome).toBe('accepted')
    if (d.outcome === 'accepted') expect(d.workOrder.winner_structure_id).toBe('w')
  })

  it('缺键 / 解析失败 / 取值不在固定集合 → 不可用', () => {
    const variants: unknown[] = [
      null,
      'not-json',
      { cost_per_result: 4.57 },
      { program_check: { state: 'ok', at: AT }, pm_decision: decisionOf, cost_per_result: 4.57 },
      { program_check: { state: 'passed', at: 'yesterday' }, pm_decision: decisionOf, cost_per_result: 4.57 },
    ]
    for (const performance of variants) {
      expect(usableWinnerSlices([{ ...base, performance }], NOW)).toEqual([])
    }
  })

  it('Intake 刚录进来的新行（只有备注）→ 不可用', () => {
    const row = { ...base, performance: { notes: 'x', source: 'winner_intake_airtable' } }
    expect(usableWinnerSlices([row], NOW)).toEqual([])
  })

  it('刷新表现数据（只合并 cost_per_result 等字段）后确认状态还在 → 仍可用', () => {
    const refreshed = { ...base, performance: { ...(base.performance as Record<string, unknown>), cost_per_result: 5.1, leads: 130 } }
    expect(usableWinnerSlices([refreshed], NOW).map((w) => w.id)).toEqual(['w'])
  })
})
