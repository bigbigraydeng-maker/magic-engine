/**
 * GrowthPanel — client view (2026-09-27). The server already strips internal findings; this
 * locks that the client layout never shows the opportunities column or finding codes, and
 * that "not checked" is never rendered as "found nothing".
 */
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'

import GrowthPanel from '../growth-panel'
import type { ClientGrowthView } from '@/lib/ads-strategy/agents/growth-client-view'

afterEach(cleanup)

const base: ClientGrowthView = {
  viewer: 'client',
  date: '2026-09-27',
  goal: { title: '九月留资', label: '留资', target: 100, dayIndex: 15, totalDays: 30 },
  goal_pace: {
    expectedToDate: 50, actualToDate: 30, gapPct: -40, projectedEnd: 40,
    verdict: 'unreachable_within_caps', reason: '按现在的速度，到期可能达不到目标。',
  },
  adCards: {
    title: '我们正在跟进的广告（1 条）',
    intro: '这次检查了 5 条正在投放的广告，下面这条有变化，其余没发现明显变差。',
    promise: '我们的广告团队已经看到这条，会在10月4日前后复查并处理，你不用动手。',
    cards: [{ adLabel: 'Spring Lead Ad', headline: '点进来的人里留下联系方式的比例降了。', detail: 'd', action: 'a' }],
    bodyReplaced: false,
  },
  adNote: null,
}

describe('GrowthPanel — client view', () => {
  it('shows goal and the client-copy card; no opportunities column, no codes, no budget wording', () => {
    const { container } = render(<GrowthPanel state={base} />)
    expect(screen.getByText('我们正在跟进的广告（1 条）')).toBeTruthy()
    expect(screen.getByText('Spring Lead Ad')).toBeTruthy()
    expect(screen.getByText(/九月留资 · 按现在的速度可能到不了/)).toBeTruthy()
    const text = container.textContent ?? ''
    expect(text).not.toContain('可以加力的地方')
    expect(text).not.toContain('要看的事')
    expect(text).not.toMatch(/\b[DO]\d{1,2}\b/)
    expect(text).not.toContain('预算')
  })

  it('no cards → shows the note (checked-nothing vs not-checked comes from the server)', () => {
    render(<GrowthPanel state={{ ...base, adCards: null, adNote: '你的广告账户这次没有逐条检查：它还没有接入每日检查。' }} />)
    expect(screen.getByText('你的广告账户这次没有逐条检查：它还没有接入每日检查。')).toBeTruthy()
    expect(screen.queryByText(/今天没发现/)).toBeNull()
  })

  it('no goal → client wording, not "这个客户"', () => {
    render(<GrowthPanel state={{ ...base, goal: null }} />)
    expect(screen.getByText('这段时间还没有设定广告目标，设好后这里会显示进度。')).toBeTruthy()
    expect(screen.queryByText(/这个客户/)).toBeNull()
  })
})

describe('GrowthPanel — O1 budget follow-up', () => {
  it('shows one simulated CTS Tours action from O1 reason through approval, receipt, KPI and observation decision', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{
        id: 'simulated-run-cts-tours',
        status: 'succeeded',
        input: { adset_id: 'simulated-adset-cts' },
        evidence: { date: '2026-10-01', current_daily_budget_cents: 5000, proposed_daily_budget_cents: 6000, currency: 'USD' },
        rationale: 'O1 连续三天点击率高于账户中位数；先人工批准后调整。',
        authorization_decision_id: 'simulated-decision',
        approval: { verdict: 'allow', decided_by: 'human', decided_at: '2026-10-01T12:00:00.000Z' },
        receipt: {
          verified: true,
          apply: { status: 'succeeded', applied: true, prior_daily_budget_cents: 5000, new_daily_budget_cents: 6000, finished_at: '2026-10-01T12:05:00.000Z' },
          readback: { status: 'succeeded', daily_budget_now: 6000, passed: true, checks: [], finished_at: '2026-10-01T12:06:00.000Z' },
        },
        observation: {
          conclusion: 'keep', reason: '目标 KPI 按现有归因阈值改善；保留本次预算，变化不代表因果证明。',
          metric_label: 'CTS Tours 新增线索（广告线索）',
          baseline: { start: '2026-09-17', end: '2026-09-30', total: 140, days: 14 },
          after: { start: '2026-10-02', end: '2026-10-15', total: 168, days: 14 },
          delta: 28, deltaPct: 20, first_review_at: '2026-10-04T12:05:00.000Z',
          window_start: '2026-10-02', window_end: '2026-10-15', window_complete: true,
          budget_matches_this_run: true,
        },
      }] }),
    })
    vi.stubGlobal('fetch', fetch)
    const state = {
      date: '2026-10-01',
      data_completeness: 'complete' as const,
      goal_pace: null,
      payload: {
        goal: { title: 'CTS Tours 旅行获客（模拟）', label: '线索', target: 100, dayIndex: 1, totalDays: 30 },
        opportunities: [{
          code: 'O1', status: 'hit' as const, title: '模拟 CTS Tours 广告组连续三天 CTR 高于账户中位数。',
          units: [{ id: 'simulated-adset-cts', name: '模拟旅行获客广告组' }],
          evidence: { ctr_by_day: '0.03|0.04|0.035', median_by_day: '0.02|0.02|0.02' },
        }],
      },
    }
    render(<GrowthPanel state={state} clientId="simulated-cts-tours" />)

    await waitFor(() => expect(screen.getByText(/目标 KPI：CTS Tours 新增线索/)).toBeTruthy())
    expect(screen.getByText(/负责人已批准/)).toBeTruthy()
    expect(screen.getByText(/Meta 回读 已核实 USD 60.00/)).toBeTruthy()
    expect(screen.getByText(/结论：保留本次预算/)).toBeTruthy()
    expect(screen.getByText(/前后变化：\+28（\+20.0%）/)).toBeTruthy()
    expect(fetch).toHaveBeenCalledWith('/api/clients/simulated-cts-tours/ad-health/o1-scale')
  })
})
