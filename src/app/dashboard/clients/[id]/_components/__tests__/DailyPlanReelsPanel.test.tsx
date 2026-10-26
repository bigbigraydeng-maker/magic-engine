/**
 * DailyPlanReelsPanel — read-only short-video (Reels) panel for the Daily Plan page.
 *
 * Reels are produced and reviewed by the video factory; this panel is only a viewing entry point. It reads the same
 * social-overview endpoint as the week overview (already filtered by client) and never calls the factory work-orders API.
 * These tests lock down: revisions of one piece folded into one row, the one small state tag per Reel (including the
 * "uploaded but not checked" case in plain words), the headline "待你处理", the permalink link, the honest failure states
 * (401 / 403 / reels_error), the empty state, and the factory links.
 */
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { DailyPlanReelsPanel } from '../DailyPlanReelsPanel'

const CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'

interface ReelFixture {
  id: string
  status: string
  angle: string
  created_at: string
  published_at: string | null
  video_state?: 'DRAFT' | 'PUBLISHED' | null
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

/** Answers every request with `payload`; returns the mock so a test can look at what was asked. */
function mockFetch(payload: unknown, status = 200) {
  const fetchMock = vi.fn(async (_url: string) => ({ ok: status >= 200 && status < 300, status, json: async () => payload }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('DailyPlanReelsPanel — works, not orders', () => {
  it('shows one row per work with a short title and a state tag, and says how many works and versions there are', async () => {
    mockFetch({
      success: true,
      reels: [
        reel({ id: 'a2', created_at: '2026-09-02T02:00:00Z', template: 'postcard', angle: 'Harbour Tour postcard (Spring batch1 #4): hook on the bridge (r2: scene replaced)' }),
        reel({ id: 'a1', created_at: '2026-09-02T01:00:00Z', template: 'postcard', angle: 'Harbour Tour postcard (Spring batch1 #4): hook on the bridge' }),
        reel({ id: 'b1', created_at: '2026-09-02T00:00:00Z', status: 'approved', template: 'list', angle: 'Coast Walk v3: price-led list reel' }),
      ],
      reels_error: null,
    })

    const { container } = render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)

    await screen.findByText('Harbour Tour #4')
    expect(screen.getByText('Coast Walk')).toBeInTheDocument()
    expect(container.querySelectorAll('h4')).toHaveLength(2)
    expect(screen.getByText('共 2 版')).toBeInTheDocument()
    expect(container.textContent).toContain('共 2 条作品（3 个版本，同一条的修订版已折叠在一起）')
    expect(screen.getAllByText('待审核').length).toBeGreaterThan(0)
    expect(screen.getAllByText('已通过').length).toBeGreaterThan(0)
    // the long ticket text stays behind the details button until someone asks for it
    expect(container.textContent).not.toContain('hook on the bridge')
    fireEvent.click(screen.getAllByRole('button', { name: '详情' })[0])
    expect(container.textContent).toContain('hook on the bridge (r2: scene replaced)')
    expect(container.textContent).toContain('工单备注：Spring batch1')
  })

  it('opens with what needs a click and where the pieces are right now', async () => {
    mockFetch({
      success: true,
      reels: [
        reel({ id: '1', angle: 'Review One: a' }),
        reel({ id: '2', angle: 'Review Two: a' }),
        reel({ id: '3', status: 'review_rejected', angle: 'Rejected One: a' }),
        reel({ id: '4', status: 'published', published_at: '2026-09-02T00:00:00Z', video_state: 'DRAFT', angle: 'Draft One: a' }),
        reel({ id: '5', status: 'published', published_at: '2026-09-02T00:00:00Z', video_state: 'PUBLISHED', angle: 'Public One: a' }),
      ],
      reels_error: null,
    })

    render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)

    expect(await screen.findByRole('heading', { name: /待你处理\s*3\s*件/ })).toBeInTheDocument()
    expect(screen.getByText('视频：2 条作品等你审核')).toBeInTheDocument()
    expect(screen.getByText('视频：1 条被打回或出了问题')).toBeInTheDocument()
    const stats = screen.getAllByRole('listitem').filter((li) => li.className.includes('rounded-xl border px-3'))
    expect(stats.map((li) => li.textContent)).toEqual(['待你审核2', '已通过，等发出0', 'Facebook 草稿1', '已公开1', '出问题 / 被打回1'])
  })

  it('nothing waiting says so calmly', async () => {
    mockFetch({ success: true, reels: [reel({ status: 'published', published_at: '2026-09-02T00:00:00Z', video_state: 'PUBLISHED' })], reels_error: null })
    render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)
    expect(await screen.findByText('短视频：现在没有要你处理的事')).toBeInTheDocument()
  })
})

describe('DailyPlanReelsPanel — state tags', () => {
  it('an uploaded Reel nobody has checked on Facebook says so in plain words', async () => {
    mockFetch({
      success: true,
      reels: [reel({ id: 'aaaaaaaa-0000-0000-0000-000000000001', status: 'published', angle: '已上传主题', published_at: '2026-09-02T00:00:00.000Z' })],
      reels_error: null,
    })

    const { container } = render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)

    await screen.findByText('已上传主题')
    expect(screen.getAllByText('已上传（未核对）').length).toBeGreaterThan(0)
    expect(container.textContent).not.toContain('库里记为已上传')
    expect(container.textContent).not.toContain('平台状态未核')
  })

  it('shows 草稿 for a draft Reel and 已发出 for a public one, never the unchecked note', async () => {
    mockFetch({
      success: true,
      reels: [
        reel({ id: 'aaaaaaaa-0000-0000-0000-000000000001', status: 'published', angle: '草稿片', published_at: '2026-09-02T00:00:00.000Z', video_state: 'DRAFT' }),
        reel({ id: 'bbbbbbbb-0000-0000-0000-000000000002', status: 'published', angle: '公开片', published_at: '2026-09-02T00:00:00.000Z', video_state: 'PUBLISHED' }),
      ],
      reels_error: null,
    })

    render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)

    await screen.findByText('草稿片')
    expect(screen.getAllByText('草稿').length).toBeGreaterThan(0)
    expect(screen.getAllByText('已发出').length).toBeGreaterThan(0)
    expect(screen.queryByText('已上传（未核对）')).not.toBeInTheDocument()
  })
})

describe('DailyPlanReelsPanel — permalink', () => {
  it('shows 打开 Reel 链接 with the href when a permalink exists, and none when it does not', async () => {
    mockFetch({
      success: true,
      reels: [
        reel({ id: 'aaaaaaaa-0000-0000-0000-000000000001', status: 'published', angle: '有链接', permalink: 'https://example.com/reel/1' }),
        reel({ id: 'bbbbbbbb-0000-0000-0000-000000000002', status: 'in_review', angle: '没链接', permalink: null }),
      ],
      reels_error: null,
    })

    render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)

    await screen.findByText('有链接')
    const links = screen.getAllByText('打开 Reel 链接')
    expect(links).toHaveLength(1)
    expect(links[0].closest('a')?.getAttribute('href')).toBe('https://example.com/reel/1')
  })
})

describe('DailyPlanReelsPanel — does not call the factory work-orders API', () => {
  it('fetches only the social-overview endpoint and renders no <video>', async () => {
    const fetchMock = mockFetch({ success: true, reels: [reel()], reels_error: null })

    const { container } = render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)

    await screen.findByText(/共 1 条作品/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(`/api/clients/${CLIENT_ID}/social-overview`)
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain('work-orders')
    }
    expect(container.querySelectorAll('video')).toHaveLength(0)
  })
})

describe('DailyPlanReelsPanel — forbidden', () => {
  it('shows 只有管理员能看 on 403 and no empty-state text', async () => {
    mockFetch({}, 403)

    render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)

    await screen.findByText('只有管理员能看')
    expect(screen.queryByText('这个客户还没有可看的短视频。')).not.toBeInTheDocument()
  })
})

describe('DailyPlanReelsPanel — reels_error fails honestly', () => {
  it('shows 短视频现在读不到，请刷新页面。 and not the empty text or a "nothing to do" headline', async () => {
    mockFetch({ success: true, reels: [], reels_error: 'x' })

    const { container } = render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)

    await screen.findByText('短视频现在读不到，请刷新页面。')
    expect(screen.queryByText('这个客户还没有可看的短视频。')).not.toBeInTheDocument()
    expect(container.textContent).not.toContain('现在没有要你处理的事')
  })
})

describe('DailyPlanReelsPanel — empty state', () => {
  it('shows the empty message when there are zero reels', async () => {
    mockFetch({ success: true, reels: [], reels_error: null })

    render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)

    await screen.findByText('这个客户还没有可看的短视频。')
  })
})

describe('DailyPlanReelsPanel — factory links and header', () => {
  it('keeps the factory entries (header link, headline, every row) and the description', async () => {
    mockFetch({
      success: true,
      reels: [
        reel({ id: 'aaaaaaaa-0000-0000-0000-000000000001', status: 'in_review', angle: '第一条主题' }),
        reel({ id: 'bbbbbbbb-0000-0000-0000-000000000002', status: 'approved', angle: '第二条主题' }),
      ],
      reels_error: null,
    })

    const { container } = render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)

    await screen.findByText('第一条主题')
    expect(screen.getByText('这里只看排期和状态；审片、通过、打回、看片都在视频工厂。')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '去视频工厂' }).getAttribute('href')).toBe(`/dashboard/factory?client=${CLIENT_ID}`)
    expect(screen.getAllByRole('link', { name: /去视频工厂看 \/ 点通过/ }).length).toBeGreaterThanOrEqual(2) // the headline and the row waiting for review
    expect(screen.getAllByRole('link', { name: '去视频工厂看' }).length).toBeGreaterThanOrEqual(1) // the approved row
    const links = container.querySelectorAll(`a[href="/dashboard/factory?client=${CLIENT_ID}"]`)
    expect(links.length).toBeGreaterThanOrEqual(4)
  })
})

describe('DailyPlanReelsPanel — quota and variety hint', () => {
  it('says the weekly quota, and says "not configured" instead of 0 when there is none', async () => {
    mockFetch({ success: true, reels: [reel()], reels_error: null, quota: { post_per_day: 2, story_per_day: 3, reel_per_week: 3 } })
    const first = render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)
    expect(await screen.findByText(/每周名额 3 条/)).toBeInTheDocument()
    first.unmount()
    mockFetch({ success: true, reels: [reel()], reels_error: null, quota: null })
    const second = render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)
    await screen.findByText(/每周名额未配置/)
    expect(second.container.textContent).not.toMatch(/名额 0 条/)
  })

  it('speaks plainly about a repeated track, only when the existing rule says something is off', async () => {
    mockFetch({ success: true, reels: [reel()], reels_error: null, reel_variety: { same_track_max: 4, same_track_file: 'a.mp3', price_screen_count: 0, total: 6 } })
    const first = render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)
    expect(await screen.findByText('最近 6 条里，同一首背景音乐用了 4 次。下一批建议换一首背景音乐。')).toBeInTheDocument()
    first.unmount()
    mockFetch({ success: true, reels: [reel()], reels_error: null, reel_variety: { same_track_max: 1, same_track_file: 'a.mp3', price_screen_count: 0, total: 6 } })
    const second = render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)
    await screen.findByText(/共 1 条作品/)
    expect(second.container.textContent).not.toContain('下一批建议')
  })
})

describe('DailyPlanReelsPanel — plain words', () => {
  it('uses no internal words and no order numbers', async () => {
    mockFetch({
      success: true,
      reels: [
        reel({ id: 'aaaaaaaa-0000-0000-0000-000000000001', status: 'published', angle: '已上传主题', published_at: '2026-09-02T00:00:00.000Z' }),
        reel({ id: 'bbbbbbbb-0000-0000-0000-000000000002', angle: '待审主题' }),
      ],
      reels_error: null,
      reel_variety: { same_track_max: 7, same_track_file: 'a.mp3', price_screen_count: 9, total: 30 },
    })
    const { container } = render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)
    await screen.findByText('待审主题')
    expect(container.textContent).not.toMatch(/库里|平台状态未核|尚未接入|放行规则|BGM|价格屏|工单 [0-9a-f]{8}/)
  })
})

describe('DailyPlanReelsPanel — not signed in', () => {
  it('says to sign in on 401, not "admins only"', async () => {
    mockFetch({}, 401)
    render(<DailyPlanReelsPanel clientId="client-1" />)
    expect(await screen.findByText('请先登录管理员账号后刷新')).toBeTruthy()
    expect(screen.queryByText('只有管理员能看')).toBeNull()
  })
})
