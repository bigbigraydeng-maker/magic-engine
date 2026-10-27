import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PrescriptionDialog } from '../PrescriptionDialog'

vi.mock('@/lib/ads/use-client-ad-currency', () => ({
  useClientAdCurrency: () => 'NZD',
}))

const draftContent = {
  summary: '先把价格写清楚',
  narrative: '先改落地页，再看线索。',
  phases: [{
    phase_number: 1,
    name: '先做',
    duration_weeks: 2,
    actions: [{
      id: 'a1',
      title: '改落地页',
      description: '把价格写在第一屏',
      dimension: 'ads',
      fix_type: 'fde_manual',
      phase: 1,
      effort: 'low',
      impact: 'high',
      finding_ids: ['should-not-show'],
    }],
  }],
  kpi_targets: [{ metric: '线索', current_value: 10, target_value: 300, unit: '条', dimension: 'ads' }],
  budget_allocation: [],
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function sse(events: object[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('处方对话框', () => {
  it('shows the saved prescription and the agree button, without a paste link', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      const url = String(input)
      if (url.includes('zhangqian/latest')) return json({ discovery: { id: 'd1', confirmed_at: '2026-01-01' } })
      if (url.includes('active-list')) return json({ goals: [{ id: 'g1', title: '十一月线索' }] })
      if (url.includes('latest-draft')) {
        return json({
          prescription: {
            id: 'p1',
            status: 'draft',
            content: draftContent,
            intake: { business_goal: '300 条线索', timeline_urgency: 'short_term', monthly_budget_aud: 3700, budget_currency: 'NZD', priority_dimensions: [], notes: null },
            agent_name: 'huatuo',
            self_grade: { overall: 7, dimensions: {}, weaknesses: [{ dimension: 'realism', severity: 'low', text: 'realism 价格还不够具体' }] },
          },
        })
      }
      return json({ error: 'unexpected' }, 500)
    }))

    const view = render(<PrescriptionDialog clientId="c1" prescriptionId={null} goalId={null} supplementOf={null} reviseOf={null} />)
    expect(await screen.findByText('改落地页')).toBeInTheDocument()
    const box = screen.getByRole('textbox', { name: '跟华佗说' })
    expect(box.compareDocumentPosition(screen.getByText('改落地页')) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    const fullText = screen.getByText('看处方全文').closest('details')
    expect(fullText).not.toHaveAttribute('open')
    expect(fullText).toHaveTextContent('先把价格写清楚')
    expect(screen.getByText('改落地页')).toBeInTheDocument()
    expect(screen.getByText(/价格还不够具体/)).toBeInTheDocument()
    expect(screen.queryByText('should-not-show')).not.toBeInTheDocument()
    expect(screen.queryByText(/贴入处方草稿/)).not.toBeInTheDocument()
    expect(screen.queryByText(/诸葛亮/)).not.toBeInTheDocument()
    expect(screen.queryByText(/广告 Agent/)).not.toBeInTheDocument()
    expect(screen.queryByText(/huatuo/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '同意' })).toBeInTheDocument()
    expect(document.querySelector('input[type="file"]')).toBeNull()
    view.unmount()

    render(<PrescriptionDialog clientId="c1" prescriptionId={null} goalId={null} supplementOf={null} reviseOf={null} />)
    expect(await screen.findByText('改落地页')).toBeInTheDocument()
    expect(screen.queryByText(/我刚才说/)).not.toBeInTheDocument()
  })

  it('puts the plan result on the agree reply', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'PATCH') {
        return json({
          success: true,
          plan_approval: { text: '计划草稿有 1 项必过检查没有全绿，所以没有自动批准，只批准了处方。已出确认卡，请负责人在卡上看过再决定。' },
        })
      }
      if (url.includes('zhangqian/latest')) return json({ discovery: { id: 'd1', confirmed_at: '2026-01-01' } })
      if (url.includes('active-list')) return json({ goals: [{ id: 'g1', title: '十一月线索' }] })
      if (url.includes('latest-draft')) {
        return json({
          prescription: {
            id: 'p1', status: 'draft', content: draftContent, agent_name: 'huatuo',
            intake: { business_goal: '300 条线索', timeline_urgency: 'short_term', monthly_budget_aud: 3700, budget_currency: 'NZD', priority_dimensions: [], notes: null },
          },
        })
      }
      return json({ error: 'unexpected' }, 500)
    }))

    render(<PrescriptionDialog clientId="c1" prescriptionId={null} goalId={null} supplementOf={null} reviseOf={null} />)
    fireEvent.click(await screen.findByRole('button', { name: '同意' }))
    fireEvent.click(screen.getByRole('button', { name: '确定批准' }))
    expect(await screen.findByText(/这一步不是开始花钱/)).toBeInTheDocument()
    expect(screen.getByText(/没有自动批准/)).toBeInTheDocument()
    expect(screen.getByText(/已出确认卡/)).toBeInTheDocument()
  })

  it('shows a failure, not "writing", when a prescription that was still writing on open fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      const url = String(input)
      if (url.includes('zhangqian/latest')) return json({ discovery: { id: 'd1', confirmed_at: '2026-01-01' } })
      if (url.includes('active-list')) return json({ goals: [{ id: 'g1', title: '十一月线索' }] })
      if (url.includes('latest-draft')) return json({ prescription: { id: 'p3', status: 'generating', content: null, agent_name: 'huatuo' } })
      if (url.endsWith('/prescription/p3')) {
        return json({ prescription: { id: 'p3', status: 'failed', content: null, error_message: '模型超时了', progress_note: null } })
      }
      return json({ error: 'unexpected' }, 500)
    }))

    render(<PrescriptionDialog clientId="c1" prescriptionId={null} goalId={null} supplementOf={null} reviseOf={null} />)
    expect(await screen.findByText('模型超时了')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('这版没写成')
    expect(screen.queryByText(/华佗正在写/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: '跟华佗说' }), { target: { value: '再开一个要 300 条线索的方，预算 3700' } })
    expect(screen.getByRole('button', { name: '发送' })).toBeEnabled()
  })

  it('sends a plain sentence to the existing generate endpoint', async () => {
    const posts: Array<Record<string, unknown>> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('zhangqian/latest')) return json({ discovery: { id: 'd1', confirmed_at: '2026-01-01' } })
      if (url.includes('active-list')) return json({ goals: [{ id: 'g1', title: '十一月线索' }] })
      if (url.includes('latest-draft')) return json({ error: 'none' }, 404)
      if (url.endsWith('/prescription/generate')) {
        posts.push(JSON.parse(String(init?.body)))
        return sse([
          { type: 'started', prescription_id: 'p2' },
          { type: 'done', prescription_id: 'p2', content: draftContent },
        ])
      }
      return json({ error: 'unexpected' }, 500)
    }))

    render(<PrescriptionDialog clientId="c1" prescriptionId={null} goalId={null} supplementOf={null} reviseOf={null} />)
    const box = await screen.findByRole('textbox', { name: '跟华佗说' })
    fireEvent.change(box, { target: { value: '开一个要 300 条线索的方，预算 3700' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(await screen.findByText('改落地页')).toBeInTheDocument()
    expect(posts).toHaveLength(1)
    expect(posts[0]).toMatchObject({
      discovery_id: 'd1',
      goal_id: 'g1',
      intake: { monthly_budget_aud: 3700, budget_currency: 'NZD' },
    })
    expect(screen.queryByText(/\{/)).not.toBeInTheDocument()
  })
})
