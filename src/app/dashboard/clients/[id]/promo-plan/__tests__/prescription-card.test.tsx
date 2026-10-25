import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { GoalPrescriptionView } from '@/lib/marketing-plan/promo/goal-prescription'
import { PrescriptionCard } from '../_components/PrescriptionCard'

afterEach(cleanup)

function view(over: Partial<GoalPrescriptionView> = {}): GoalPrescriptionView {
  return {
    id: 'rx-1',
    goal_id: 'goal-1',
    status: 'draft',
    status_label: '草稿',
    version: 2,
    prescriber: '开方人甲',
    summary: '摘要甲',
    phases: [{
      phase_number: 1,
      name: '准备',
      duration_weeks: 1,
      actions: [
        { id: 'a1', title: '动作一', description: '说明一', manual: true },
        { id: 'a2', title: '自动动作', description: '', manual: false },
      ],
    }],
    kpis: [
      { metric: '线索', current_value: 0, target_value: 10, unit: '条', timeframe: null },
      { metric: '成本', current_value: null, target_value: 12, unit: 'NZD', timeframe: '本周期' },
    ],
    manual_action_count: 1,
    line: '处方 v2 · 草稿 · 1 条人工动作',
    currency: 'NZD',
    ...over,
  }
}

describe('处方卡', () => {
  it('只读展示开方人、状态、版本、摘要、阶段、动作和指标，并链到处方页', () => {
    const { container } = render(<PrescriptionCard clientId="client-1" prescription={view()} />)
    expect(screen.getByRole('heading', { name: '处方' })).toBeTruthy()
    expect(screen.getByText('v2 · 草稿')).toBeTruthy()
    expect(screen.getByText('开方人：开方人甲')).toBeTruthy()
    expect(screen.getByText('摘要甲')).toBeTruthy()
    expect(screen.getByText('阶段 1 · 准备 · 1 周')).toBeTruthy()
    expect(screen.getByText('动作一')).toBeTruthy()
    expect(screen.getAllByText('人工执行')).toHaveLength(1)
    expect(screen.getByText('线索：0 → 10 条')).toBeTruthy()
    expect(screen.getByText('成本：— → 12 NZD（本周期）')).toBeTruthy()
    expect(screen.getByText('币种：NZD')).toBeTruthy()
    expect(screen.getByRole('link', { name: '看完整处方' }).getAttribute('href'))
      .toBe('/dashboard/clients/client-1/prescription/new?goal_id=goal-1')
    expect(container.querySelectorAll('button')).toHaveLength(0)
    expect(container.textContent).not.toMatch(/批准/)
    expect(container.textContent).not.toMatch(/AUD/)
  })

  it('没有币种就不写币种，也不填默认币种；开方人空着写未填写', () => {
    const { container } = render(<PrescriptionCard clientId="client-1" prescription={view({
      prescriber: null,
      currency: null,
      summary: '',
      kpis: [{ metric: '线索', current_value: 0, target_value: 3, unit: '条', timeframe: null }],
    })} />)
    expect(screen.getByText('开方人：未填写')).toBeTruthy()
    expect(screen.queryByText(/币种/)).toBeNull()
    expect(container.textContent).not.toMatch(/AUD/)
  })
})
