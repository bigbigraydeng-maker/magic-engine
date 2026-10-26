// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { OverviewReel } from '@/lib/social/week-overview/build'
import { groupReelWorks } from '@/lib/social/week-overview/reel-works'

import { ReelWorkGroups } from '../SocialDailyParts'
import { restoreCoverStubs, stubCoverMedia } from './cover-stubs'

const CLIENT = 'c1'
const VIDEO = (n: number | string) => `https://x.supabase.co/storage/v1/object/public/content-factory/renders/c1/r${n}/final.mp4`

function reel(overrides: Partial<OverviewReel> & { id: string; angle: string }): OverviewReel {
  return { status: 'in_review', created_at: '2026-10-12T00:00:00Z', published_at: null, permalink: null, video_state: null, music_file: null, template: null, ...overrides }
}

/** One work of each kind that matters, handed over in a scrambled order. */
function mixedWorks() {
  return groupReelWorks([
    reel({ id: 'e', angle: 'Echo: a', status: 'published', published_at: '2026-10-12T05:00:00Z', video_state: 'PUBLISHED', permalink: 'https://www.facebook.com/reel/1' }),
    reel({ id: 'd', angle: 'Delta: a', status: 'published', published_at: '2026-10-12T04:00:00Z', video_state: 'DRAFT' }),
    reel({ id: 'c', angle: 'Charlie: a', status: 'approved' }),
    reel({ id: 'b', angle: 'Bravo: a', status: 'review_rejected' }),
    reel({ id: 'a', angle: 'Alpha: a', status: 'in_review' }),
  ])
}

const tileTitles = (container: HTMLElement) => Array.from(container.querySelectorAll('ul.grid > li h3')).map((h) => h.textContent)

/** This Node's own `localStorage` global gets in the way of jsdom's, so the page gets a small stand-in (as in TourListPane.test.tsx). */
function installStorage(methods?: Partial<Pick<Storage, 'getItem' | 'setItem'>>) {
  const store = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      ...methods,
    },
  })
}

beforeEach(() => installStorage())
afterEach(() => {
  cleanup()
  restoreCoverStubs()
  vi.restoreAllMocks()
})

describe('ReelWorkGroups — the 列表 / 平铺 switch', () => {
  it('opens in the list view: folded groups, the 列表 button pressed', () => {
    const { container } = render(<ReelWorkGroups works={mixedWorks()} clientId={CLIENT} />)
    expect(screen.getByRole('group', { name: '显示方式' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '列表' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '平铺' }).getAttribute('aria-pressed')).toBe('false')
    expect(container.querySelectorAll('details').length).toBeGreaterThan(0)
    expect(container.querySelector('ul.grid')).toBeNull()
  })

  it('平铺 lays every work out flat: no folds, 待你审核 first, the state on every tile, the factory link on every tile', () => {
    const { container } = render(<ReelWorkGroups works={mixedWorks()} clientId={CLIENT} />)
    fireEvent.click(screen.getByRole('button', { name: '平铺' }))

    expect(screen.getByRole('button', { name: '平铺' }).getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelectorAll('details')).toHaveLength(0)
    expect(tileTitles(container)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'])

    const tiles = Array.from(container.querySelectorAll('ul.grid > li'))
    expect(tiles).toHaveLength(5)
    const states = tiles.map((tile) => ['待审核', '已打回', '已通过', '草稿', '已发出'].find((label) => within(tile as HTMLElement).queryByText(label) !== null))
    expect(states).toEqual(['待审核', '已打回', '已通过', '草稿', '已发出'])
    for (const tile of tiles) {
      const link = within(tile as HTMLElement).getByRole('link', { name: /^去视频工厂看/ })
      expect(link.getAttribute('href')).toBe(`/dashboard/factory?client=${CLIENT}`)
    }
    expect(within(tiles[0] as HTMLElement).getByRole('link', { name: '去视频工厂看 / 点通过' })).toBeInTheDocument()
    // the state tag sits on the picture, so it has its own white backing: it must stay readable on a dark cover
    expect(within(tiles[0] as HTMLElement).getByText('待审核').parentElement?.className).toContain('bg-white')
    expect(within(tiles[4] as HTMLElement).getByRole('link', { name: '打开 Reel 链接' }).getAttribute('href')).toBe('https://www.facebook.com/reel/1')
  })

  it('a tile says what the row says: how many versions, an older version still in review, and the details on request', () => {
    const works = groupReelWorks([
      reel({ id: 'v2', angle: 'Harbour Tour v2 (Spring batch1 #4): hook on the bridge', status: 'approved', created_at: '2026-10-12T02:00:00Z' }),
      reel({ id: 'v1', angle: 'Harbour Tour v1 (Spring batch1 #4): hook on the bridge', status: 'in_review', created_at: '2026-10-12T01:00:00Z' }),
    ])
    const { container } = render(<ReelWorkGroups works={works} clientId={CLIENT} />)
    fireEvent.click(screen.getByRole('button', { name: '平铺' }))

    const tile = container.querySelector('ul.grid > li') as HTMLElement
    expect(within(tile).getByRole('heading', { level: 3 }).textContent).toBe('第 1 批 · Harbour Tour #4') // no group headings above it, so h3 (an h4 would skip a level)
    expect(within(tile).getByText('共 2 版')).toBeInTheDocument()
    expect(within(tile).getByText('另有 1 个旧版待审核')).toBeInTheDocument()
    expect(within(tile).queryByText('第 2 版（最新）')).toBeNull()

    fireEvent.click(within(tile).getByRole('button', { name: '详情' }))
    expect(within(tile).getByText('第 2 版（最新）')).toBeInTheDocument()
    expect(within(tile).getByText(/工单备注：Spring batch1/)).toBeInTheDocument()
    fireEvent.click(within(tile).getByRole('button', { name: '收起详情' }))
    expect(within(tile).queryByText('第 2 版（最新）')).toBeNull()
  })

  it('remembers the choice in this browser, so the next visit and the other tab open the same way', () => {
    const first = render(<ReelWorkGroups works={mixedWorks()} clientId={CLIENT} />)
    fireEvent.click(screen.getByRole('button', { name: '平铺' }))
    expect(window.localStorage.getItem('me.social-daily.reel-view')).toBe('tile')
    first.unmount()

    const second = render(<ReelWorkGroups works={mixedWorks()} clientId={CLIENT} />)
    expect(screen.getByRole('button', { name: '平铺' }).getAttribute('aria-pressed')).toBe('true')
    expect(second.container.querySelectorAll('ul.grid > li')).toHaveLength(5)

    fireEvent.click(screen.getByRole('button', { name: '列表' }))
    expect(window.localStorage.getItem('me.social-daily.reel-view')).toBe('list')
    expect(second.container.querySelectorAll('details').length).toBeGreaterThan(0)
  })

  it('storage that is blocked does not break the page: it works, it just forgets', () => {
    const blocked = () => {
      throw new Error('blocked')
    }
    installStorage({ getItem: blocked, setItem: blocked })
    const { container } = render(<ReelWorkGroups works={mixedWorks()} clientId={CLIENT} />)
    expect(screen.getByRole('button', { name: '列表' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '平铺' }))
    expect(container.querySelectorAll('ul.grid > li')).toHaveLength(5)
  })

  it('an unknown stored value falls back to the list view', () => {
    window.localStorage.setItem('me.social-daily.reel-view', 'something-else')
    render(<ReelWorkGroups works={mixedWorks()} clientId={CLIENT} />)
    expect(screen.getByRole('button', { name: '列表' }).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('ReelWorkGroups — covers in the 平铺 view', () => {
  function manyWithVideos(count: number) {
    return groupReelWorks(Array.from({ length: count }, (_, i) => reel({ id: `r${i}`, angle: `Piece ${i}: a`, created_at: `2026-10-12T0${9 - i}:00:00Z`, video_url: VIDEO(i) })))
  }

  it('each tile has a big 9:16 cover whose still is twice the size of the row\'s, and the same limit of six at a time', async () => {
    const media = stubCoverMedia()
    window.localStorage.setItem('me.social-daily.reel-view', 'tile')
    const { container } = render(<ReelWorkGroups works={manyWithVideos(8)} clientId={CLIENT} />)

    const covers = Array.from(container.querySelectorAll<HTMLElement>('[data-cover]'))
    expect(covers).toHaveLength(8)
    expect(covers.every((cover) => cover.className.includes('aspect-[9/16]') && cover.className.includes('w-full'))).toBe(true)
    expect(media.videos).toHaveLength(6)

    await media.showFrame()
    expect(media.drawCalls.slice(0, 6).every((call) => call.args.join(',') === '0,0,270,480')).toBe(true)
    expect(media.videos).toHaveLength(8)
    await media.showFrame()
    expect(covers.map((cover) => cover.getAttribute('data-cover'))).toEqual(Array(8).fill('kept'))
    expect(Array.from(container.querySelectorAll('canvas')).map((canvas) => [canvas.width, canvas.height])).toEqual(Array(8).fill([270, 480]))
  })

  it('switching back to the list asks for the small stills again, and a tile that was left stops its download', async () => {
    const media = stubCoverMedia()
    window.localStorage.setItem('me.social-daily.reel-view', 'tile')
    const { container } = render(<ReelWorkGroups works={manyWithVideos(2)} clientId={CLIENT} />)
    expect(media.videos).toHaveLength(2)
    const [first] = media.videos

    fireEvent.click(screen.getByRole('button', { name: '列表' }))
    expect(first.hasAttribute('src')).toBe(false) // the tile was removed while it was loading: its download is stopped
    expect(media.videos).toHaveLength(4)

    await media.showFrame()
    expect(media.drawCalls.every((call) => call.args.join(',') === '0,0,135,240')).toBe(true)
    expect(Array.from(container.querySelectorAll('canvas')).map((canvas) => [canvas.width, canvas.height])).toEqual([[135, 240], [135, 240]])
  })
})
