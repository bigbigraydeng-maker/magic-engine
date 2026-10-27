/**
 * GrowthPanel — client view (2026-09-27). The server already strips internal findings; this
 * locks that the client layout never shows the opportunities column or finding codes, and
 * that "not checked" is never rendered as "found nothing".
 */
import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

import GrowthPanel, { type GrowthStateView } from '../growth-panel'
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

function internalState(dataThrough?: string): GrowthStateView {
  return {
    date: '2026-09-16',
    data_completeness: 'complete',
    goal_pace: {
      expectedToDate: 50, actualToDate: 30, gapPct: -40, projectedEnd: 40,
      verdict: 'behind', reason: '落后',
      ...(dataThrough ? { dataThrough } : {}),
    },
    payload: {
      goal: { title: '九月留资', label: '留资', target: 100, dayIndex: 16, totalDays: 30 },
      problems: [],
      opportunities: [],
    },
  }
}

describe('GrowthPanel — 数据截至', () => {
  it('没有 dataThrough 时不显示「数据截至昨天」', () => {
    const { container } = render(<GrowthPanel state={internalState()} />)
    expect(container.textContent ?? '').not.toContain('数据截至')
  })

  it('有 dataThrough 才显示这一天', () => {
    render(<GrowthPanel state={internalState('2026-09-15')} />)
    expect(screen.getByText(/数据截至2026-09-15/)).toBeTruthy()
  })
})
