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
vi.mock('../../../factory/_components/ReviewInbox', () => ({ ReviewInbox: () => null }))

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

async function openTools() {
  await screen.findByRole('heading', { level: 1, name: 'CTS Tours' })
  fireEvent.click(screen.getByRole('button', { name: '工具' }))
}

describe('客户首页入口', () => {
  it('both/dashboard 客户看不到打不开的入口', async () => {
    renderHome(viewerFacts('client-viewer', 'c1', false))
    await openTools()
    expect(screen.queryByText('Story 自动发布')).not.toBeInTheDocument()
    expect(screen.queryByText('客户记忆库')).not.toBeInTheDocument()
    expect(screen.queryByText('经营测算 · 内部')).not.toBeInTheDocument()
    expect(screen.queryByText('GEO Composer')).not.toBeInTheDocument()
    expect(screen.queryByText('AI 可见度追踪')).not.toBeInTheDocument()
    expect(screen.queryByText('等你点头的广告')).not.toBeInTheDocument()
    expect(screen.queryByText('视频工厂素材标签与审核')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '日志' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^社媒/ }).getAttribute('href')).toContain('tab=post')
    expect(screen.getByRole('link', { name: /^出片/ }).getAttribute('href')).toBe('/dashboard/clients/c1/content-factory')
    expect(screen.getByRole('link', { name: /^博客/ })).toBeInTheDocument()
  })

  it('精确管理员仍看得到内部入口', async () => {
    renderHome(viewerFacts('admin', null, true))
    await openTools()
    expect(screen.getByText('Story 自动发布')).toBeInTheDocument()
    expect(screen.getByText('客户记忆库')).toBeInTheDocument()
    expect(screen.getByText('经营测算 · 内部')).toBeInTheDocument()
    expect(screen.getByText('等你点头的广告')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '日志' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^社媒/ }).getAttribute('href')).toContain('tab=overview')
    expect(screen.getByRole('link', { name: /^出片/ }).getAttribute('href')).toBe('/dashboard/factory?client=c1')
  })
})
