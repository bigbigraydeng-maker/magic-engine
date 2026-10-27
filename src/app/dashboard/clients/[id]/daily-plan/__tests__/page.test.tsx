// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let search = ''
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'c1' }),
  useSearchParams: () => new URLSearchParams(search),
}))
vi.mock('../../_components/VisualDirectionSection', () => ({ VisualDirectionSection: () => <div>visual-direction-form</div> }))
vi.mock('../../_components/CampaignDailyPlanPanel', () => ({ CampaignDailyPlanPanel: ({ campaignId }: { campaignId: string }) => <div>post-panel:{campaignId}</div> }))
vi.mock('../../_components/DailyPlanReelsPanel', () => ({ DailyPlanReelsPanel: () => <div>reels-panel</div> }))
vi.mock('../../_components/WeekOverviewPanel', () => ({ WeekOverviewPanel: () => <div>overview-panel</div> }))

import DailyPlanPage from '../page'
import { WorkspaceViewerProvider } from '@/app/dashboard/workspace-viewer'
import { viewerFacts } from '@/lib/auth/home-entries'

function renderPlan(facts = viewerFacts('admin', null, true)) {
  return render(
    <WorkspaceViewerProvider facts={facts}>
      <DailyPlanPage />
    </WorkspaceViewerProvider>,
  )
}

beforeEach(() => {
  search = ''
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    if (url.includes('/campaign')) return { ok: true, json: async () => ({ campaigns: [] }) }
    return { ok: true, json: async () => ({ client: { id: 'c1', name: 'Test Client' } }) }
  }) as unknown as typeof fetch
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('DailyPlanPage — one concept: 社媒日常', () => {
  it('shows the 社媒日常 heading and the tabs 本周总览 | 图文帖子 | 短视频 in order', async () => {
    renderPlan()
    await screen.findByRole('heading', { level: 1, name: '社媒日常' })
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent)
    expect(tabs).toEqual(['本周总览', '图文帖子', '短视频'])
    expect(screen.getByRole('tablist', { name: '社媒日常内容类型' })).toBeInTheDocument()
    expect(screen.queryByText('每日计划')).not.toBeInTheDocument()
  })

  it('tab keys still switch panels', async () => {
    renderPlan()
    await screen.findByRole('heading', { level: 1, name: '社媒日常' })
    fireEvent.click(screen.getByRole('tab', { name: '本周总览' }))
    expect(screen.getByText('overview-panel')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '短视频' }))
    expect(screen.getByText('reels-panel')).toBeInTheDocument()
  })

  it('empty state uses 社媒日常 wording', async () => {
    renderPlan()
    await screen.findByText(/社媒日常才有内容可审核/)
  })

  it('hides week overview and reels from a client portal user', async () => {
    search = 'tab=overview'
    renderPlan(viewerFacts('client-viewer', 'c1', false))
    await screen.findByRole('heading', { level: 1, name: '社媒日常' })
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['图文帖子'])
    expect(screen.queryByText('overview-panel')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '图文帖子' })).toHaveAttribute('aria-selected', 'true')
  })

  it('drops a client who asks for the reels tab back onto posts', async () => {
    search = 'tab=reels'
    renderPlan(viewerFacts('client-viewer', 'c1', false))
    await screen.findByRole('heading', { level: 1, name: '社媒日常' })
    expect(screen.queryByText('reels-panel')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '图文帖子' })).toHaveAttribute('aria-selected', 'true')
  })
})

describe('DailyPlanPage — 图文帖子 tab: plan first, picker with short names, description and settings folded', () => {
  const campaigns = [
    { id: 'k1', title: 'Spring Launch · Four Tours · Daily Plan · Campaign', description: 'Long description.\n\nSecond paragraph.' },
    { id: 'k2', title: '秋季招募 · 新价 · Campaign', description: '' },
    { id: 'k3', title: 'Search Ads Sprint · Campaign', description: 'Ads description.' },
    { id: 'k4', title: 'Brand Engine — 30 day matrix · Campaign', description: 'Brand description.' },
  ]

  function withCampaigns(list: Array<Record<string, unknown>>) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/campaign')) return { ok: true, json: async () => ({ campaigns: list.map((c) => ({ status: 'active', ...c })) }) }
      return { ok: true, json: async () => ({ client: { id: 'c1', name: 'Test Client' } }) }
    }))
  }

  it('shows a dropdown of short names (not one long button per campaign) and the full title as the heading', async () => {
    withCampaigns(campaigns)
    renderPlan()
    const select = (await screen.findByLabelText('推广活动')) as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['Spring Launch', '秋季招募', 'Search Ads Sprint', 'Brand Engine'])
    expect(screen.getByRole('heading', { level: 2, name: campaigns[0].title })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: campaigns[0].title })).not.toBeInTheDocument()
  })

  it('puts the seven-day plan before the settings, and keeps the visual direction form inside a folded settings area', async () => {
    withCampaigns(campaigns)
    const { container } = renderPlan()
    const panel = await screen.findByText(/post-panel:/)
    const form = screen.getByText('visual-direction-form')
    expect(panel.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const settings = form.closest('details') as HTMLDetailsElement
    expect(settings).not.toBeNull()
    expect(settings.open).toBe(false)
    expect(settings.querySelector('summary')?.textContent).toContain('设置：视觉方向')
    expect(container.querySelectorAll('details').length).toBeGreaterThanOrEqual(2)
  })

  it('the long description is folded by default, and only appears when the campaign has one', async () => {
    withCampaigns(campaigns)
    renderPlan()
    const text = await screen.findByText(/Long description\./)
    const fold = text.closest('details') as HTMLDetailsElement
    expect(fold.open).toBe(false)
    expect(fold.querySelector('summary')?.textContent).toBe('活动说明')
    fireEvent.change(screen.getByLabelText('推广活动'), { target: { value: 'k2' } })
    expect(await screen.findByText('post-panel:k2')).toBeInTheDocument()
    expect(screen.queryByText('活动说明')).not.toBeInTheDocument()
  })

  it('choosing another campaign switches the plan that is shown', async () => {
    withCampaigns(campaigns)
    renderPlan()
    expect(await screen.findByText('post-panel:k1')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('推广活动'), { target: { value: 'k3' } })
    expect(await screen.findByText('post-panel:k3')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: campaigns[2].title })).toBeInTheDocument()
  })

  it('a single campaign has no picker at all', async () => {
    withCampaigns(campaigns.slice(0, 1))
    renderPlan()
    expect(await screen.findByText('post-panel:k1')).toBeInTheDocument()
    expect(screen.queryByLabelText('推广活动')).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '推广活动' })).not.toBeInTheDocument()
  })
})
