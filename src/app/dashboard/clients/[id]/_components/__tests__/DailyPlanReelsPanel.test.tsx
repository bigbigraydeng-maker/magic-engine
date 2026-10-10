/**
 * DailyPlanReelsPanel — read-only Reels (video) panel for the Daily Plan page.
 *
 * Reels are produced and reviewed by the video factory; this panel is only a
 * viewing entry point. These tests lock down: only this client's orders with a
 * real video_path are shown, grouped by status label; archived/superseded/
 * failed/dead_letter and other clients' orders are hidden; the published badge
 * surfaces; a failed fetch fails honestly (never an empty list); and the link
 * to the factory review page is present.
 */
import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { DailyPlanReelsPanel } from '../DailyPlanReelsPanel'

const CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const OTHER_CLIENT_ID = 'd0000000-0000-0000-0000-000000000000'

interface OrderFixture {
  id: string
  client_id: string
  status: string
  angle: string
  output?: { video_path?: string } | null
  published: Record<string, unknown> | null
  created_at: string
}

function order(overrides: Partial<OrderFixture> = {}): OrderFixture {
  return {
    id: 'aaaaaaaa-0000-0000-0000-000000000000',
    client_id: CLIENT_ID,
    status: 'in_review',
    angle: 'Angle text',
    output: { video_path: 'client/video.mp4' },
    published: null,
    created_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

function mockFetchOnce(payload: unknown) {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => payload }) as unknown as typeof fetch
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('DailyPlanReelsPanel — shows this client\'s videos grouped by status', () => {
  it('renders only this client\'s orders with a video_path, grouped under their status labels, one <video> each', async () => {
    mockFetchOnce({
      orders: [
        order({ id: 'aaaaaaaa-0000-0000-0000-000000000001', status: 'in_review', output: { video_path: 'client/a.mp4' } }),
        order({ id: 'bbbbbbbb-0000-0000-0000-000000000002', status: 'published', output: { video_path: 'client/b.mp4' } }),
      ],
    })

    const { container } = render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)

    await screen.findByText('视频 Reels（共 2 条）')
    expect(screen.getAllByText('待审核').length).toBeGreaterThan(0)
    expect(screen.getAllByText('已发布').length).toBeGreaterThan(0)

    const videos = container.querySelectorAll('video')
    expect(videos).toHaveLength(2)
    const srcs = Array.from(videos).map((v) => v.getAttribute('src') ?? '')
    expect(srcs.some((s) => s.endsWith('client/a.mp4'))).toBe(true)
    expect(srcs.some((s) => s.endsWith('client/b.mp4'))).toBe(true)
  })
})

describe('DailyPlanReelsPanel — hides non-viewable orders', () => {
  it('hides archived/superseded/failed orders, other clients\' orders, and orders without a video_path', async () => {
    mockFetchOnce({
      orders: [
        order({ id: 'aaaaaaaa-0000-0000-0000-000000000001', status: 'in_review', output: { video_path: 'client/keep.mp4' } }),
        order({ id: 'aaaaaaaa-0000-0000-0000-000000000002', status: 'archived', output: { video_path: 'client/archived.mp4' } }),
        order({ id: 'aaaaaaaa-0000-0000-0000-000000000003', status: 'superseded', output: { video_path: 'client/superseded.mp4' } }),
        order({ id: 'aaaaaaaa-0000-0000-0000-000000000004', status: 'failed', output: { video_path: 'client/failed.mp4' } }),
        order({ id: 'aaaaaaaa-0000-0000-0000-000000000005', status: 'dead_letter', output: { video_path: 'client/dead.mp4' } }),
        order({ id: 'aaaaaaaa-0000-0000-0000-000000000006', status: 'in_review', output: null }),
        order({ id: 'aaaaaaaa-0000-0000-0000-000000000007', status: 'in_review', output: { video_path: '' } }),
        order({ id: 'aaaaaaaa-0000-0000-0000-000000000008', client_id: OTHER_CLIENT_ID, status: 'in_review', output: { video_path: 'other/keep.mp4' } }),
      ],
    })

    const { container } = render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)

    await screen.findByText('视频 Reels（共 1 条）')
    const videos = container.querySelectorAll('video')
    expect(videos).toHaveLength(1)
    expect(videos[0].getAttribute('src') ?? '').toContain('client/keep.mp4')
  })
})

describe('DailyPlanReelsPanel — published badge', () => {
  it('shows 发布时存为草稿 for an order whose published view has video_state DRAFT', async () => {
    mockFetchOnce({
      orders: [
        order({
          id: 'aaaaaaaa-0000-0000-0000-000000000001',
          status: 'published',
          output: { video_path: 'client/draft.mp4' },
          published: { video_state: 'DRAFT', provisional: false, permalink: null },
        }),
      ],
    })

    render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)

    await screen.findByText('视频 Reels（共 1 条）')
    expect(screen.getByText('发布时存为草稿')).toBeInTheDocument()
  })
})

describe('DailyPlanReelsPanel — failed fetch fails honestly', () => {
  it('shows the 读不到视频工单（403） message and no empty-state text', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) }) as unknown as typeof fetch

    render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)

    await screen.findByText('读不到视频工单（403），请刷新或确认管理员登录')
    expect(screen.queryByText('这个客户还没有可看的 Reel 视频。')).not.toBeInTheDocument()
  })
})

describe('DailyPlanReelsPanel — empty state', () => {
  it('shows the empty message when there are zero matching orders', async () => {
    mockFetchOnce({ orders: [] })

    render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)

    await screen.findByText('这个客户还没有可看的 Reel 视频。')
  })
})

describe('DailyPlanReelsPanel — factory review link', () => {
  it('links to the factory review page for this client', async () => {
    mockFetchOnce({ orders: [] })

    const { container } = render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)

    await screen.findByText('这个客户还没有可看的 Reel 视频。')
    const link = container.querySelector(`a[href="/dashboard/factory?client=${CLIENT_ID}"]`)
    expect(link).not.toBeNull()
  })
})
