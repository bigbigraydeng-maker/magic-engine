import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { SiteDiffResponse } from '@/lib/tour-catalog/catalog-contract'
import {
  CatalogSiteDiffCard,
  SITE_DIFF_INTRO,
  SITE_DIFF_FAILED_TEXT,
  clip,
} from '../CatalogSiteDiffCard'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

function makeDiff(overrides: Partial<SiteDiffResponse> = {}): SiteDiffResponse {
  return {
    websiteTours: 0,
    catalogTours: 0,
    onlyOnWebsite: [],
    onlyInCatalog: [],
    differences: [],
    notes: [],
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('clip', () => {
  it('renders null as （无）', () => {
    expect(clip(null)).toBe('（无）')
  })

  it('clips a long string to 120 chars plus an ellipsis', () => {
    const long = 'a'.repeat(130)
    const result = clip(long)
    expect(result).toBe(`${'a'.repeat(120)}…`)
    expect(result.length).toBe(121)
  })

  it('names an empty value instead of leaving a gap', () => {
    expect(clip('')).toBe('（空）')
    expect(clip('   ')).toBe('（空）')
  })

  it('leaves a short string unchanged', () => {
    expect(clip('short')).toBe('short')
  })
})

describe('CatalogSiteDiffCard', () => {
  it('shows the intro and button before running, with no result', () => {
    render(<CatalogSiteDiffCard clientId="c1" />)
    expect(screen.getByText(SITE_DIFF_INTRO)).toBeInTheDocument()
    expect(screen.getByText('开始比对')).toBeInTheDocument()
    expect(screen.queryByTestId('site-diff-result')).not.toBeInTheDocument()
  })

  it('reports an identical catalog in green', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        makeDiff({ websiteTours: 33, catalogTours: 33 }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<CatalogSiteDiffCard clientId="c1" />)
    fireEvent.click(screen.getByText('开始比对'))

    const summary = await screen.findByTestId('site-diff-summary')
    expect(summary).toHaveTextContent('官网 33 个团，目录 33 个团，完全一致')
    expect(summary).toHaveStyle({ color: '#456F35' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/clients/c1/tour-catalog/site-diff')
  })

  it('lists differences, only-on-website and only-in-catalog', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        makeDiff({
          websiteTours: 3,
          catalogTours: 4,
          onlyOnWebsite: ['Old Tour'],
          onlyInCatalog: ['New Tour', 'Newer Tour'],
          differences: [
            { tourName: 'Coral Loop', fieldLabel: '主图', website: null, catalog: '/images/a.jpg' },
            { tourName: 'Coral Loop', fieldLabel: '简介', website: 'W', catalog: 'C' },
            { tourName: 'Reef Run', fieldLabel: '主图', website: 'X', catalog: 'Y' },
          ],
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<CatalogSiteDiffCard clientId="c1" />)
    fireEvent.click(screen.getByText('开始比对'))

    const summary = await screen.findByTestId('site-diff-summary')
    expect(summary).toHaveTextContent('官网 3 个团，目录 4 个团，共 6 处不同')

    expect(screen.getAllByTestId('diff-group')).toHaveLength(2)
    expect(screen.getByText('主图：官网 （无） ｜ 目录 /images/a.jpg')).toBeInTheDocument()

    const onlyWebsite = screen.getByTestId('only-on-website')
    expect(within(onlyWebsite).getByText('Old Tour')).toBeInTheDocument()
    expect(within(onlyWebsite).getByText('只在官网有的团（1 个）：')).toBeInTheDocument()

    const onlyCatalog = screen.getByTestId('only-in-catalog')
    expect(within(onlyCatalog).getByText('New Tour')).toBeInTheDocument()
    expect(within(onlyCatalog).getByText('只在目录有的团（2 个）：')).toBeInTheDocument()
  })

  it('clips long values in the rendered line', async () => {
    const long = 'b'.repeat(130)
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        makeDiff({
          websiteTours: 1,
          catalogTours: 1,
          differences: [
            { tourName: 'Coral Loop', fieldLabel: '简介', website: long, catalog: 'C' },
          ],
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<CatalogSiteDiffCard clientId="c1" />)
    fireEvent.click(screen.getByText('开始比对'))

    await screen.findByTestId('site-diff-result')
    expect(
      screen.getByText(`简介：官网 ${'b'.repeat(120)}… ｜ 目录 C`),
    ).toBeInTheDocument()
  })

  it('shows notes when the website data was partly unreadable', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        makeDiff({
          websiteTours: 1,
          catalogTours: 1,
          notes: ['row 3 unreadable', 'row 9 unreadable'],
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<CatalogSiteDiffCard clientId="c1" />)
    fireEvent.click(screen.getByText('开始比对'))

    const notes = await screen.findByTestId('site-diff-notes')
    expect(notes).toHaveTextContent('有 2 条官网数据没能读懂，比对结果不完整')
    expect(within(notes).getByText('row 3 unreadable')).toBeInTheDocument()
    expect(within(notes).getByText('row 9 unreadable')).toBeInTheDocument()
  })

  it('paginates differences 50 at a time', async () => {
    const differences = Array.from({ length: 120 }, (_, i) => ({
      tourName: 'Coral Loop',
      fieldLabel: `字段${i}`,
      website: `w${i}`,
      catalog: `c${i}`,
    }))
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(makeDiff({ websiteTours: 1, catalogTours: 1, differences })),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<CatalogSiteDiffCard clientId="c1" />)
    fireEvent.click(screen.getByText('开始比对'))

    const group = await screen.findByTestId('diff-group')
    expect(within(group).getAllByRole('listitem')).toHaveLength(50)
    expect(screen.getByText('已显示 50 / 120 条')).toBeInTheDocument()

    fireEvent.click(screen.getByText('显示更多'))
    expect(within(screen.getByTestId('diff-group')).getAllByRole('listitem')).toHaveLength(100)
  })

  it('maps the no_domain error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'no_domain' }, 400))
    vi.stubGlobal('fetch', fetchMock)

    render(<CatalogSiteDiffCard clientId="c1" />)
    fireEvent.click(screen.getByText('开始比对'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('这个客户还没登记官网域名')
    })
  })

  it('maps the feed_unavailable error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'feed_unavailable' }, 502))
    vi.stubGlobal('fetch', fetchMock)

    render(<CatalogSiteDiffCard clientId="c1" />)
    fireEvent.click(screen.getByText('开始比对'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('暂时读不到官网的数据，请稍后再试')
    })
  })

  it('falls back to the generic failure text for an unknown error code', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'diff_failed' }, 500))
    vi.stubGlobal('fetch', fetchMock)

    render(<CatalogSiteDiffCard clientId="c1" />)
    fireEvent.click(screen.getByText('开始比对'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(SITE_DIFF_FAILED_TEXT)
    })
  })

  it('falls back to the generic failure text when fetch rejects', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('x'))
    vi.stubGlobal('fetch', fetchMock)

    render(<CatalogSiteDiffCard clientId="c1" />)
    fireEvent.click(screen.getByText('开始比对'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(SITE_DIFF_FAILED_TEXT)
    })
  })
})
