// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { WeekOverview } from '@/lib/social/week-overview/build'

import { WeekOverviewPanel } from '../WeekOverviewPanel'

const CLIENT = '11111111-1111-4111-8111-111111111111'

function overview(overrides: Partial<WeekOverview> = {}): WeekOverview {
  return {
    live: false,
    story: {
      pack_id: 'p1',
      title: '第3周',
      state: 'AUTHORIZED',
      authorized_at: '2026-10-13T08:00:00Z',
      expires_at: '2026-10-20T08:00:00Z',
      items: [
        {
          item_id: 'i1',
          channel: 'facebook_story',
          slot_at: '2026-10-13T19:30:00Z',
          media_kind: 'image',
          media_url: 'https://x.supabase.co/storage/v1/object/public/b/a.png',
          text_line: '第一条',
          status: 'PENDING',
        },
        {
          item_id: 'i2',
          channel: 'facebook_story',
          slot_at: '2026-10-14T00:00:00Z',
          media_kind: 'image',
          media_url: 'https://x.supabase.co/storage/v1/object/public/b/b.png',
          text_line: '第二条',
          status: 'PENDING',
        },
      ],
    },
    story_error: null,
    reels: [{ id: 'r1', status: 'in_review', angle: '上海价格', created_at: '2026-10-12T00:00:00Z', published_at: null, permalink: null }],
    reels_error: null,
    post: { connected: false },
    ...overrides,
  }
}

function mockFetch(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })),
  )
}

beforeEach(() => vi.unstubAllGlobals())
afterEach(() => cleanup())

describe('WeekOverviewPanel', () => {
  it('says rehearsal mode and the pack state in words, groups Stories by New Zealand day, marks Posts as not wired', async () => {
    mockFetch({ success: true, ...overview() })
    render(<WeekOverviewPanel clientId={CLIENT} />)
    expect(await screen.findByText(/演练模式：不会真发/)).toBeTruthy()
    expect(screen.getByText(/「第3周」已授权/)).toBeTruthy()
    expect(screen.getByText('第一条')).toBeTruthy()
    expect(screen.getAllByText(/10月14日/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/图文 Post：尚未接入/).length).toBe(1) // both Stories fall on one New Zealand day
    expect(screen.getByText('上海价格')).toBeTruthy()
    expect(screen.getByText('待审核')).toBeTruthy()
  })

  it('live mode is announced', async () => {
    mockFetch({ success: true, ...overview({ live: true }) })
    render(<WeekOverviewPanel clientId={CLIENT} />)
    expect(await screen.findByText(/真发已开/)).toBeTruthy()
  })

  it('a failed Story or Reel read is said out loud, never shown as empty', async () => {
    mockFetch({ success: true, ...overview({ story: null, story_error: 'read failed', reels: [], reels_error: 'read failed' }) })
    render(<WeekOverviewPanel clientId={CLIENT} />)
    expect(await screen.findByText(/Story 读取失败/)).toBeTruthy()
    expect(screen.getByText(/Reel 读取失败/)).toBeTruthy()
    expect(screen.queryByText(/这一周还没有 Story/)).toBeNull()
  })

  it('non-admin and failures are explicit', async () => {
    mockFetch({ success: false, error: 'GLOBAL_ADMIN_REQUIRED' }, 403)
    render(<WeekOverviewPanel clientId={CLIENT} />)
    expect(await screen.findByText(/只有管理员能看/)).toBeTruthy()
    cleanup()
    mockFetch({ success: false }, 500)
    render(<WeekOverviewPanel clientId={CLIENT} />)
    expect(await screen.findByText(/读取失败，现在不知道/)).toBeTruthy()
  })

  it('does not use banned internal words', async () => {
    mockFetch({ success: true, ...overview() })
    const { container } = render(<WeekOverviewPanel clientId={CLIENT} />)
    await screen.findByText(/演练模式/)
    expect(container.textContent).not.toMatch(/信封|素材池|指纹|哈希|hash|fingerprint/i)
  })
})
