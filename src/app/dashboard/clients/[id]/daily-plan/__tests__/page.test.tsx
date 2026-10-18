// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'c1' }),
  useSearchParams: () => new URLSearchParams(''),
}))
vi.mock('../../_components/VisualDirectionSection', () => ({ VisualDirectionSection: () => null }))
vi.mock('../../_components/CampaignDailyPlanPanel', () => ({ CampaignDailyPlanPanel: () => <div>post-panel</div> }))
vi.mock('../../_components/DailyPlanReelsPanel', () => ({ DailyPlanReelsPanel: () => <div>reels-panel</div> }))
vi.mock('../../_components/WeekOverviewPanel', () => ({ WeekOverviewPanel: () => <div>overview-panel</div> }))

import DailyPlanPage from '../page'

beforeEach(() => {
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
    render(<DailyPlanPage />)
    await screen.findByRole('heading', { level: 1, name: '社媒日常' })
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent)
    expect(tabs).toEqual(['本周总览', '图文帖子', '短视频'])
    expect(screen.getByRole('tablist', { name: '社媒日常内容类型' })).toBeInTheDocument()
    expect(screen.queryByText('每日计划')).not.toBeInTheDocument()
  })

  it('tab keys still switch panels', async () => {
    render(<DailyPlanPage />)
    await screen.findByRole('heading', { level: 1, name: '社媒日常' })
    fireEvent.click(screen.getByRole('tab', { name: '本周总览' }))
    expect(screen.getByText('overview-panel')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '短视频' }))
    expect(screen.getByText('reels-panel')).toBeInTheDocument()
  })

  it('empty state uses 社媒日常 wording', async () => {
    render(<DailyPlanPage />)
    await screen.findByText(/社媒日常才有内容可审核/)
  })
})
