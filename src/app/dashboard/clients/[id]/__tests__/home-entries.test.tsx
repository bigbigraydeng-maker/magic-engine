// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'c1' }),
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/dashboard/clients/c1',
}))
vi.mock('../_components/GenerationDrawer', () => ({ GenerationDrawer: () => null }))
vi.mock('../_components/SettingsDrawer', () => ({ SettingsDrawer: () => null }))
vi.mock('../_components/ZhugePriorityWidget', () => ({ ZhugePriorityWidget: () => null }))
vi.mock('../_components/ZhugeDrawer', () => ({ ZhugeDrawer: () => null }))
vi.mock('../_components/NextStepCard', () => ({ NextStepCard: () => null }))
vi.mock('../_components/ClientDataTab', () => ({ ClientDataTab: () => null }))
vi.mock('../_components/LocaleConfirmBanner', () => ({ LocaleConfirmBanner: () => null }))
vi.mock('../_components/intelligence/IntelligenceSummarySection', () => ({ IntelligenceSummarySection: () => null }))
vi.mock('../_components/GoalBanner', () => ({ GoalBanner: () => null }))
vi.mock('../_components/BriefGateBanner', () => ({
  BriefGateBanner: ({ children }: { children: unknown }) => children,
}))
vi.mock('../_components/WorkLogPanel', () => ({ WorkLogPanel: () => null }))
vi.mock('../_components/fde-home/useClientHomeSignals', () => ({
  useClientHomeSignals: () => ({
    loading: false,
    headline: 'ok',
    updatedAt: null,
    cards: [],
    todayActions: [],
  }),
}))

import ClientDetailPage from '../page'
import { WorkspaceViewerProvider } from '@/app/dashboard/workspace-viewer'
import { viewerFacts, type ViewerFacts } from '@/lib/auth/home-entries'

function renderHome(facts: ViewerFacts) {
  return render(
    <WorkspaceViewerProvider facts={facts}>
      <ClientDetailPage />
    </WorkspaceViewerProvider>,
  )
}

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      client: { id: 'c1', name: 'CTS Tours', industry: 'Travel — Tour Operator' },
      brief: { id: 'brief-1' },
    }),
  }) as unknown as typeof fetch
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function openToolsFromGrid() {
  expect(screen.queryByText(/深度诊断/)).not.toBeInTheDocument()
  expect(screen.getAllByText('处方').length).toBeGreaterThan(0)
  expect(screen.getByRole('link', { name: /^处方/ })).toHaveAttribute(
    'href',
    '/dashboard/clients/c1/prescription/new',
  )
}

async function openLegacyToolsTab() {
  await screen.findByRole('heading', { level: 1, name: 'CTS Tours' })
  fireEvent.click(screen.getByRole('button', { name: '工具' }))
  await openToolsFromGrid()
}

describe('客户首页入口', () => {
  it('both/dashboard 客户看不到打不开的入口', async () => {
    renderHome(viewerFacts('client-viewer', 'c1', false))
    await openLegacyToolsTab()
    expect(screen.queryByText('Story 自动发布')).not.toBeInTheDocument()
    expect(screen.queryByText('客户记忆库')).not.toBeInTheDocument()
    expect(screen.queryByText('经营测算 · 内部')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^社媒/ }).getAttribute('href')).toContain('tab=post')
    expect(screen.getByRole('link', { name: /^出片/ }).getAttribute('href')).toBe('/dashboard/clients/c1/content-factory')
  })

  it('精确管理员走 FDE 概览，工具 Tab 不出现', async () => {
    renderHome(viewerFacts('admin', null, true))
    await screen.findByRole('heading', { level: 1, name: 'CTS Tours' })
    expect(screen.getByText('现在怎么样')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '工具' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /工作日志/ })).toBeInTheDocument()
  })
})
