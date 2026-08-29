/**
 * Tests for the #1113 client work digest PREVIEW ONLY read path.
 *
 * Focus per Build Control contract: client isolation, time window, empty
 * data, source/timestamp retention, and the "execution record ≠ Outcome"
 * boundary — never a send/write path (there isn't one in v0).
 */

import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildDigestEvents,
  computeWindow,
  fetchWorkLogsForPreview,
  firstHeadline,
  renderPreview,
  splitSections,
  type WorkLogRow,
} from '../preview'

// ── splitSections ────────────────────────────────────────────────────────────

describe('splitSections', () => {
  it('splits a real fde_work_logs summary into verbatim-tagged sections', () => {
    const summary =
      '【SEO】修复 8 处站内链接。【GEO】12 篇内容线大纲完成。下一步：等 PM 确认发布顺序。'
    const sections = splitSections(summary)
    expect(sections).toEqual([
      { tag: 'SEO', text: '修复 8 处站内链接。' },
      { tag: 'GEO', text: '12 篇内容线大纲完成。' },
      { tag: '下一步', text: '等 PM 确认发布顺序。' },
    ])
  })

  it('keeps an unrecognised bracket tag verbatim rather than remapping it onto a pillar', () => {
    const sections = splitSections('【GBP】更新营业时间。')
    expect(sections).toEqual([{ tag: 'GBP', text: '更新营业时间。' }])
  })

  it('falls back to a single untagged section when there is no bracket marker', () => {
    const sections = splitSections('今天只是打了个电话确认地址。')
    expect(sections).toEqual([{ tag: null, text: '今天只是打了个电话确认地址。' }])
  })

  it('returns no sections for blank input', () => {
    expect(splitSections('   ')).toEqual([])
  })

  it('keeps leading untagged text before the first bracket as its own section', () => {
    const sections = splitSections('先聊了下背景。【广告】暂停一组低效广告。')
    expect(sections).toEqual([
      { tag: null, text: '先聊了下背景。' },
      { tag: '广告', text: '暂停一组低效广告。' },
    ])
  })
})

// ── firstHeadline ────────────────────────────────────────────────────────────

describe('firstHeadline', () => {
  it('stops at the first sentence terminator', () => {
    expect(firstHeadline('修复 8 处链接。后续还会继续跟进。')).toBe('修复 8 处链接')
  })

  it('truncates long single-sentence text to the max length with an ellipsis', () => {
    const long = 'a'.repeat(200)
    const headline = firstHeadline(long, 120)
    expect(headline.length).toBe(120)
    expect(headline.endsWith('…')).toBe(true)
  })

  it('returns the whole trimmed text when short and unterminated', () => {
    expect(firstHeadline('  短句无标点  ')).toBe('短句无标点')
  })
})

// ── computeWindow ────────────────────────────────────────────────────────────

describe('computeWindow', () => {
  it('defaults to the 24h ending at now', () => {
    const now = new Date('2026-08-29T09:00:00.000Z')
    const window = computeWindow(now)
    expect(window.hours).toBe(24)
    expect(window.end).toBe('2026-08-29T09:00:00.000Z')
    expect(window.start).toBe('2026-08-28T09:00:00.000Z')
  })

  it('honours a custom hours override', () => {
    const now = new Date('2026-08-29T09:00:00.000Z')
    const window = computeWindow(now, 6)
    expect(window.start).toBe('2026-08-29T03:00:00.000Z')
  })

  it('rejects a non-positive hours value rather than silently producing a bad window', () => {
    expect(() => computeWindow(new Date(), 0)).toThrow()
    expect(() => computeWindow(new Date(), -5)).toThrow()
  })
})

// ── buildDigestEvents ────────────────────────────────────────────────────────

describe('buildDigestEvents', () => {
  it('preserves the source work_log id and timestamp on every event', () => {
    const rows: WorkLogRow[] = [
      {
        id: 'wl-1',
        client_id: 'client-a',
        log_date: '2026-08-28',
        summary: '【SEO】修复 3 处链接。【广告】暂停一组广告。',
        author_email: 'pm@example.com',
        created_at: '2026-08-28T22:00:00.000Z',
      },
    ]
    const events = buildDigestEvents(rows)
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      workLogId: 'wl-1',
      logDate: '2026-08-28',
      occurredAt: '2026-08-28T22:00:00.000Z',
      sourceTag: 'SEO',
    })
    expect(events[1].sourceTag).toBe('广告')
  })
})

// ── fetchWorkLogsForPreview (client isolation + time window) ────────────────

interface FakeChainCalls {
  select: string[]
  eq: [string, string][]
  gte: [string, string][]
  lt: [string, string][]
  range: [number, number][]
}

interface FakeChain {
  eq: (col: string, val: string) => FakeChain
  gte: (col: string, val: string) => FakeChain
  lt: (col: string, val: string) => FakeChain
  order: (col: string, opts?: { ascending?: boolean }) => FakeChain
  range: (
    from: number,
    to: number,
  ) => Promise<{ data: WorkLogRow[] | null; error: { message: string } | null }>
}

/** Drives the fake chain from a per-page callback so tests can simulate
 *  PostgREST's row cap without materializing huge fixtures by hand. */
function makeFakeSupabasePaged(
  pageProvider: (pageIndex: number) => WorkLogRow[],
  error: { message: string } | null = null,
): { sb: SupabaseClient; calls: FakeChainCalls } {
  const calls: FakeChainCalls = { select: [], eq: [], gte: [], lt: [], range: [] }
  let pageIndex = 0
  const chain: FakeChain = {
    eq: (col: string, val: string) => {
      calls.eq.push([col, val])
      return chain
    },
    gte: (col: string, val: string) => {
      calls.gte.push([col, val])
      return chain
    },
    lt: (col: string, val: string) => {
      calls.lt.push([col, val])
      return chain
    },
    order: () => chain,
    range: (from: number, to: number) => {
      calls.range.push([from, to])
      if (error) return Promise.resolve({ data: null, error })
      const data = pageProvider(pageIndex)
      pageIndex++
      return Promise.resolve({ data, error: null })
    },
  }
  const from = (table: string) => {
    expect(table).toBe('fde_work_logs')
    return {
      select: (cols: string) => {
        calls.select.push(cols)
        return chain
      },
    }
  }
  return { sb: { from } as unknown as SupabaseClient, calls }
}

/** Single-page fake: every page request returns the same fixed row set,
 *  matching prior test behaviour for fixtures well under the page size. */
function makeFakeSupabase(
  rows: WorkLogRow[] | null,
  error: { message: string } | null = null,
): { sb: SupabaseClient; calls: FakeChainCalls } {
  return makeFakeSupabasePaged(() => rows ?? [], error)
}

function makeRow(id: string): WorkLogRow {
  return {
    id,
    client_id: 'client-a',
    log_date: '2026-08-28',
    summary: '',
    author_email: 'fde@magicengine.cloud',
    created_at: '2026-08-28T00:00:00.000Z',
  }
}

describe('fetchWorkLogsForPreview', () => {
  const window = computeWindow(new Date('2026-08-29T09:00:00.000Z'), 24)

  it('scopes the query to exactly the requested client_id', async () => {
    const { sb, calls } = makeFakeSupabase([])
    await fetchWorkLogsForPreview(sb, 'client-a', window)
    expect(calls.eq).toContainEqual(['client_id', 'client-a'])
  })

  it('never leaks another client_id into the query', async () => {
    const { sb, calls } = makeFakeSupabase([])
    await fetchWorkLogsForPreview(sb, 'client-a', window)
    expect(calls.eq.some(([col, val]) => col === 'client_id' && val !== 'client-a')).toBe(false)
  })

  it('scopes the query to the requested time window', async () => {
    const { sb, calls } = makeFakeSupabase([])
    await fetchWorkLogsForPreview(sb, 'client-a', window)
    expect(calls.gte).toContainEqual(['created_at', window.start])
    expect(calls.lt).toContainEqual(['created_at', window.end])
  })

  it('surfaces a query error instead of silently returning rows', async () => {
    const { sb } = makeFakeSupabase(null, { message: 'boom' })
    const result = await fetchWorkLogsForPreview(sb, 'client-a', window)
    expect(result.error).toBe('boom')
    expect(result.rows).toEqual([])
  })

  it('pages past PostgREST’s row cap instead of truncating to the first page', async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => makeRow(`page0-${i}`))
    const lastPage = [makeRow('page1-0'), makeRow('page1-1')]
    const { sb, calls } = makeFakeSupabasePaged((pageIndex) => (pageIndex === 0 ? fullPage : lastPage))

    const result = await fetchWorkLogsForPreview(sb, 'client-a', window)

    expect(result.rows).toHaveLength(1002)
    expect(result.truncated).toBeUndefined()
    expect(calls.range).toEqual([
      [0, 999],
      [1000, 1999],
    ])
  })

  it('marks the result truncated instead of silently dropping rows past the safety cap', async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => makeRow(`row-${i}`))
    const { sb, calls } = makeFakeSupabasePaged(() => fullPage)

    const result = await fetchWorkLogsForPreview(sb, 'client-a', window)

    expect(result.truncated).toBe(true)
    expect(result.rows).toHaveLength(50 * 1000)
    expect(calls.range).toHaveLength(50)
  })
})

// ── renderPreview ────────────────────────────────────────────────────────────

describe('renderPreview', () => {
  const window = computeWindow(new Date('2026-08-29T09:00:00.000Z'), 24)

  it('renders NO_SOURCE_EVIDENCE and fabricates nothing when there are zero events', () => {
    const { html, receipt } = renderPreview('client-a', window, [], 'sender <hello@magicengine.cloud>')
    expect(receipt.status).toBe('NO_SOURCE_EVIDENCE')
    expect(receipt.eventCount).toBe(0)
    expect(html).toContain('NO_SOURCE_EVIDENCE')
  })

  it('only shows a pillar-style tag when the source explicitly carried one', () => {
    const rows: WorkLogRow[] = [
      {
        id: 'wl-1',
        client_id: 'client-a',
        log_date: '2026-08-28',
        summary: '随口聊了几句，没有正式记录。',
        author_email: 'pm@example.com',
        created_at: '2026-08-28T22:00:00.000Z',
      },
    ]
    const events = buildDigestEvents(rows)
    const { html } = renderPreview('client-a', window, events, 'sender <hello@magicengine.cloud>')
    expect(html).toContain('未分类')
    expect(html).not.toContain('>SEO<')
  })

  it('labels the preview execution-record-only with Outcome explicitly UNKNOWN', () => {
    const rows: WorkLogRow[] = [
      {
        id: 'wl-1',
        client_id: 'client-a',
        log_date: '2026-08-28',
        summary: '【SEO】修复 3 处链接。',
        author_email: 'pm@example.com',
        created_at: '2026-08-28T22:00:00.000Z',
      },
    ]
    const events = buildDigestEvents(rows)
    const { html } = renderPreview('client-a', window, events, 'sender <hello@magicengine.cloud>')
    expect(html).toContain('Outcome 状态：UNKNOWN')
    expect(html).toContain('PREVIEW ONLY')
  })

  it('shows the fixed sender display without ever claiming a send happened', () => {
    const { html } = renderPreview('client-a', window, [], 'Magic Engine 客户摘要（预览） <hello@magicengine.cloud>')
    expect(html).toContain('hello@magicengine.cloud')
    expect(html).not.toMatch(/已发送|sent to/i)
  })

  it('keeps the source receipt for every rendered event traceable to its work log row', () => {
    const rows: WorkLogRow[] = [
      {
        id: 'wl-42',
        client_id: 'client-a',
        log_date: '2026-08-28',
        summary: '【广告】暂停一组低效广告。',
        author_email: 'pm@example.com',
        created_at: '2026-08-28T22:00:00.000Z',
      },
    ]
    const events = buildDigestEvents(rows)
    const { receipt } = renderPreview('client-a', window, events, 'sender <hello@magicengine.cloud>')
    expect(receipt.events[0].workLogId).toBe('wl-42')
    expect(receipt.events[0].occurredAt).toBe('2026-08-28T22:00:00.000Z')
  })
})
