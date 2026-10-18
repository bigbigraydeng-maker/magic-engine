/**
 * DailyPlanReelsPanel — read-only short-video (Reels) panel for the Daily Plan page.
 *
 * Reels are produced and reviewed by the video factory; this panel is only a
 * viewing entry point. It reads the same social-overview endpoint as the week
 * overview (already filtered by client) and never calls the factory work-orders
 * API. These tests lock down: the compact list, the status chip (including the
 * "库里记为已上传 · 平台状态未核" case), the permalink link, the honest failure
 * states (403 / reels_error), the empty state, and the factory links.
 */
import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { DailyPlanReelsPanel } from '../DailyPlanReelsPanel'

const CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'

interface ReelFixture {
  id: string
  status: string
  angle: string
  created_at: string
  published_at: string | null
  permalink: string | null
  music_file: string | null
  template: string | null
}

function reel(overrides: Partial<ReelFixture> = {}): ReelFixture {
  return {
    id: 'aaaaaaaa-0000-0000-0000-000000000000',
    status: 'in_review',
    angle: 'Angle text',
    created_at: '2026-09-01T00:00:00.000Z',
    published_at: null,
    permalink: null,
    music_file: null,
    template: null,
    ...overrides,
  }
}

function mockFetchOnce(payload: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => payload,
  }) as unknown as typeof fetch
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('DailyPlanReelsPanel — compact list', () => {
  it('renders both reels with their angles, short ids, and status labels', async () => {
    mockFetchOnce({
      success: true,
      reels: [
        reel({ id: 'aaaaaaaa-0000-0000-0000-000000000001', status: 'in_review', angle: '第一条主题' }),
        reel({ id: 'bbbbbbbb-0000-0000-0000-000000000002', status: 'approved', angle: '第二条主题' }),
      ],
      reels_error: null,
    })

    render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)

    await screen.findByText('短视频（共 2 条）')
    expect(screen.getByText('第一条主题')).toBeInTheDocument()
    expect(screen.getByText('第二条主题')).toBeInTheDocument()
    expect(screen.getByText('工单 aaaaaaaa')).toBeInTheDocument()
    expect(screen.getAllByText('待审核').length).toBeGreaterThan(0)
  })
})

describe('DailyPlanReelsPanel — recorded-uploaded chip', () => {
  it('shows 库里记为已上传 · 平台状态未核 for a published reel with published_at set', async () => {
    mockFetchOnce({
      success: true,
      reels: [
        reel({
          id: 'aaaaaaaa-0000-0000-0000-000000000001',
          status: 'published',
          angle: '已上传主题',
          published_at: '2026-09-02T00:00:00.000Z',
        }),
      ],
      reels_error: null,
    })

    render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)

    await screen.findByText('短视频（共 1 条）')
    expect(screen.getByText('库里记为已上传 · 平台状态未核')).toBeInTheDocument()
  })
})

describe('DailyPlanReelsPanel — permalink', () => {
  it('shows 打开 Reel 链接 with the href when a permalink exists, and none when it does not', async () => {
    mockFetchOnce({
      success: true,
      reels: [
        reel({
          id: 'aaaaaaaa-0000-0000-0000-000000000001',
          status: 'published',
          angle: '有链接',
          permalink: 'https://example.com/reel/1',
        }),
        reel({
          id: 'bbbbbbbb-0000-0000-0000-000000000002',
          status: 'in_review',
          angle: '没链接',
          permalink: null,
        }),
      ],
      reels_error: null,
    })

    render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)

    await screen.findByText('短视频（共 2 条）')
    const links = screen.getAllByText('打开 Reel 链接')
    expect(links).toHaveLength(1)
    expect(links[0].closest('a')?.getAttribute('href')).toBe('https://example.com/reel/1')
  })
})

describe('DailyPlanReelsPanel — does not call the factory work-orders API', () => {
  it('fetches only the social-overview endpoint and renders no <video>', async () => {
    mockFetchOnce({ success: true, reels: [reel()], reels_error: null })

    const { container } = render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)

    await screen.findByText('短视频（共 1 条）')
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(global.fetch).toHaveBeenCalledWith(`/api/clients/${CLIENT_ID}/social-overview`)
    const calls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
    for (const call of calls) {
      expect(String(call[0])).not.toContain('work-orders')
    }
    expect(container.querySelectorAll('video')).toHaveLength(0)
  })
})

describe('DailyPlanReelsPanel — forbidden', () => {
  it('shows 只有管理员能看 on 403 and no empty-state text', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({}),
    }) as unknown as typeof fetch

    render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)

    await screen.findByText('只有管理员能看')
    expect(screen.queryByText('这个客户还没有可看的短视频。')).not.toBeInTheDocument()
  })
})

describe('DailyPlanReelsPanel — reels_error fails honestly', () => {
  it('shows 短视频现在读不到，请刷新页面。 and not the empty text', async () => {
    mockFetchOnce({ success: true, reels: [], reels_error: 'x' })

    render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)

    await screen.findByText('短视频现在读不到，请刷新页面。')
    expect(screen.queryByText('这个客户还没有可看的短视频。')).not.toBeInTheDocument()
  })
})

describe('DailyPlanReelsPanel — empty state', () => {
  it('shows the empty message when there are zero reels', async () => {
    mockFetchOnce({ success: true, reels: [], reels_error: null })

    render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)

    await screen.findByText('这个客户还没有可看的短视频。')
  })
})

describe('DailyPlanReelsPanel — factory links and header', () => {
  it('links every row to the factory page and shows the description', async () => {
    mockFetchOnce({
      success: true,
      reels: [
        reel({ id: 'aaaaaaaa-0000-0000-0000-000000000001', status: 'in_review', angle: '第一条主题' }),
        reel({ id: 'bbbbbbbb-0000-0000-0000-000000000002', status: 'approved', angle: '第二条主题' }),
      ],
      reels_error: null,
    })

    const { container } = render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)

    await screen.findByText('短视频（共 2 条）')
    expect(
      screen.getByText('这里只看排期和状态；审片、通过、打回、看片都在视频工厂。'),
    ).toBeInTheDocument()
    const links = container.querySelectorAll(`a[href="/dashboard/factory?client=${CLIENT_ID}"]`)
    expect(links.length).toBeGreaterThanOrEqual(2)
  })
})

describe('DailyPlanReelsPanel — not signed in', () => {
  it('says to sign in on 401, not "admins only"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })))
    render(<DailyPlanReelsPanel clientId="client-1" />)
    expect(await screen.findByText('请先登录管理员账号后刷新')).toBeTruthy()
    expect(screen.queryByText('只有管理员能看')).toBeNull()
  })
})
