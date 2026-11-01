/**
 * DailyPlanReelsPanel — read-only short-video (Reels) panel for the Daily Plan page.
 *
 * Reels are produced and reviewed by the video factory; this panel is only a viewing entry point. It reads the same
 * social-overview endpoint as the week overview (already filtered by client) and never calls the factory work-orders API.
 * These tests lock down: revisions of one piece folded into one row, the one small state tag per Reel (including the
 * "uploaded but not checked" case in plain words), the headline "待你处理", the permalink link, the honest failure states
 * (401 / 403 / reels_error), the empty state, and the factory links.
 */
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { DailyPlanReelsPanel } from '../DailyPlanReelsPanel'
import { restoreCoverStubs, stubCoverMedia, stubScreenWatcher } from './cover-stubs'

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
  video_url?: string | null
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

  it('does not treat a weekly post or story cap as the Reel cap', async () => {
    mockFetch({
      success: true,
      reels: [reel()],
      reels_error: null,
      quota: {
        post_per_day: null, story_per_day: null, reel_per_week: null,
        post_per_week: 4, story_per_week: 18,
        post_period: 'week', story_period: 'week', reel_period: null,
      },
    })
    const { container } = render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)
    await screen.findByText(/每周名额未配置/)
    expect(container.textContent).not.toContain('每周名额 4 条')
    expect(container.textContent).not.toContain('每周名额 18 条')
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

describe('DailyPlanReelsPanel — review fixes', () => {
  it('drafts and unchecked uploads are separate numbers, so the draft number is never overstated', async () => {
    mockFetch({
      success: true,
      reels: [
        reel({ id: 'd', status: 'published', published_at: '2026-09-02T00:00:00Z', video_state: 'DRAFT', angle: 'Draft One: a' }),
        reel({ id: 'u', status: 'published', published_at: '2026-09-02T00:00:00Z', video_state: null, angle: 'Unchecked One: a' }),
      ],
      reels_error: null,
    })
    render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)
    await screen.findByText('Draft One')
    const stats = screen.getAllByRole('listitem').filter((li) => li.className.includes('rounded-xl border px-3'))
    expect(stats.map((li) => li.textContent)).toEqual(['待你审核0', '已通过，等发出0', 'Facebook 草稿1', '已公开0', '已上传（未核对）1'])
  })

  it('says it only looked at the newest 30 versions when the list is as long as the cap', async () => {
    const many = Array.from({ length: 30 }, (_, i) => reel({ id: `p${i}`, status: 'published', published_at: '2026-09-02T00:00:00Z', video_state: 'PUBLISHED', angle: `Piece ${i}: a` }))
    mockFetch({ success: true, reels: many, reels_error: null })
    render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)
    expect(await screen.findByText('短视频：最近 30 个版本里没有要你处理的事')).toBeInTheDocument()
    expect(screen.getByText(/只读了最近 30 个版本，更早的请到视频工厂看/)).toBeInTheDocument()
  })

  it('an older version still waiting for review shows on the row and in the headline', async () => {
    mockFetch({
      success: true,
      reels: [
        reel({ id: 'v2', status: 'approved', created_at: '2026-09-02T02:00:00Z', angle: 'Harbour Tour postcard v2: a' }),
        reel({ id: 'v1', status: 'in_review', created_at: '2026-09-02T01:00:00Z', angle: 'Harbour Tour postcard v1: a' }),
      ],
      reels_error: null,
    })
    render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)
    expect(await screen.findByText('另有 1 个旧版待审核')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /待你处理\s*1\s*件/ })).toBeInTheDocument()
  })
})

describe('DailyPlanReelsPanel — cover', () => {
  const NEW_VIDEO = 'https://x.supabase.co/storage/v1/object/public/content-factory/renders/c1/new/final.mp4'
  const OLD_VIDEO = 'https://x.supabase.co/storage/v1/object/public/content-factory/renders/c1/old/final.mp4'

  // Unmount first: leaving the page stops the loading videos, which needs the stand-ins still in place.
  afterEach(() => {
    vi.useRealTimers()
    cleanup()
    restoreCoverStubs()
  })

  function oneReelWithVideo() {
    mockFetch({ success: true, reels: [reel({ id: 'a', angle: 'Harbour Tour: a', video_url: NEW_VIDEO })], reels_error: null })
  }
  const tiles = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>('[data-cover]'))
  const states = (container: HTMLElement) => tiles(container).map((tile) => tile.getAttribute('data-cover'))

  it('asks for the video of a Reel that has one: off-screen, muted, from its start, asking to be told about the first frame before the source is set', async () => {
    const media = stubCoverMedia()
    oneReelWithVideo()
    const { container } = render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)
    await screen.findByText('Harbour Tour')
    expect(media.videos).toHaveLength(1)
    const [video] = media.videos
    expect(video.getAttribute('src')).toBe(NEW_VIDEO)
    expect(video.getAttribute('preload')).toBe('metadata')
    expect(video.muted).toBe(true)
    expect(video.playsInline).toBe(true)
    expect(media.frameRequests).toHaveLength(1)
    expect(media.frameRequests[0].srcWhenAsked).toBeNull()
    expect(container.querySelector('video')).toBeNull() // the page itself holds no video, only the still
    expect(states(container)).toEqual(['waiting'])
    const canvas = container.querySelector('canvas')
    expect(canvas?.classList.contains('hidden')).toBe(true) // nothing to see until it holds the picture
    expect([canvas?.width, canvas?.height]).toEqual([135, 240])
  })

  it('copies the first frame onto each row\'s own cover only once the browser has shown it, drawn before the download is stopped', async () => {
    const media = stubCoverMedia()
    mockFetch({
      success: true,
      reels: [
        reel({ id: 'a', created_at: '2026-09-02T02:00:00Z', angle: 'Harbour Tour: a', video_url: NEW_VIDEO }),
        reel({ id: 'b', created_at: '2026-09-02T01:00:00Z', angle: 'Coast Walk: a', video_url: OLD_VIDEO }),
      ],
      reels_error: null,
    })
    const { container } = render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)
    await screen.findByText('Harbour Tour')
    expect(media.videos.map((video) => video.getAttribute('src'))).toEqual([NEW_VIDEO, OLD_VIDEO])
    expect(media.drawCalls).toHaveLength(0) // a canvas drawn before a frame is shown stays empty
    expect(states(container)).toEqual(['waiting', 'waiting'])

    await media.showFrame()

    const canvases = Array.from(container.querySelectorAll('canvas'))
    expect(canvases).toHaveLength(2)
    expect(media.drawCalls).toHaveLength(2)
    media.drawCalls.forEach((call, row) => {
      expect(call.canvas).toBe(canvases[row])
      expect(call.video).toBe(media.videos[row])
      expect(call.args).toEqual([0, 0, 135, 240])
      expect(call.srcWhenDrawn).toBe(row === 0 ? NEW_VIDEO : OLD_VIDEO) // still loading while it is drawn
    })
    expect(media.videos.every((video) => !video.hasAttribute('src'))).toBe(true)
    expect(media.stopDownload).toHaveBeenCalled()
    expect(states(container)).toEqual(['kept', 'kept'])
    expect(canvases.every((canvas) => !canvas.classList.contains('hidden'))).toBe(true)

    await media.tell(media.videos[0], 'error') // a late error does not take the cover away
    expect(states(container)).toEqual(['kept', 'kept'])
  })

  it.each(['no-canvas-support', 'cannot-draw'] as const)(
    'when no still can be made (%s) the row keeps its plain play tile and the download is stopped',
    async (mode) => {
      const media = stubCoverMedia(mode)
      oneReelWithVideo()
      const { container } = render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)
      await screen.findByText('Harbour Tour')
      await media.showFrame()
      expect(states(container)).toEqual(['failed'])
      expect(container.querySelector('canvas')).toBeNull()
      expect(media.videos[0].hasAttribute('src')).toBe(false)
      expect(media.stopDownload).toHaveBeenCalled()
      expect(tiles(container)[0].className).toContain('h-[78px]') // same height as a cover: no jump when one fails
    },
  )

  it('a browser that cannot say when a frame is shown never starts the download', async () => {
    const media = stubCoverMedia('no-frame-callback')
    oneReelWithVideo()
    const { container } = render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)
    await screen.findByText('Harbour Tour')
    expect(states(container)).toEqual(['failed'])
    expect(container.querySelector('canvas')).toBeNull()
    expect(media.videos.every((video) => !video.hasAttribute('src'))).toBe(true)
  })

  it('a video that cannot be loaded keeps the plain play tile', async () => {
    const media = stubCoverMedia()
    oneReelWithVideo()
    const { container } = render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)
    await screen.findByText('Harbour Tour')
    await media.tell(media.videos[0], 'error')
    expect(states(container)).toEqual(['failed'])
    expect(container.querySelector('canvas')).toBeNull()
    expect(media.stopDownload).toHaveBeenCalled()
  })

  it('gives up after ten seconds when the browser never shows a frame, and stops the download', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    const media = stubCoverMedia()
    oneReelWithVideo()
    const { container } = render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)
    await screen.findByText('Harbour Tour')

    act(() => {
      vi.advanceTimersByTime(9_000)
    })
    expect(states(container)).toEqual(['waiting'])
    expect(media.videos[0].getAttribute('src')).toBe(NEW_VIDEO)

    act(() => {
      vi.advanceTimersByTime(2_000)
    })
    expect(states(container)).toEqual(['failed'])
    expect(media.videos[0].hasAttribute('src')).toBe(false)
    expect(media.stopDownload).toHaveBeenCalled()
  })

  it('a cover that was made does not wait for the give-up timer, and leaving the page stops a download that is still running', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    const media = stubCoverMedia()
    oneReelWithVideo()
    const first = render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)
    await screen.findByText('Harbour Tour')
    await media.showFrame()
    expect(states(first.container)).toEqual(['kept'])
    first.unmount()

    const second = render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)
    await screen.findByText('Harbour Tour')
    const loading = media.videos[1]
    expect(loading.getAttribute('src')).toBe(NEW_VIDEO)
    second.unmount()
    expect(loading.hasAttribute('src')).toBe(false)

    const stopped = media.stopDownload.mock.calls.length
    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(media.stopDownload.mock.calls.length).toBe(stopped) // no timer fires after the page is gone
  })

  it('watches each row with a margin of 300px and asks for no video until the row is about to be on screen', async () => {
    const watchers = stubScreenWatcher()
    const media = stubCoverMedia()
    oneReelWithVideo()
    const { container } = render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)
    await screen.findByText('Harbour Tour')
    expect(media.videos).toHaveLength(0)
    expect(states(container)).toEqual(['waiting'])
    expect(container.querySelector('canvas')).toBeNull()
    expect(watchers).toHaveLength(1)
    expect(watchers[0].options).toEqual({ rootMargin: '300px' })
    expect(watchers[0].targets).toHaveLength(1)
    expect(watchers[0].targets[0]).toBe(tiles(container)[0])

    act(() => watchers[0].callback([{ isIntersecting: false }]))
    expect(media.videos).toHaveLength(0)
    expect(watchers[0].disconnected).toBe(false)

    act(() => watchers[0].callback([{ isIntersecting: true }]))
    expect(media.videos.map((video) => video.getAttribute('src'))).toEqual([NEW_VIDEO])
    expect(watchers[0].disconnected).toBe(true)
  })

  describe('when many covers are wanted at once', () => {
    const urls = Array.from({ length: 8 }, (_, i) => `https://x.supabase.co/storage/v1/object/public/content-factory/renders/c1/r${i}/final.mp4`)
    function eightReels() {
      mockFetch({
        success: true,
        reels: urls.map((video_url, i) => reel({ id: `r${i}`, created_at: `2026-09-02T0${8 - i}:00:00Z`, angle: `Piece ${i}: a`, video_url })),
        reels_error: null,
      })
    }

    it('starts at most six at a time, and the next in page order starts when one finishes', async () => {
      const media = stubCoverMedia()
      eightReels()
      const { container } = render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)
      await screen.findByText('Piece 0')
      expect(media.videos.map((video) => video.getAttribute('src'))).toEqual(urls.slice(0, 6))
      expect(states(container)).toEqual(Array(8).fill('waiting'))

      await media.showFrame() // the first six finish; the two that were waiting start now
      expect(media.videos.map((video) => video.getAttribute('src')).slice(6)).toEqual(urls.slice(6))
      expect(states(container)).toEqual([...Array(6).fill('kept'), 'waiting', 'waiting'])

      await media.showFrame()
      expect(states(container)).toEqual(Array(8).fill('kept'))
    })

    it('a cover that fails gives its place to the next one', async () => {
      const media = stubCoverMedia()
      eightReels()
      render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)
      await screen.findByText('Piece 0')
      expect(media.videos).toHaveLength(6)
      await media.tell(media.videos[0], 'error')
      expect(media.videos).toHaveLength(7)
      expect(media.videos[6].getAttribute('src')).toBe(urls[6])
    })

    it('rows that leave the page never start, and every place is given back', async () => {
      const media = stubCoverMedia()
      eightReels()
      const first = render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)
      await screen.findByText('Piece 0')
      expect(media.videos).toHaveLength(6)

      first.unmount()
      expect(media.videos).toHaveLength(6) // the two waiting rows did not start when the places were freed

      const second = render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)
      await screen.findByText('Piece 0')
      expect(media.videos).toHaveLength(12) // six places were free again, none was lost
      second.unmount()
    })
  })

  it('a Reel without a video address keeps the small plain play tile and asks for no video', async () => {
    const media = stubCoverMedia()
    mockFetch({
      success: true,
      reels: [reel({ id: 'a', angle: 'Harbour Tour: a', video_url: null }), reel({ id: 'b', angle: 'Coast Walk: a' })],
      reels_error: null,
    })
    const { container } = render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)
    await screen.findByText('Harbour Tour')
    expect(media.videos).toHaveLength(0)
    expect(container.querySelector('canvas')).toBeNull()
    expect(states(container)).toEqual(['none', 'none'])
    expect(tiles(container).every((tile) => tile.className.includes('h-11'))).toBe(true)
  })

  it('a work asks for the cover of its newest version only, never an older version\'s video', async () => {
    const media = stubCoverMedia()
    mockFetch({
      success: true,
      reels: [
        reel({ id: 'a2', created_at: '2026-09-02T02:00:00Z', angle: 'Harbour Tour v2: a', video_url: NEW_VIDEO }),
        reel({ id: 'a1', created_at: '2026-09-02T01:00:00Z', angle: 'Harbour Tour v1: a', video_url: OLD_VIDEO }),
        reel({ id: 'b2', created_at: '2026-09-02T04:00:00Z', angle: 'Coast Walk v2: a', video_url: null }),
        reel({ id: 'b1', created_at: '2026-09-02T03:00:00Z', angle: 'Coast Walk v1: a', video_url: OLD_VIDEO }),
      ],
      reels_error: null,
    })
    render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)
    await screen.findByText('Harbour Tour')
    expect(media.videos.map((video) => video.getAttribute('src'))).toEqual([NEW_VIDEO])
  })

  it('the cover is decorative for screen readers: the row\'s title already says what it is', async () => {
    stubCoverMedia()
    oneReelWithVideo()
    const { container } = render(<DailyPlanReelsPanel clientId={CLIENT_ID} />)
    await screen.findByText('Harbour Tour')
    expect(tiles(container)[0].getAttribute('aria-hidden')).toBe('true')
  })
})
