/**
 * Unit tests for src/lib/gtrends/client.ts — Google Trends connector.
 *
 * Reference: ROADMAP.md P8.12.S1.5
 *
 * Mock strategy: global fetch is stubbed (SerpAPI); the client module is
 * re-imported each test so getSerpApiKey re-reads env. Pure functions
 * (summarizeInterest / formatInterestForPrompt) are tested directly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  summarizeInterest,
  formatInterestForPrompt,
  type GTrendsPoint,
} from '../client'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function jsonResponse(payload: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as Response)
}

/** 构造 SerpAPI google_trends TIMESERIES 响应。 */
function trendsResponse(values: number[]) {
  return {
    interest_over_time: {
      timeline_data: values.map((v, i) => ({
        timestamp: String(1_700_000_000 + i * 604_800), // 周间隔
        values: [{ extracted_value: v }],
      })),
    },
  }
}

/** 构造 N 个兴趣点（pure function 测试用）。 */
function makePoints(values: number[]): GTrendsPoint[] {
  return values.map((v, i) => ({
    date: `2026-0${(i % 9) + 1}-01`,
    value: v,
  }))
}

let savedSerpKey: string | undefined

beforeEach(() => {
  savedSerpKey = process.env.SERPAPI_API_KEY
  mockFetch.mockReset()
})

afterEach(() => {
  if (savedSerpKey !== undefined) process.env.SERPAPI_API_KEY = savedSerpKey
  else delete process.env.SERPAPI_API_KEY
  vi.resetModules()
})

// ─── fetchInterestOverTime ───────────────────────────────────────────────────

describe('fetchInterestOverTime', () => {
  it('throws when SERPAPI_API_KEY is missing', async () => {
    delete process.env.SERPAPI_API_KEY
    const { fetchInterestOverTime } = await import('../client')
    await expect(fetchInterestOverTime('building supplies', 'AU')).rejects.toThrow(
      /SERPAPI_API_KEY/,
    )
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('parses timeline_data into ascending date/value points', async () => {
    process.env.SERPAPI_API_KEY = 'test-key'
    mockFetch.mockImplementation(() => jsonResponse(trendsResponse([40, 50, 60])))
    const { fetchInterestOverTime } = await import('../client')

    const points = await fetchInterestOverTime('building supplies', 'AU')
    expect(points).toHaveLength(3)
    expect(points[0].value).toBe(40)
    expect(points[2].value).toBe(60)
    expect(points[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('passes geo and engine params to SerpAPI', async () => {
    process.env.SERPAPI_API_KEY = 'test-key'
    mockFetch.mockImplementation(() => jsonResponse(trendsResponse([10])))
    const { fetchInterestOverTime } = await import('../client')

    await fetchInterestOverTime('cafe', 'NZ')
    const calledUrl = mockFetch.mock.calls[0][0] as string
    expect(calledUrl).toContain('engine=google_trends')
    expect(calledUrl).toContain('geo=NZ')
    expect(calledUrl).toContain('data_type=TIMESERIES')
  })

  it('throws on HTTP error', async () => {
    process.env.SERPAPI_API_KEY = 'test-key'
    mockFetch.mockImplementation(() => jsonResponse({}, 500))
    const { fetchInterestOverTime } = await import('../client')
    await expect(fetchInterestOverTime('x', 'AU')).rejects.toThrow(/SerpAPI error: 500/)
  })

  it('throws on SerpAPI error payload', async () => {
    process.env.SERPAPI_API_KEY = 'test-key'
    mockFetch.mockImplementation(() => jsonResponse({ error: 'rate limited' }))
    const { fetchInterestOverTime } = await import('../client')
    await expect(fetchInterestOverTime('x', 'AU')).rejects.toThrow(/rate limited/)
  })

  it('skips rows missing timestamp or extracted_value', async () => {
    process.env.SERPAPI_API_KEY = 'test-key'
    mockFetch.mockImplementation(() =>
      jsonResponse({
        interest_over_time: {
          timeline_data: [
            { timestamp: '1700000000', values: [{ extracted_value: 30 }] },
            { values: [{ extracted_value: 99 }] },          // 无 timestamp
            { timestamp: '1700604800', values: [{}] },       // 无 extracted_value
          ],
        },
      }),
    )
    const { fetchInterestOverTime } = await import('../client')
    const points = await fetchInterestOverTime('x', 'AU')
    expect(points).toHaveLength(1)
    expect(points[0].value).toBe(30)
  })
})

// ─── getIndustryInterestTrend (非致命 wrapper) ───────────────────────────────

describe('getIndustryInterestTrend', () => {
  it('returns no_data summary when SERPAPI_API_KEY is missing (never throws)', async () => {
    delete process.env.SERPAPI_API_KEY
    const { getIndustryInterestTrend } = await import('../client')
    const summary = await getIndustryInterestTrend('building supplies', 'AU')
    expect(summary.has_data).toBe(false)
    expect(summary.trajectory).toBe('no_data')
    expect(summary.query).toBe('building supplies')
  })

  it('returns no_data summary on HTTP error (never throws)', async () => {
    process.env.SERPAPI_API_KEY = 'test-key'
    mockFetch.mockImplementation(() => jsonResponse({}, 503))
    const { getIndustryInterestTrend } = await import('../client')
    const summary = await getIndustryInterestTrend('x', 'AU')
    expect(summary.has_data).toBe(false)
  })

  it('returns a populated summary on success', async () => {
    process.env.SERPAPI_API_KEY = 'test-key'
    mockFetch.mockImplementation(() =>
      jsonResponse(trendsResponse([20, 20, 20, 20, 40, 40, 40, 40])),
    )
    const { getIndustryInterestTrend } = await import('../client')
    const summary = await getIndustryInterestTrend('cafe', 'AU')
    expect(summary.has_data).toBe(true)
    expect(summary.average).toBe(30)
    expect(summary.trajectory).toBe('rising')
  })
})

// ─── summarizeInterest (pure) ────────────────────────────────────────────────

describe('summarizeInterest', () => {
  it('returns no_data for empty points', () => {
    const s = summarizeInterest('x', 'AU', [])
    expect(s.has_data).toBe(false)
    expect(s.average).toBeNull()
    expect(s.recent_shift_pct).toBeNull()
    expect(s.trajectory).toBe('no_data')
  })

  it('computes average across all points', () => {
    const s = summarizeInterest('x', 'AU', makePoints([10, 20, 30]))
    expect(s.average).toBe(20)
  })

  it('detects rising trajectory (recent 4w > prior 4w by ≥10%)', () => {
    const s = summarizeInterest('x', 'AU', makePoints([10, 10, 10, 10, 30, 30, 30, 30]))
    expect(s.trajectory).toBe('rising')
    expect(s.recent_shift_pct).toBe(200)
  })

  it('detects declining trajectory (recent 4w < prior 4w by ≥10%)', () => {
    const s = summarizeInterest('x', 'AU', makePoints([40, 40, 40, 40, 10, 10, 10, 10]))
    expect(s.trajectory).toBe('declining')
  })

  it('detects flat trajectory when shift is small', () => {
    const s = summarizeInterest('x', 'AU', makePoints([50, 50, 50, 50, 52, 52, 52, 52]))
    expect(s.trajectory).toBe('flat')
  })

  it('returns null recent_shift when fewer than 8 points', () => {
    const s = summarizeInterest('x', 'AU', makePoints([10, 20, 30, 40]))
    expect(s.recent_shift_pct).toBeNull()
    expect(s.trajectory).toBe('flat')
  })
})

// ─── formatInterestForPrompt ─────────────────────────────────────────────────

describe('formatInterestForPrompt', () => {
  it('renders a no-data notice when has_data is false', () => {
    const text = formatInterestForPrompt(summarizeInterest('cafe', 'NZ', []))
    expect(text).toContain('无数据')
    expect(text).toContain('cafe')
  })

  it('renders average, shift, trajectory for a populated summary', () => {
    const text = formatInterestForPrompt(
      summarizeInterest('cafe', 'AU', makePoints([10, 10, 10, 10, 30, 30, 30, 30])),
    )
    expect(text).toContain('行业搜索热度趋势')
    expect(text).toContain('12 个月平均兴趣')
    expect(text).toContain('上升')
  })

  it('warns about demand conversion when declining', () => {
    const text = formatInterestForPrompt(
      summarizeInterest('cafe', 'AU', makePoints([40, 40, 40, 40, 10, 10, 10, 10])),
    )
    expect(text).toContain('需求转化')
  })
})
