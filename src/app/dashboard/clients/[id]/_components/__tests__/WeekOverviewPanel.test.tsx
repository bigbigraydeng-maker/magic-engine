// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { OverviewReel, WeekOverview } from '@/lib/social/week-overview/build'

import { WeekOverviewPanel } from '../WeekOverviewPanel'

const CLIENT = '11111111-1111-4111-8111-111111111111'

function reel(overrides: Partial<OverviewReel> & { id: string; angle: string }): OverviewReel {
  return { status: 'in_review', created_at: '2026-10-12T00:00:00Z', published_at: null, permalink: null, video_state: null, music_file: null, template: null, ...overrides }
}

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
    reels: [reel({ id: 'r1', angle: '上海价格' })],
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

beforeEach(() => {
  vi.unstubAllGlobals()
  // The sample Stories are on 13-14 October: freeze "now" just before them so no test depends on today's date.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-13T00:00:00Z'))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('WeekOverviewPanel', () => {
  it('opens with what needs a click, says rehearsal mode and the pack state in words, and groups Stories by New Zealand day', async () => {
    mockFetch({ success: true, ...overview() })
    render(<WeekOverviewPanel clientId={CLIENT} />)
    expect(await screen.findByText(/演练模式：不会真发/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: /待你处理\s*1\s*件/ })).toBeTruthy()
    expect(screen.getByText(/「第3周」已授权/)).toBeTruthy()
    expect(screen.getByText('第一条')).toBeTruthy()
    expect(screen.getAllByText(/10月14日/).length).toBeGreaterThan(0)
    expect(screen.getByText('上海价格')).toBeTruthy()
    expect(screen.getAllByText('待审核').length).toBeGreaterThan(0)
  })

  it('keeps the entry links: video factory for review, Story page for authorise / stop', async () => {
    mockFetch({ success: true, ...overview() })
    render(<WeekOverviewPanel clientId={CLIENT} />)
    await screen.findByText(/演练模式/)
    const factory = screen.getAllByRole('link', { name: /去视频工厂看 \/ 点通过/ })
    expect(factory.length).toBeGreaterThanOrEqual(2) // the headline strip and the Reel row
    for (const link of factory) expect(link.getAttribute('href')).toBe(`/dashboard/factory?client=${CLIENT}`)
    expect(screen.getByRole('link', { name: '去 Story 页授权 / 停' }).getAttribute('href')).toBe(`/dashboard/clients/${CLIENT}/story`)
  })

  it('shows the rehearsal explanation and warns about a newer, not yet authorised pack', async () => {
    const base = overview()
    mockFetch({ success: true, ...overview({ story: { ...base.story!, newer_draft_title: '新周包' } }) })
    render(<WeekOverviewPanel clientId={CLIENT} />)
    expect(await screen.findByText(/一旦开启真发/)).toBeTruthy()
    expect(screen.getAllByText(/新的周包「新周包」还没授权/).length).toBeGreaterThanOrEqual(2) // headline strip + Story card
    expect(screen.getByRole('heading', { name: /待你处理\s*2\s*件/ })).toBeTruthy()
  })

  it('a Story week nobody has authorised is a thing to do; the old "已经排好" sentence is gone', async () => {
    const base = overview()
    mockFetch({ success: true, ...overview({ story: { ...base.story!, state: 'DRAFT', authorized_at: null, expires_at: null } }) })
    const { container } = render(<WeekOverviewPanel clientId={CLIENT} />)
    expect(await screen.findByText(/Story：「第3周」这一周还没授权/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /去 Story 页授权$/ })).toBeTruthy()
    expect(container.textContent).toContain('还没授权，不会发')
    expect(container.textContent).not.toContain('这一周的内容已经排好')
  })

  it('with nothing scheduled and nothing waiting it says so calmly, without the misleading "ready" sentence', async () => {
    mockFetch({ success: true, ...overview({ story: null, reels: [], reel_variety: { same_track_max: 0, same_track_file: null, price_screen_count: 0, total: 0 } }) })
    const { container } = render(<WeekOverviewPanel clientId={CLIENT} />)
    expect(await screen.findByText(/现在没有要你处理的事/)).toBeTruthy()
    expect(container.textContent).toContain('本周还没排 Story，也没有进行中的周包。')
    expect(container.textContent).not.toContain('这一周的内容已经排好')
    expect(container.textContent).not.toContain('每天排了什么')
  })

  it('both reads failing gets one clear message, and the headline never says "nothing to do"', async () => {
    mockFetch({ success: true, ...overview({ story: null, story_error: 'read failed', reels: [], reels_error: 'read failed' }) })
    const { container } = render(<WeekOverviewPanel clientId={CLIENT} />)
    expect(await screen.findByText(/Story 和 Reel 都读取失败/)).toBeTruthy()
    expect(container.textContent).toContain('现在读不到视频、Story，不确定有没有要你处理的事')
    expect(container.textContent).not.toContain('现在没有要你处理的事')
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

  it('live mode is announced in one compact bar, names the Story line, keeps the stop entry and the no-recall warning', async () => {
    mockFetch({ success: true, ...overview({ live: true }) })
    const { container } = render(<WeekOverviewPanel clientId={CLIENT} />)
    expect(await screen.findByText(/Story 真发已开：授权后，到点会真的发到 Facebook 主页/)).toBeTruthy()
    expect(container.textContent).toContain('已经发出去的不会撤回')
    expect(screen.getByRole('link', { name: '去 Story 页授权 / 停' })).toBeTruthy()
    expect(screen.getByRole('status').className).toContain('status-rej')
  })

  it('a failed Story or Reel read is said out loud, never shown as empty', async () => {
    mockFetch({ success: true, ...overview({ story: null, story_error: 'read failed', reels: [], reels_error: 'read failed' }) })
    const { container } = render(<WeekOverviewPanel clientId={CLIENT} />)
    expect(await screen.findByText(/Story 读取失败/)).toBeTruthy()
    expect(screen.getByText(/Reel 读取失败/)).toBeTruthy()
    expect(container.textContent).not.toContain('本周还没排 Story')
    expect(container.textContent).not.toContain('现在没有可看的 Reel')
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

  it('uses no internal words anywhere on the page', async () => {
    const base = overview()
    mockFetch({
      success: true,
      ...overview({
        live: true,
        reel_variety: { same_track_max: 7, same_track_file: 'a.mp3', price_screen_count: 9, total: 30 },
        story: { ...base.story!, items: [{ ...base.story!.items[0], status: 'SENT' }, base.story!.items[1]] },
        reels: [
          reel({ id: 'u1', status: 'published', published_at: '2026-10-13T00:00:00Z', angle: '已上传的' }),
          reel({ id: 'u2', status: 'published', published_at: '2026-10-13T00:00:00Z', video_state: 'DRAFT', angle: '草稿片' }),
        ],
      }),
    })
    const { container } = render(<WeekOverviewPanel clientId={CLIENT} />)
    await screen.findByText(/真发已开/)
    expect(container.textContent).not.toMatch(/信封|素材池|指纹|哈希|hash|fingerprint|库里|平台状态未核|尚未接入|放行规则|BGM|价格屏|工单 |PM 在工厂/i)
  })

  it('shows used/limit per day from the client config, the role, the quotas and the coming-soon line', async () => {
    mockFetch({ success: true, ...overview() })
    render(<WeekOverviewPanel clientId={CLIENT} />)
    expect(await screen.findByText(/Story（用了 2\/3）/)).toBeTruthy()
    expect(screen.getByText(/每天名额 3 条/)).toBeTruthy()
    expect(screen.getByText(/每周名额 3 条/)).toBeTruthy()
    expect(screen.getByText(/灵感/)).toBeTruthy()
    expect(screen.getByText(/你在视频工厂点「通过」后，下一个整点发出/)).toBeTruthy()
    expect(screen.getAllByText(/即将上线：/).length).toBe(1)
    expect(screen.queryByText('没能进日历')).toBeNull()
    expect(screen.queryByText('这一周的画面复核')).toBeNull()
  })

  it('a missing quota says "名额未配置" and never pretends to be 0', async () => {
    mockFetch({ success: true, ...overview({ quota: null }) })
    const { container } = render(<WeekOverviewPanel clientId={CLIENT} />)
    await screen.findByText(/演练模式/)
    expect(container.textContent).toContain('名额未配置')
    expect(container.textContent).not.toMatch(/用了 \d+\/0/)
  })

  it('reports Reels and Stories separately, Story all waiting', async () => {
    mockFetch({ success: true, ...overview() })
    const { container } = render(<WeekOverviewPanel clientId={CLIENT} />)
    await screen.findByText(/演练模式/)
    expect(container.textContent).toContain('待发 2')
    expect(container.textContent).toContain('本周 2 条')
    expect(container.textContent).toContain('1 条作品')
    expect(container.textContent).not.toContain('过点没发出')
  })

  it('a Story whose time has passed but is still waiting says it did not go out, in the headline strip and on the row', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-14T02:00:00Z'))
    mockFetch({ success: true, ...overview() })
    render(<WeekOverviewPanel clientId={CLIENT} />)
    await screen.findByText(/过点没发出 2/)
    expect(screen.getAllByText(/已过点，没发出（系统里仍是待发）/).length).toBe(2)
    expect(screen.getByText(/Story：2 条已过发布时间，没发出去/)).toBeTruthy()
  })

  it('a Reel whose platform state is known says draft / public; an unchecked upload says it is unchecked, in plain words', async () => {
    mockFetch({
      success: true,
      ...overview({
        reels: [
          reel({ id: 'd1', status: 'published', angle: '草稿片', published_at: '2026-10-13T00:00:00Z', video_state: 'DRAFT' }),
          reel({ id: 'p1', status: 'published', angle: '公开片', published_at: '2026-10-13T00:00:00Z', permalink: 'https://example.com/reel', video_state: 'PUBLISHED' }),
          reel({ id: 'u1', status: 'published', angle: '没核对片', published_at: '2026-10-13T00:00:00Z', video_state: null }),
        ],
      }),
    })
    const { container } = render(<WeekOverviewPanel clientId={CLIENT} />)
    await screen.findByText(/演练模式/)
    expect(screen.getAllByText('草稿').length).toBeGreaterThan(0)
    expect(screen.getAllByText('已发出').length).toBeGreaterThan(0)
    expect(screen.getAllByText('已上传（未核对）').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: '打开 Reel 链接' }).getAttribute('href')).toBe('https://example.com/reel')
    expect(container.textContent).not.toContain('库里记为已上传')
    expect(container.textContent).not.toContain('平台状态未核')
  })

  it('a recorded-as-sent Story never says plainly "sent"', async () => {
    const base = overview()
    mockFetch({ success: true, ...overview({ story: { ...base.story!, items: [{ ...base.story!.items[0], status: 'SENT' }, base.story!.items[1]] } }) })
    const { container } = render(<WeekOverviewPanel clientId={CLIENT} />)
    await screen.findByText(/演练模式/)
    expect(container.textContent).toContain('已发出（未核对 Facebook）')
    expect(container.textContent).not.toMatch(/已发出(?!（未核对)/)
  })

  it('folds revisions of one piece into one row ("共 N 版") and keeps the ticket text behind the details button', async () => {
    mockFetch({
      success: true,
      ...overview({
        reels: [
          reel({ id: 'a2', created_at: '2026-10-12T02:00:00Z', template: 'postcard', angle: 'Harbour Tour postcard (Spring batch1 #4): hook on the bridge (r2: scene replaced)' }),
          reel({ id: 'a1', created_at: '2026-10-12T01:00:00Z', template: 'postcard', angle: 'Harbour Tour postcard (Spring batch1 #4): hook on the bridge' }),
          reel({ id: 'b1', created_at: '2026-10-12T00:00:00Z', template: 'list', angle: 'Coast Walk v3: price-led list reel' }),
        ],
      }),
    })
    const { container } = render(<WeekOverviewPanel clientId={CLIENT} />)
    await screen.findByText('Harbour Tour #4')
    expect(screen.getByText('共 2 版')).toBeTruthy()
    expect(container.querySelectorAll('h4').length).toBe(2)
    expect(container.textContent).toContain('2 条作品')
    expect(container.textContent).toContain('共 3 个版本')
    expect(container.textContent).not.toContain('hook on the bridge') // the raw ticket text stays out of the way until asked for
    fireEvent.click(screen.getAllByRole('button', { name: '详情' })[0])
    expect(container.textContent).toContain('hook on the bridge (r2: scene replaced)')
    expect(container.textContent).toContain('第 2 版（最新）')
    expect(container.textContent).toContain('第 1 版')
    expect(container.textContent).toContain('工单备注：Spring batch1')
    fireEvent.click(screen.getByRole('button', { name: '收起详情' }))
    expect(container.textContent).not.toContain('hook on the bridge')
  })

  it('groups Reels by state, what needs a person first and open, quiet states folded', async () => {
    mockFetch({
      success: true,
      ...overview({
        reels: [
          reel({ id: '1', angle: 'Review One: a' }),
          reel({ id: '2', status: 'review_rejected', angle: 'Rejected One: a' }),
          reel({ id: '3', status: 'published', published_at: '2026-10-13T00:00:00Z', video_state: 'DRAFT', angle: 'Draft One: a' }),
        ],
      }),
    })
    const { container } = render(<WeekOverviewPanel clientId={CLIENT} />)
    await screen.findByText('Review One')
    const groups = Array.from(container.querySelectorAll('details'))
      .filter((d) => d.querySelector('h3'))
      .map((d) => [d.querySelector('h3')?.textContent, d.open])
    expect(groups).toEqual([
      ['待你审核', true],
      ['出问题 / 被打回', true],
      ['Facebook 草稿', false],
    ])
  })

  it('the variety hint speaks plainly and in warning colour when a track repeats, and stays quiet when things look varied', async () => {
    mockFetch({ success: true, ...overview({ reel_variety: { same_track_max: 3, same_track_file: 'a.mp3', price_screen_count: 2, total: 3 } }) })
    render(<WeekOverviewPanel clientId={CLIENT} />)
    const line = await screen.findByText('最近 3 条里，同一首背景音乐用了 3 次。下一批建议换一首背景音乐。')
    expect(line.className).toContain('8A4A0A')
    cleanup()
    mockFetch({ success: true, ...overview({ reel_variety: { same_track_max: 1, same_track_file: 'a.mp3', price_screen_count: 0, total: 3 } }) })
    const { container } = render(<WeekOverviewPanel clientId={CLIENT} />)
    await screen.findByText(/演练模式/)
    expect(container.textContent).not.toContain('下一批建议')
  })

  it('no deadline words and no customer names', async () => {
    mockFetch({ success: true, ...overview() })
    const { container } = render(<WeekOverviewPanel clientId={CLIENT} />)
    await screen.findByText(/演练模式/)
    expect(container.textContent).not.toMatch(/截止|限时|倒计时|CTS|旅游/)
  })
})
