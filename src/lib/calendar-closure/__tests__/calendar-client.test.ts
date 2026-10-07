import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CALENDAR_READONLY_SCOPE,
  CalendarNotConfiguredError,
  CalendarReadError,
  readCalendarEvents,
  toNzDate,
} from '../calendar-client'
import { PM_CALENDAR_ID } from '../types'

/** 造一个最小可用的 Response。 */
function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain' } })
}

const TODAY = '2026-10-09'

beforeEach(() => {
  vi.unstubAllEnvs()
  // 默认没有服务账号，除非某个用例自己 stub。
  vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_CREDENTIALS', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('toNzDate', () => {
  it('把跨 UTC 边界的瞬时时间映射到新西兰日期', () => {
    // 2026-10-08T20:30:00Z 在新西兰（UTC+13，夏令时）是 2026-10-09 09:30。
    expect(toNzDate('2026-10-08T20:30:00Z')).toBe('2026-10-09')
  })

  it('UTC 当天但新西兰已跨日', () => {
    expect(toNzDate('2026-10-08T12:00:00Z')).toBe('2026-10-09')
  })
})

describe('readCalendarEvents', () => {
  it('把定时事件映射到新西兰日期', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        etag: '"page-1"',
        updated: '2026-10-09T00:00:00.000Z',
        items: [
          {
            id: 'evt-1',
            status: 'confirmed', creator: { self: true },
            summary: '跟进 A',
            description: 'ledger-id: 2026-10-09-abc',
            htmlLink: 'https://calendar.google.com/event?eid=1',
            etag: '"evt-1"',
            updated: '2026-10-08T22:00:00.000Z',
            start: { dateTime: '2026-10-08T20:30:00Z' },
          },
        ],
      }),
    )

    const result = await readCalendarEvents({ todayNz: TODAY, fetcher, token: 'tok' })

    expect(result.events).toHaveLength(1)
    expect(result.events[0].startNz).toBe('2026-10-09')
    expect(result.events[0].title).toBe('跟进 A')
    expect(result.proof).toEqual({ etag: '"page-1"', updated: '2026-10-09T00:00:00.000Z' })
  })

  it('全天事件用 start.date 作为新西兰日期', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        items: [
          {
            id: 'evt-allday',
            status: 'confirmed', creator: { self: true },
            summary: '全天',
            start: { date: '2026-10-09' },
          },
        ],
      }),
    )

    const result = await readCalendarEvents({ todayNz: TODAY, fetcher, token: 'tok' })

    expect(result.events).toHaveLength(1)
    expect(result.events[0].startNz).toBe('2026-10-09')
  })

  it('跳过 cancelled 事件', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        items: [
          { id: 'a', status: 'cancelled', start: { date: '2026-10-09' } },
          { id: 'b', status: 'confirmed', creator: { self: true }, start: { date: '2026-10-09' } },
        ],
      }),
    )

    const result = await readCalendarEvents({ todayNz: TODAY, fetcher, token: 'tok' })

    expect(result.events.map((e) => e.id)).toEqual(['b'])
  })

  it('跳过既没有 date 也没有 dateTime 的事件', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        items: [
          { id: 'no-start', status: 'confirmed' },
          { id: 'ok', status: 'confirmed', creator: { self: true }, start: { date: '2026-10-09' } },
        ],
      }),
    )

    const result = await readCalendarEvents({ todayNz: TODAY, fetcher, token: 'tok' })

    expect(result.events.map((e) => e.id)).toEqual(['ok'])
  })

  it('翻两页并合并结果', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          etag: '"p1"',
          updated: '2026-10-09T00:00:00.000Z',
          nextPageToken: 'page-2',
          items: [{ id: 'a', status: 'confirmed', creator: { self: true }, start: { date: '2026-10-09' } }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          etag: '"p2"',
          updated: '2026-10-09T01:00:00.000Z',
          items: [{ id: 'b', status: 'confirmed', creator: { self: true }, start: { date: '2026-10-09' } }],
        }),
      )

    const result = await readCalendarEvents({ todayNz: TODAY, fetcher, token: 'tok' })

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(result.events.map((e) => e.id)).toEqual(['a', 'b'])
    // proof 取第一页。
    expect(result.proof).toEqual({ etag: '"p1"', updated: '2026-10-09T00:00:00.000Z' })
  })

  it('非 2xx 抛 CalendarReadError 并带上状态码', async () => {
    const fetcher = vi.fn(async () => textResponse('boom', 403))

    await expect(readCalendarEvents({ todayNz: TODAY, fetcher, token: 'tok' })).rejects.toMatchObject({
      name: 'CalendarReadError',
      httpStatus: 403,
    })
  })

  it('网络失败抛 CalendarReadError(0)', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('socket hang up')
    })

    await expect(readCalendarEvents({ todayNz: TODAY, fetcher, token: 'tok' })).rejects.toMatchObject({
      name: 'CalendarReadError',
      httpStatus: 0,
    })
  })

  it('opts.token 直接透传，不需要服务账号', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ items: [] }))

    await readCalendarEvents({ todayNz: TODAY, fetcher, token: 'my-token' })

    const [, init] = fetcher.mock.calls[0]
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer my-token')
  })

  it('没有服务账号也没有 token 时抛 CalendarNotConfiguredError', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ items: [] }))

    await expect(readCalendarEvents({ todayNz: TODAY, fetcher })).rejects.toBeInstanceOf(
      CalendarNotConfiguredError,
    )
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('URL 里带编码后的日历 ID 和 singleEvents=true，且从不出现 primary', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ items: [] }))

    await readCalendarEvents({ todayNz: TODAY, fetcher, token: 'tok' })

    const url = String(fetcher.mock.calls[0][0])
    expect(url).toContain(encodeURIComponent(PM_CALENDAR_ID))
    expect(url).toContain('singleEvents=true')
    expect(url).not.toContain('primary')
  })

  it('每次调用都只用 GET', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ nextPageToken: 'p2', items: [{ id: 'a', status: 'confirmed', creator: { self: true }, start: { date: '2026-10-09' } }] }),
      )
      .mockResolvedValueOnce(jsonResponse({ items: [{ id: 'b', status: 'confirmed', creator: { self: true }, start: { date: '2026-10-09' } }] }))

    await readCalendarEvents({ todayNz: TODAY, fetcher, token: 'tok' })

    for (const call of fetcher.mock.calls) {
      const [, init] = call as [string, RequestInit]
      expect(init.method).toBe('GET')
    }
  })

  it('超过 5 页抛 CalendarReadError(0)', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ nextPageToken: 'always-more', items: [] }),
    )

    await expect(readCalendarEvents({ todayNz: TODAY, fetcher, token: 'tok' })).rejects.toMatchObject({
      name: 'CalendarReadError',
      httpStatus: 0,
    })
    expect(fetcher).toHaveBeenCalledTimes(5)
  })

  it('服务账号换 token 失败时包成 CalendarReadError(401)', async () => {
    vi.stubEnv(
      'GOOGLE_SERVICE_ACCOUNT_CREDENTIALS',
      JSON.stringify({ client_email: 'sa@example.com', private_key: 'not-a-real-key' }),
    )
    const fetcher = vi.fn(async () => textResponse('nope', 400))

    await expect(readCalendarEvents({ todayNz: TODAY, fetcher })).rejects.toMatchObject({
      name: 'CalendarReadError',
      httpStatus: 401,
    })
  })

  it('CALENDAR_READONLY_SCOPE 是 calendar.readonly', () => {
    expect(CALENDAR_READONLY_SCOPE).toBe('https://www.googleapis.com/auth/calendar.readonly')
  })

  it('只收 PM 自己日历创建的事件：外部邀请、已拒绝的事件被丢掉', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({
        items: [
          { id: 'mine', status: 'confirmed', creator: { self: true }, start: { date: '2026-10-09' } },
          { id: 'org', status: 'confirmed', organizer: { self: true }, start: { date: '2026-10-09' } },
          { id: 'stranger', status: 'confirmed', creator: { self: false }, start: { date: '2026-10-09' } },
          { id: 'nocreator', status: 'confirmed', start: { date: '2026-10-09' } },
          {
            id: 'declined',
            status: 'confirmed',
            creator: { self: true },
            attendees: [{ self: true, responseStatus: 'declined' }],
            start: { date: '2026-10-09' },
          },
        ],
      }),
    )
    const result = await readCalendarEvents({ todayNz: TODAY, fetcher, token: 'tok' })
    expect(result.events.map((e) => e.id)).toEqual(['mine', 'org'])
  })
})
