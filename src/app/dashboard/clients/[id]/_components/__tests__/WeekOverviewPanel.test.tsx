// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { WeekOverview } from '@/lib/social/week-overview/build'

import { WeekOverviewPanel } from '../WeekOverviewPanel'

const CLIENT = '11111111-1111-4111-8111-111111111111'

function overview(overrides: Partial<WeekOverview> = {}): WeekOverview {
  return {
    live: false,
    quota: { post_per_day: 2, story_per_day: 3, reel_per_week: 3 },
    story: {
      newer_draft_title: null,
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
          role: 'inspiration',
        },
        {
          item_id: 'i2',
          channel: 'facebook_story',
          slot_at: '2026-10-14T00:00:00Z',
          media_kind: 'image',
          media_url: 'https://x.supabase.co/storage/v1/object/public/b/b.png',
          text_line: '第二条',
          status: 'PENDING',
          role: null,
        },
      ],
    },
    story_error: null,
    reels: [{ id: 'r1', status: 'in_review', angle: '上海价格', created_at: '2026-10-12T00:00:00Z', published_at: null, permalink: null, music_file: null, template: null }],
    reels_error: null,
    reel_variety: { same_track_max: 0, same_track_file: null, price_screen_count: 0, total: 1 },
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
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

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

  it('shows the rehearsal explanation and warns about a newer, not yet authorised pack', async () => {
    const base = overview()
    mockFetch({ success: true, ...overview({ story: { ...base.story!, newer_draft_title: '新周包' } }) })
    render(<WeekOverviewPanel clientId={CLIENT} />)
    expect(await screen.findByText(/一旦开启真发/)).toBeTruthy()
    expect(screen.getByText(/新的周包「新周包」还没授权/)).toBeTruthy()
  })

  it('both reads failing gets one clear message', async () => {
    mockFetch({ success: true, ...overview({ story: null, story_error: 'read failed', reels: [], reels_error: 'read failed' }) })
    render(<WeekOverviewPanel clientId={CLIENT} />)
    expect(await screen.findByText(/Story 和 Reel 都读取失败/)).toBeTruthy()
  })

  it('a video story shows a video thumbnail and says so (no big image download)', async () => {
    const base = overview()
    mockFetch({ success: true, ...overview({ story: { ...base.story!, items: [{ ...base.story!.items[0], media_kind: 'video', media_url: 'https://x.supabase.co/storage/v1/object/public/b/v.mp4' }] } }) })
    const { container } = render(<WeekOverviewPanel clientId={CLIENT} />)
    await screen.findByText('第一条')
    expect(container.querySelector('video')).not.toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('视频')
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

  it('shows used/limit per day from the client config, the role, the gap section, and the title sentence', async () => {
    mockFetch({ success: true, ...overview() })
    render(<WeekOverviewPanel clientId={CLIENT} />)
    expect(await screen.findByText(/Story（用了 2\/3）/)).toBeTruthy()
    expect(screen.getByText(/每天名额 2 条/)).toBeTruthy()
    expect(screen.getByText(/每周名额 3 条/)).toBeTruthy()
    expect(screen.getByText(/灵感/)).toBeTruthy()
    expect(screen.getByText('没能进日历')).toBeTruthy()
    expect(screen.getByText('这一周的画面复核')).toBeTruthy()
    expect(screen.getByText(/以 PM 在工厂点通过的时间为准/)).toBeTruthy()
    expect(screen.getByText(/尚未接入：还没有「报名」/)).toBeTruthy()
    expect(screen.getByText(/这一周的内容已经排好，你看一遍、点一次授权就行/)).toBeTruthy()
  })

  it('a missing quota says "名额未配置" and never pretends to be 0', async () => {
    mockFetch({ success: true, ...overview({ quota: null }) })
    const { container } = render(<WeekOverviewPanel clientId={CLIENT} />)
    await screen.findByText(/演练模式/)
    expect(container.textContent).toContain('名额未配置')
    expect(container.textContent).not.toMatch(/用了 \d+\/0/)
  })

  it('headline reports each line separately, Story all waiting', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-13T00:00:00Z'))
    mockFetch({ success: true, ...overview() })
    render(<WeekOverviewPanel clientId={CLIENT} />)
    await screen.findByText('图文：未接入')
    expect(screen.getByText('Story：本周 2 条 · 库里记为已发 0 · 已过点没发出 0 · 待发 2 · 被拦 0')).toBeTruthy()
    expect(screen.getByText('Reel：在审 1 · 库里记为已上传 0（平台状态未核）')).toBeTruthy()
  })

  it('a Story whose time has passed but is still waiting says it did not go out', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-14T02:00:00Z'))
    mockFetch({ success: true, ...overview() })
    render(<WeekOverviewPanel clientId={CLIENT} />)
    await screen.findByText(/已过点没发出 2/)
    expect(screen.getAllByText(/已过点，没发出（库里仍是待发）/).length).toBe(2)
  })

  it('a recorded-as-sent Story and an uploaded Reel never use the bare word', async () => {
    const base = overview()
    mockFetch({
      success: true,
      ...overview({
        story: { ...base.story!, items: [{ ...base.story!.items[0], status: 'SENT' }, base.story!.items[1]] },
        reels: [
          {
            id: 'r9',
            status: 'published',
            angle: '已上传的',
            created_at: '2026-10-12T00:00:00Z',
            published_at: '2026-10-13T00:00:00Z',
            permalink: 'https://example.com/reel',
            music_file: null,
            template: null,
          },
        ],
      }),
    })
    const { container } = render(<WeekOverviewPanel clientId={CLIENT} />)
    await screen.findByText(/演练模式/)
    expect(container.textContent).toContain('库里记为已发')
    expect(container.textContent).toContain('库里记为已上传')
    expect(container.textContent).toContain('平台状态未核')
    expect(container.textContent).not.toMatch(/(?<!库里记为)已发/)
  })

  it('variety hint is orange with a rule pointer when a track repeats', async () => {
    mockFetch({ success: true, ...overview({ reel_variety: { same_track_max: 3, same_track_file: 'a.mp3', price_screen_count: 2, total: 3 } }) })
    render(<WeekOverviewPanel clientId={CLIENT} />)
    const line = await screen.findByText(/同一首 BGM 最多出现 3 次；价格屏 2\/3（规则见放行规则文档）/)
    expect(line.className).toContain('C2570C')
  })

  it('variety hint stays plain when things look varied, and says BGM unread when no data', async () => {
    mockFetch({ success: true, ...overview({ reel_variety: { same_track_max: 1, same_track_file: 'a.mp3', price_screen_count: 0, total: 3 } }) })
    const { container } = render(<WeekOverviewPanel clientId={CLIENT} />)
    const line = await screen.findByText('最近 3 条 Reel：同一首 BGM 最多出现 1 次；价格屏 0/3')
    expect(line.className).not.toContain('C2570C')
    expect(container.textContent).not.toContain('规则见放行规则文档')
    cleanup()
    mockFetch({ success: true, ...overview({ reel_variety: { same_track_max: 0, same_track_file: null, price_screen_count: 0, total: 3 } }) })
    render(<WeekOverviewPanel clientId={CLIENT} />)
    await screen.findByText(/BGM 未读到/)
  })

  it('no deadline words and no customer names', async () => {
    mockFetch({ success: true, ...overview() })
    const { container } = render(<WeekOverviewPanel clientId={CLIENT} />)
    await screen.findByText(/演练模式/)
    expect(container.textContent).not.toMatch(/截止|限时|倒计时|CTS|旅游/)
  })
})
