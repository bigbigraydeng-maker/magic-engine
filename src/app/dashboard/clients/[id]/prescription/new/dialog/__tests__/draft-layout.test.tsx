import { cleanup, render, screen } from '@testing-library/react'
import { buildEffectJudgmentCard } from '@/lib/ads-strategy/effect-judgment/card'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CHAT_NOTE } from '../present'
import { PrescriptionDialog } from '../PrescriptionDialog'

vi.mock('@/lib/ads/use-client-ad-currency', () => ({
  useClientAdCurrency: () => 'NZD',
}))

const CLIP = /(?:^|\s)(?:truncate|line-clamp-\d+|overflow-hidden|whitespace-nowrap)(?:\s|$)/
const LONG_TITLE = '回线索：每条新线索 24 小时内有人回复'
const LONG_SUMMARY = '先把报名写清楚。一条线索 $12 = $100 × 0.12；第二天再看。（1）先停贵的组'

const layoutContent = {
  summary: LONG_SUMMARY,
  narrative: '先改落地页，再看线索。',
  phases: [{
    phase_number: 1,
    name: '投放中',
    duration_weeks: 5,
    actions: [{
      id: 'a1',
      title: LONG_TITLE,
      description: '销售按客人选的团、时间和预算推荐班次。',
      dimension: 'ads',
      fix_type: 'fde_manual',
      phase: 1,
      effort: 'low',
      impact: 'high',
      finding_ids: ['should-not-show'],
    }],
  }],
  kpi_targets: [{
    metric: '一条线索的成本，继续线 $12 = 目标成本 C（按当前数据算，第 7 天重算）',
    current_value: null,
    target_value: 12,
    unit: 'NZD',
    dimension: 'ads',
  }],
  budget_allocation: [],
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function stub(prescription: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
    const url = String(input)
    if (url.includes('zhangqian/latest')) return json({ discovery: { id: 'd1', confirmed_at: '2026-01-01' } })
    if (url.includes('active-list')) return json({ goals: [{ id: 'g1', title: '十一月线索' }] })
    if (url.includes('/prescription/p1')) return json({ prescription })
    return json({ error: 'unexpected' }, 500)
  }))
}

function renderDialog() {
  return render(
    <PrescriptionDialog clientId="c1" prescriptionId="p1" goalId={null} supplementOf={null} reviseOf={null} />,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('处方页排版', () => {
  it('shows an approved notice without the draft hint, and keeps the long text collapsed', async () => {
    stub({
      id: 'p1',
      status: 'approved',
      content: layoutContent,
      intake: {
        business_goal: '十一月线索',
        timeline_urgency: 'short_term',
        monthly_budget_aud: 3700,
        budget_currency: 'NZD',
        priority_dimensions: [],
        notes: null,
      },
      agent_name: null,
      generation_meta: { source: 'manual' },
    })
    renderDialog()

    expect(await screen.findByText('已同意')).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('已同意')
    expect(screen.getByRole('note')).not.toHaveTextContent('还没同意')
    expect(screen.getByRole('note')).not.toHaveTextContent('点「同意」')
    expect(screen.queryByRole('button', { name: '同意' })).not.toBeInTheDocument()

    const full = screen.getByText('看处方全文').closest('details')
    expect(full).not.toHaveAttribute('open')
    expect(full?.querySelectorAll('p').length).toBeGreaterThan(1)
    expect(full?.querySelector('p')?.className).toContain('font-normal')
    expect(full?.querySelector('p')?.className).not.toMatch(/font-black|font-bold/)
    expect(full).toHaveTextContent('先把报名写清楚。')
    expect(full).toHaveTextContent('（1）先停贵的组')
    expect(screen.queryByRole('heading', { name: /\$100/ })).not.toBeInTheDocument()

    const formula = screen.getByText('怎么算的').closest('details')
    expect(formula).not.toHaveAttribute('open')
    expect(formula).toHaveTextContent('$12 = 目标成本 C')
    expect(screen.getAllByText('一条线索的成本，继续线').length).toBeGreaterThan(0)
    expect(screen.queryByText('$12 = 目标成本 C（按当前数据算，第 7 天重算）')).not.toBeVisible()
    expect(screen.getByText('每天预算').parentElement).toHaveTextContent('读不到')
    expect(screen.getByText('总预算').parentElement).toHaveTextContent('NZ$3,700.00')

    const step = screen.getByText(LONG_TITLE).closest('li')
    expect(step?.className ?? '').not.toMatch(CLIP)
    expect(step?.querySelector('[class*="truncate"], [class*="line-clamp"], [class*="overflow-hidden"]')).toBeNull()
    for (const node of step?.querySelectorAll('*') ?? []) {
      expect(node.className).not.toMatch(CLIP)
    }

    expectChatBeforePlan()
    expect(screen.queryByText('对话不会留下')).not.toBeInTheDocument()
    expect(document.querySelector('footer')).toBeNull()
    expect(document.querySelector('.fixed')).toBeNull()
    expect(screen.getByRole('region', { name: '怎么判断有没有效果' })).toHaveTextContent('这份处方还没有效果判断卡')
  })

  it('shows the effect card in plain sentences, not as raw data', async () => {
    const card = buildEffectJudgmentCard({
      goal: {
        periodStart: '2026-10-01',
        periodEnd: '2026-10-30',
        targetValue: 100,
        baselineValue: 0,
        budgetCurrency: 'NZD',
      },
      approvedCost: { amount: 12, currency: 'NZD' },
      approvedCostState: 'value',
      prescriptionCosts: [],
      dailyCapCents: 5000,
      dailyCapState: 'value',
      today: '2026-10-20',
      actualToDate: 70,
      medianCostCents: 1200,
      sampleDays: null,
      loadError: null,
    })
    stub({
      id: 'p1',
      status: 'draft',
      content: layoutContent,
      intake: {
        business_goal: '十一月线索',
        timeline_urgency: 'short_term',
        monthly_budget_aud: 3700,
        budget_currency: 'NZD',
        priority_dimensions: [],
        notes: null,
      },
      agent_name: 'huatuo',
      generation_meta: { measure: card },
    })
    renderDialog()
    const block = await screen.findByRole('region', { name: '怎么判断有没有效果' })
    expect(block).toHaveTextContent('每个结果最多花 12 NZD')
    expect(block).toHaveTextContent('每天最多花 50 NZD')
    expect(block).toHaveTextContent('不会改广告预算')
    expect(block).toHaveTextContent('2026年10月7日')
    expect(block.textContent).not.toMatch(/[{}[\]]/)
  })

  it('shows the agree hint on a draft only when the agree button is there', async () => {
    stub({
      id: 'p1',
      status: 'draft',
      content: layoutContent,
      intake: {
        business_goal: '十一月线索',
        timeline_urgency: 'short_term',
        monthly_budget_aud: 3700,
        budget_currency: 'NZD',
        priority_dimensions: [],
        notes: null,
      },
      agent_name: 'huatuo',
    })
    const draft = renderDialog()
    expect(await screen.findByRole('button', { name: '同意' })).toBeInTheDocument()
    expectChatBeforePlan()
    expect(screen.getByRole('note')).toHaveTextContent('还没同意')
    expect(screen.getByRole('note')).toHaveTextContent('点「同意」')
    expect(screen.getByText('草稿')).toBeInTheDocument()
    draft.unmount()

    stub({ id: 'p1', status: 'draft', content: null, agent_name: null })
    renderDialog()
    expect(await screen.findByText(/还没同意/)).toBeInTheDocument()
    expect(screen.queryByText(/点「同意」/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '同意' })).not.toBeInTheDocument()
  })
})

function expectChatBeforePlan() {
  const box = screen.getByRole('textbox', { name: '跟华佗说' })
  const goal = screen.getByText('十一月线索')
  const stage = screen.getByRole('heading', { name: /投放中/ })
  const changes = screen.getByRole('heading', { name: '想看到的变化' })
  const full = screen.getByText('看处方全文')
  expect(comesBefore(box, goal)).toBe(true)
  expect(comesBefore(goal, stage)).toBe(true)
  expect(comesBefore(stage, changes)).toBe(true)
  expect(comesBefore(changes, full)).toBe(true)
  expect(box.className).toMatch(/min-h-40/)
  expect(box.closest('form')?.className).toMatch(/rounded-3xl/)
  expect(screen.getByText(CHAT_NOTE)).toBeInTheDocument()
}

function comesBefore(earlier: HTMLElement, later: HTMLElement): boolean {
  return (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}
