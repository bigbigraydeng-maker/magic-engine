import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import MonthlyReportPage from '../page'
import { formatLabel, formatValue } from '@/lib/monthly-report/formatters'
import type { MonthlyReportData } from '@/lib/reports/monthly-aggregator'

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useParams: vi.fn(() => ({ clientId: 'test-client-123' })),
}))

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────
// The page renders MonthlyReportData from /api/reports/[clientId]/monthly
// (P7.4.x rewrite — the old section/metrics shape is gone).

function makeReport(overrides: Partial<MonthlyReportData> = {}): MonthlyReportData {
  return {
    client_id: 'test-client-123',
    client_name: 'Test Client',
    period_label: 'May 2026',
    period_from: '2026-05-01',
    period_to: '2026-05-31',
    overview: {
      this_month_avg_rank: 4,
      last_month_avg_rank: 6,
      rank_change: -2,
      this_month_mentions: 12,
      last_month_mentions: 9,
      mention_change: 3,
      queries_tracked: 25,
      engines_used: ['openai', 'perplexity'],
    },
    trend: [],
    geo: {
      active_version: null,
      directive_id: null,
      deployed_pages: [],
      deployed_pages_count: 0,
      published_blogs_this_month: 0,
    },
    competitive: [],
    links: null,
    search: null,
    local: null,
    market: null,
    usage: null,
    generated_at: '2026-06-01T00:00:00Z',
    ...overrides,
  }
}

function okResponse(payload: unknown) {
  return { ok: true, json: vi.fn().mockResolvedValue(payload) }
}

function stubReportFetch(report: MonthlyReportData = makeReport()) {
  const fetchMock = vi.fn().mockResolvedValue(okResponse({ success: true, report }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const REPORT_URL = '/api/reports/test-client-123/monthly'

describe('Monthly Report Page Components', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('formatLabel', () => {
    it('should convert snake_case to Title Case', () => {
      expect(formatLabel('ai_avg_ranking')).toBe('Ai Avg Ranking')
      expect(formatLabel('serp_top10_keywords')).toBe('Serp Top10 Keywords')
      expect(formatLabel('backlinks_total')).toBe('Backlinks Total')
    })

    it('should handle single word', () => {
      expect(formatLabel('health')).toBe('Health')
    })

    it('should handle multiple underscores', () => {
      expect(formatLabel('very_long_metric_name')).toBe('Very Long Metric Name')
    })
  })

  describe('formatValue', () => {
    it('should return "N/A" for null or undefined', () => {
      expect(formatValue(null)).toBe('N/A')
      expect(formatValue(undefined)).toBe('N/A')
    })

    it('should format integers without decimals', () => {
      expect(formatValue(100)).toBe('100')
      expect(formatValue(0)).toBe('0')
      expect(formatValue(-5)).toBe('-5')
    })

    it('should format decimals with 2 decimal places', () => {
      expect(formatValue(100.5)).toBe('100.50')
      expect(formatValue(75.123)).toBe('75.12')
    })

    it('should format arrays as comma-separated with ellipsis for > 3 items', () => {
      expect(formatValue(['a', 'b', 'c'])).toBe('a, b, c')
      expect(formatValue(['a', 'b', 'c', 'd', 'e'])).toBe('a, b, c...')
      expect(formatValue([1, 2, 3, 4, 5, 6])).toBe('1, 2, 3...')
    })

    it('should truncate objects to 50 chars', () => {
      const obj = { key: 'a'.repeat(100) }
      const result = formatValue(obj)
      expect(result.length).toBeLessThanOrEqual(50)
    })

    it('should convert strings to string', () => {
      expect(formatValue('test')).toBe('test')
    })

    it('should handle boolean values', () => {
      expect(formatValue(true)).toBe('true')
      expect(formatValue(false)).toBe('false')
    })
  })

  describe('MonthlyReportPage - Loading & errors', () => {
    it('should show the skeleton while the report is loading', () => {
      vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
      const { container } = render(<MonthlyReportPage />)

      expect(container.querySelector('.animate-pulse')).not.toBeNull()
      expect(screen.queryByText(/Monthly Report/)).toBeNull()
    })

    it('should fetch the report from /api/reports/[clientId]/monthly', async () => {
      const fetchMock = stubReportFetch()
      render(<MonthlyReportPage />)

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(REPORT_URL)
      })
    })

    it('should show the network error and a Retry button when fetch rejects', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))
      render(<MonthlyReportPage />)

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument()
      })
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    })

    it('should show the API error message when success=false', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        okResponse({ success: false, error: 'Client not found' }),
      ))
      render(<MonthlyReportPage />)

      await waitFor(() => {
        expect(screen.getByText('Client not found')).toBeInTheDocument()
      })
    })

    it('should fall back to a generic message when a non-ok response has no error field', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        json: vi.fn().mockResolvedValue({}),
      }))
      render(<MonthlyReportPage />)

      await waitFor(() => {
        expect(screen.getByText('Failed to load report')).toBeInTheDocument()
      })
    })

    it('should re-fetch the report when Retry is clicked', async () => {
      const fetchMock = vi.fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(okResponse({ success: true, report: makeReport() }))
      vi.stubGlobal('fetch', fetchMock)
      render(<MonthlyReportPage />)

      await waitFor(() => screen.getByRole('button', { name: 'Retry' }))
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

      await waitFor(() => {
        expect(screen.getByText(/May 2026 — Test Client/)).toBeInTheDocument()
      })
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(fetchMock).toHaveBeenNthCalledWith(2, REPORT_URL)
    })
  })

  describe('MonthlyReportPage - Header', () => {
    it('should render the period, client name, breadcrumb and export button', async () => {
      stubReportFetch()
      render(<MonthlyReportPage />)

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('May 2026 — Test Client')
      })
      expect(screen.getByRole('link', { name: 'Clients' })).toHaveAttribute('href', '/dashboard/clients')
      expect(screen.getByText(/Period: 2026-05-01 → 2026-05-31/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '⬇ Export HTML' })).toBeInTheDocument()
    })
  })

  describe('MonthlyReportPage - §1 AI Visibility Overview', () => {
    it('should render the four KPI cards with month-over-month deltas', async () => {
      stubReportFetch()
      render(<MonthlyReportPage />)

      await waitFor(() => {
        expect(screen.getByText('Avg AI Rank (this month)')).toBeInTheDocument()
      })
      expect(screen.getByText('#4')).toBeInTheDocument()
      // rank_change -2 = improved → ↑ arrow
      expect(screen.getByText(/↑ 2 vs last month/)).toBeInTheDocument()

      expect(screen.getByText('AI Mentions (this month)')).toBeInTheDocument()
      expect(screen.getByText('12')).toBeInTheDocument()
      expect(screen.getByText(/↑ 3 vs last month/)).toBeInTheDocument()

      expect(screen.getByText('Queries Tracked')).toBeInTheDocument()
      expect(screen.getByText('25')).toBeInTheDocument()

      // Scope to the card: the "2" would otherwise collide with the §2 badge
      const enginesCard = screen.getByText('AI Engines').parentElement as HTMLElement
      expect(within(enginesCard).getByText('2')).toBeInTheDocument()
      expect(within(enginesCard).getByText('openai, perplexity')).toBeInTheDocument()
    })

    it('should show a worsened rank with a ↓ arrow', async () => {
      stubReportFetch(makeReport({
        overview: {
          ...makeReport().overview,
          this_month_avg_rank: 7,
          last_month_avg_rank: 4,
          rank_change: 3,
          mention_change: -1,
        },
      }))
      render(<MonthlyReportPage />)

      await waitFor(() => {
        expect(screen.getByText('#7')).toBeInTheDocument()
      })
      expect(screen.getByText(/↓ 3 vs last month/)).toBeInTheDocument()
      expect(screen.getByText(/↓ 1 vs last month/)).toBeInTheDocument()
    })

    it('should render placeholders when there is no rank data', async () => {
      stubReportFetch(makeReport({
        overview: {
          ...makeReport().overview,
          this_month_avg_rank: null,
          last_month_avg_rank: null,
          rank_change: null,
          engines_used: [],
        },
      }))
      render(<MonthlyReportPage />)

      await waitFor(() => {
        expect(screen.getByText('No prior data')).toBeInTheDocument()
      })
      expect(screen.getByText('none yet')).toBeInTheDocument()
    })
  })

  describe('MonthlyReportPage - §2 4-Week Ranking Trend', () => {
    it('should show the empty message when fewer than 2 trend points exist', async () => {
      stubReportFetch(makeReport({ trend: [{ week_of: '2026-05-25', avg_rank: 5, mentions_count: 3 }] }))
      render(<MonthlyReportPage />)

      await waitFor(() => {
        expect(screen.getByText(/Not enough data yet/)).toBeInTheDocument()
      })
    })

    it('should render one column per week when trend data exists', async () => {
      stubReportFetch(makeReport({
        trend: [
          { week_of: '2026-05-04', avg_rank: 8,    mentions_count: 1 },
          { week_of: '2026-05-11', avg_rank: 6,    mentions_count: 2 },
          { week_of: '2026-05-18', avg_rank: null, mentions_count: 0 },
          { week_of: '2026-05-25', avg_rank: 5,    mentions_count: 3 },
        ],
      }))
      render(<MonthlyReportPage />)

      await waitFor(() => {
        expect(screen.getByRole('img', { name: '4-week rank trend' })).toBeInTheDocument()
      })
      // Week labels appear both in the sparkline axis and the per-week columns
      expect(screen.getAllByText('05-04').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('05-25').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('#8')).toBeInTheDocument()
      expect(screen.getByText('#5')).toBeInTheDocument()
      expect(screen.getByText('3 mentions')).toBeInTheDocument()
      expect(screen.getByText('0 mentions')).toBeInTheDocument()
      expect(screen.queryByText(/Not enough data yet/)).toBeNull()
    })
  })

  describe('MonthlyReportPage - §3 GEO Deployment', () => {
    it('should link to the GEO Composer when nothing is deployed', async () => {
      stubReportFetch()
      render(<MonthlyReportPage />)

      await waitFor(() => {
        expect(screen.getByText(/No GEO directive deployed yet/)).toBeInTheDocument()
      })
      expect(screen.getByRole('link', { name: /Go to GEO Composer/ }))
        .toHaveAttribute('href', '/dashboard/geo-composer')
    })

    it('should list the active version, counts and deployed URLs', async () => {
      stubReportFetch(makeReport({
        geo: {
          active_version: 3,
          directive_id: 'dir-1',
          deployed_pages: ['https://example.co.nz/', 'https://example.co.nz/tours'],
          deployed_pages_count: 2,
          published_blogs_this_month: 4,
        },
      }))
      render(<MonthlyReportPage />)

      await waitFor(() => {
        expect(screen.getByText('v3')).toBeInTheDocument()
      })
      const pagesStat = screen.getByText('Pages with Snippet').parentElement as HTMLElement
      expect(within(pagesStat).getByText('2')).toBeInTheDocument()
      // "4" would collide with the §4 badge → scope to the stat block
      const blogsStat = screen.getByText('Blogs Published (this month)').parentElement as HTMLElement
      expect(within(blogsStat).getByText('4')).toBeInTheDocument()
      expect(screen.getByText('Deployed URLs')).toBeInTheDocument()
      expect(screen.getByText('https://example.co.nz/tours')).toBeInTheDocument()
      expect(screen.queryByText(/No GEO directive deployed yet/)).toBeNull()
    })
  })

  describe('MonthlyReportPage - §4 Competitive Comparison', () => {
    it('should show the empty message when there are no query runs', async () => {
      stubReportFetch()
      render(<MonthlyReportPage />)

      await waitFor(() => {
        expect(screen.getByText(/No query run data yet/)).toBeInTheDocument()
      })
    })

    it('should render one row per query with rank badge and competitors', async () => {
      stubReportFetch(makeReport({
        competitive: [
          {
            question: 'best NZ tour operator?',
            query_id: 'q-1',
            client_rank: 2,
            competitors: [{ brand: 'Rival Co', rank: 1 }, { brand: 'Other Ltd', rank: 3 }],
            engine: 'openai',
            run_at: '2026-05-30T00:00:00Z',
            measured: true,
          },
          {
            question: 'cheap Auckland day trips',
            query_id: 'q-2',
            client_rank: null,
            competitors: [],
            engine: 'perplexity',
            run_at: '2026-05-30T00:00:00Z',
            measured: true,
          },
        ],
      }))
      render(<MonthlyReportPage />)

      await waitFor(() => {
        expect(screen.getByText(/best NZ tour operator\?/)).toBeInTheDocument()
      })
      expect(screen.getByText('#2')).toBeInTheDocument()
      expect(screen.getByText('#1 Rival Co')).toBeInTheDocument()
      expect(screen.getByText('#3 Other Ltd')).toBeInTheDocument()
      expect(screen.getByText('openai')).toBeInTheDocument()

      // Measured but not mentioned → N/M badge + "No competitors found"
      expect(screen.getByText('N/M')).toBeInTheDocument()
      expect(screen.getByText('No competitors found')).toBeInTheDocument()
      expect(screen.getByText('perplexity')).toBeInTheDocument()
    })
  })

  describe('MonthlyReportPage - §5–§9 Phase 8 panels', () => {
    it('should render every section header and the empty states for null panel data', async () => {
      stubReportFetch()
      render(<MonthlyReportPage />)

      await waitFor(() => {
        expect(screen.getByText('🔗 Link Intelligence')).toBeInTheDocument()
      })
      expect(screen.getByText('🔍 Search Visibility')).toBeInTheDocument()
      expect(screen.getByText('📍 Local Visibility')).toBeInTheDocument()
      expect(screen.getByText('🎯 Market Benchmark')).toBeInTheDocument()
      expect(screen.getByText('💰 Data Source Usage')).toBeInTheDocument()

      expect(screen.getByText(/暂无外链数据/)).toBeInTheDocument()
      expect(screen.getByText(/暂无搜索排名数据/)).toBeInTheDocument()
      expect(screen.getByText(/暂无本地搜索数据/)).toBeInTheDocument()
      expect(screen.getByText(/暂无市场基准数据/)).toBeInTheDocument()
      expect(screen.getByText(/暂无数据源使用记录/)).toBeInTheDocument()
    })
  })

  describe('MonthlyReportPage - §10 Next Month Recommendations', () => {
    it('should POST to the recommendations endpoint and render the result with cost', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(okResponse({ success: true, report: makeReport() }))
        .mockResolvedValueOnce(okResponse({
          success: true,
          recommendations: '1. Publish two GEO posts\nTarget the Queenstown queries.',
          cost_usd: 0.0123,
        }))
      vi.stubGlobal('fetch', fetchMock)
      render(<MonthlyReportPage />)

      await waitFor(() => screen.getByRole('button', { name: '✨ Generate Recommendations' }))
      fireEvent.click(screen.getByRole('button', { name: '✨ Generate Recommendations' }))

      await waitFor(() => {
        expect(screen.getByText('1. Publish two GEO posts')).toBeInTheDocument()
      })
      expect(screen.getByText('Target the Queenstown queries.')).toBeInTheDocument()
      expect(screen.getByText(/Generated by Strategy Engine · cost \$0\.0123/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument()

      const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit]
      expect(url).toBe('/api/reports/test-client-123/monthly/recommendations')
      expect(init.method).toBe('POST')
    })

    it('should show the generation error and keep the generate button', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(okResponse({ success: true, report: makeReport() }))
        .mockResolvedValueOnce(okResponse({ success: false, error: 'Strategy Engine unavailable' }))
      vi.stubGlobal('fetch', fetchMock)
      render(<MonthlyReportPage />)

      await waitFor(() => screen.getByRole('button', { name: '✨ Generate Recommendations' }))
      fireEvent.click(screen.getByRole('button', { name: '✨ Generate Recommendations' }))

      await waitFor(() => {
        expect(screen.getByText('Strategy Engine unavailable')).toBeInTheDocument()
      })
      expect(screen.getByRole('button', { name: '✨ Generate Recommendations' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Regenerate' })).toBeNull()
    })
  })
})
