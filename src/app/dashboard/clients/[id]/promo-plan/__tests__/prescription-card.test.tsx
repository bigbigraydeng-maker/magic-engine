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
    phases: [],
    kpis: [],
    manual_action_count: 1,
    line: '处方 v2 · 草稿 · 1 条人工动作',
    currency: 'NZD',
    todos: ['建成暂停的系列', '第 7 天看一次结果'],
    rules: ['到了暂停线就停'],
    why: ['现在最要紧的是先把能投的草稿建好。', '花得比配速快就先停。'],
    spend: { daily: '12 NZD', total: '100 NZD', pacing: null },
    review_anchor: '2026-10-01',
    ...over,
  }
}

describe('处方卡', () => {
  it('用四段大白话讲清楚，规矩默认收起，没有写入按钮', () => {
    const { container } = render(
      <PrescriptionCard clientId="client-1" prescription={view()} today="2026-10-01" />,
    )
    expect(screen.getByRole('heading', { name: '处方' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '这周做什么' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '为什么' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '花多少' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '什么时候复盘' })).toBeTruthy()
    expect(screen.getByText('建成暂停的系列')).toBeTruthy()
    expect(screen.getByText('第 7 天看一次结果')).toBeTruthy()
    expect(screen.getByText('现在最要紧的是先把能投的草稿建好。')).toBeTruthy()
    expect(screen.getByText('花得比配速快就先停。')).toBeTruthy()
    expect(screen.getByText('每天：12 NZD')).toBeTruthy()
    expect(screen.getByText('总共：100 NZD')).toBeTruthy()
    expect(screen.getByText('配速：还没写下')).toBeTruthy()
    expect(screen.getByText('第 7 天：10月7日')).toBeTruthy()
    expect(screen.getByText('第 14 天：10月14日')).toBeTruthy()
    expect(screen.getByText('距第 7 天还有 6 天')).toBeTruthy()
    expect(screen.getByText('到了暂停线就停')).toBeTruthy()
    const rules = screen.getByText('规矩').closest('details') as HTMLDetailsElement | null
    expect(rules?.open).toBe(false)
    expect(screen.getByText('v2 · 草稿')).toBeTruthy()
    expect(screen.getByText('开方人：开方人甲')).toBeTruthy()
    expect(screen.getByRole('link', { name: '去处方页查看' }).getAttribute('href'))
      .toBe('/dashboard/clients/client-1/prescription/new?goal_id=goal-1')
    expect(container.querySelectorAll('button')).toHaveLength(0)
    // 计划草稿建议面板里有一句「批准这份处方不等于批准花这些钱」的免责提示，不是批准入口；
    // 其余部分仍然不许出现「批准」。
    const withoutSeedPanel = container.cloneNode(true) as HTMLElement
    withoutSeedPanel.querySelector('[data-plan-seed-panel]')?.remove()
    expect(withoutSeedPanel.textContent).not.toMatch(/批准/)
    expect(container.textContent).not.toMatch(/\{/)
    expect(container.textContent).not.toMatch(/阶段/)
    expect(container.textContent).not.toMatch(/AUD/)
  })

  it('没写下的原因、花费和起算日留空，不填默认币种', () => {
    const { container } = render(<PrescriptionCard clientId="client-1" prescription={view({
      prescriber: null,
      currency: null,
      goal_id: '',
      todos: [],
      rules: [],
      why: [],
      spend: { daily: null, total: null, pacing: null },
      review_anchor: null,
    })} today="2026-10-01" />)
    expect(screen.getByText('开方人：未填写')).toBeTruthy()
    expect(screen.getByText('这份处方没有单独列出要做的事。')).toBeTruthy()
    expect(screen.getByText('这份处方没有写下原因。')).toBeTruthy()
    expect(screen.getByText('每天、总共、配速都还没写在这份处方里。')).toBeTruthy()
    expect(screen.getByText('还没写下从哪天起算，所以算不出还剩几天。')).toBeTruthy()
    expect(screen.getByText('没有单独的规矩。')).toBeTruthy()
    expect(screen.getByRole('link', { name: '去处方页查看' }).getAttribute('href'))
      .toBe('/dashboard/clients/client-1/prescription/new')
    expect(container.textContent).not.toMatch(/AUD/)
    expect(container.textContent).not.toMatch(/NZD/)
  })
})
