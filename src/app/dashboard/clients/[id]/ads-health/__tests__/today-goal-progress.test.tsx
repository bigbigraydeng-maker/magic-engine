/**
 * TodayGoalProgress — 「今天看这里」目标进度条展示。
 */
import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

import { TodayGoalProgress } from '../today-goal-progress'
import type { GrowthStateView } from '../growth-panel'
import type { ClientGrowthView } from '@/lib/ads-strategy/agents/growth-client-view'

afterEach(() => cleanup())

const CLIENT = '00000000-0000-0000-0000-000000000001'

function staffState(over: Partial<GrowthStateView> = {}): GrowthStateView {
  return {
    date: '2026-10-20',
    data_completeness: 'complete',
    goal_pace: {
      expectedToDate: 65,
      actualToDate: 101,
      gapPct: 55,
      projectedEnd: 280,
      verdict: 'on_track',
      reason: '按节奏',
      dataThrough: '2026-10-19',
    },
    payload: {
      goal: {
        title: '示例留资目标',
        label: '留资',
        target: 300,
        dayIndex: 8,
        totalDays: 37,
        primaryMetricKey: 'leads_count',
      },
      problems: [],
      opportunities: [],
    },
    ...over,
  }
}

const clientBase: ClientGrowthView = {
  viewer: 'client',
  date: '2026-10-20',
  goal: { title: '示例留资目标', label: '留资', target: 300, dayIndex: 8, totalDays: 37 },
  goal_pace: {
    expectedToDate: 65,
    actualToDate: 101,
    gapPct: 55,
    projectedEnd: 280,
    verdict: 'on_track',
    reason: '目前按节奏在走。',
  },
  adCards: null,
  adNote: null,
}

describe('TodayGoalProgress', () => {
  it('shows target / done / expected / day index and projection label', () => {
    const { container } = render(
      <TodayGoalProgress state={staffState()} clientId={CLIENT} todayCrmLeads={4} />,
    )
    const text = container.textContent ?? ''
    expect(screen.getByText(/目标进度/)).toBeTruthy()
    expect(text).toContain('300')
    expect(text).toContain('101')
    expect(text).toContain('65')
    expect(text).toMatch(/第\s*8\s*天/)
    expect(text).toMatch(/共\s*37\s*天/)
    expect(text).toContain('只按目前速度推算')
    expect(text).toContain('今天 CRM 已到')
    expect(text).toContain('4')
  })

  it('unknown verdict → 判不了, no progress bar fill', () => {
    const { container } = render(
      <TodayGoalProgress
        state={staffState({
          goal_pace: {
            expectedToDate: null,
            actualToDate: null,
            gapPct: null,
            projectedEnd: null,
            verdict: 'unknown',
            reason: '归属数据还没齐',
          },
        })}
        clientId={CLIENT}
      />,
    )
    expect(screen.getByText('判不了')).toBeTruthy()
    expect(screen.getByText('归属数据还没齐')).toBeTruthy()
    expect(container.querySelector('.rounded-full.bg-white\\/70')).toBeNull()
  })

  it('signups goal → 还没设目标 with link for staff', () => {
    render(
      <TodayGoalProgress
        state={staffState({
          payload: {
            goal: {
              title: '定金座位',
              label: '报名',
              target: 30,
              dayIndex: 3,
              totalDays: 60,
              primaryMetricKey: 'signups_count',
            },
            problems: [],
            opportunities: [],
          },
          goal_pace: null,
        })}
        clientId={CLIENT}
      />,
    )
    expect(screen.getByText(/还没设目标/)).toBeTruthy()
    expect(screen.getByRole('link', { name: '去目标页设置' })).toBeTruthy()
  })

  it('client view omits staff-only links and internal field names', () => {
    const { container } = render(
      <TodayGoalProgress state={clientBase} clientId={CLIENT} todayCrmLeads={2} />,
    )
    const text = container.textContent ?? ''
    expect(text).not.toContain('primaryMetricKey')
    expect(text).not.toContain('reachableAtCap')
    expect(screen.queryByRole('link', { name: '去目标页设置' })).toBeNull()
  })
})
