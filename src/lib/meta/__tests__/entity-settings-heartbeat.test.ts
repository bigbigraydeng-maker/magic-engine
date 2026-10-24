import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchHeartbeatAccount,
  fetchHeartbeatAdsets,
  fetchHeartbeatAds,
  fetchHeartbeatTodayInsights,
  HEARTBEAT_READ_CALLS_PER_ACCOUNT,
} from '../entity-settings'

const jsonResponse = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Stub fetch with a queue of responses; returns the mock plus a helper to read the Nth requested URL. */
function stubFetchQueue(responses: Array<Response | Error>) {
  const mock = vi.fn()
  for (const r of responses) {
    if (r instanceof Error) mock.mockRejectedValueOnce(r)
    else mock.mockResolvedValueOnce(r)
  }
  vi.stubGlobal('fetch', mock)
  const urlAt = (i = 0) => new URL(String(mock.mock.calls[i][0]))
  return { mock, urlAt }
}

describe('fetchHeartbeatAccount', () => {
  it('requests the account with narrowed fields and returns the body', async () => {
    const body = { id: 'act_1', account_status: 1, currency: 'USD', timezone_name: 'America/New_York' }
    const { mock, urlAt } = stubFetchQueue([jsonResponse(body)])

    const result = await fetchHeartbeatAccount('act_1', 'tok')

    expect(mock).toHaveBeenCalledTimes(1)
    const url = urlAt()
    expect(url.pathname).toContain('/act_1')
    expect(url.searchParams.get('fields')).toBe('id,account_status,disable_reason,currency,timezone_name')
    expect(result.rows).toEqual([body])
    expect(result.complete).toBe(true)
    expect(result.error).toBeNull()
  })
})

describe('fetchHeartbeatAdsets', () => {
  it('reads adsets with a slim field set and a live-status filter', async () => {
    const { urlAt } = stubFetchQueue([jsonResponse({ data: [] })])

    await fetchHeartbeatAdsets('act_1', 'tok')

    const url = urlAt()
    expect(url.pathname).toContain('act_1/adsets')

    const fields = url.searchParams.get('fields') ?? ''
    expect(fields).not.toContain('targeting')
    expect(fields).not.toContain('ad_studies')
    // 不展开 creative{...}（is_dynamic_creative 是普通布尔字段，名字里带 creative 但不是展开）
    expect(fields).not.toContain('creative{')

    const filtering = JSON.parse(url.searchParams.get('filtering') ?? '[]') as Array<{
      field: string
      operator: string
      value: string[]
    }>
    expect(filtering).toHaveLength(1)
    expect(filtering[0].field).toBe('effective_status')
    expect(filtering[0].operator).toBe('IN')
    expect(filtering[0].value).toContain('ACTIVE')
    expect(filtering[0].value).not.toContain('PAUSED')
    expect(filtering[0].value).not.toContain('ARCHIVED')
  })
})

describe('fetchHeartbeatAds', () => {
  it('reads ads without expanding creative', async () => {
    const { urlAt } = stubFetchQueue([jsonResponse({ data: [] })])

    await fetchHeartbeatAds('act_1', 'tok')

    const url = urlAt()
    expect(url.pathname).toContain('act_1/ads')
    expect(url.searchParams.get('fields')).toBe('id,adset_id,effective_status,updated_time')
    expect(url.searchParams.get('fields')).not.toContain('creative')
  })
})

describe('fetchHeartbeatTodayInsights', () => {
  it('reads adset-level insights for the given day', async () => {
    const { urlAt } = stubFetchQueue([jsonResponse({ data: [] })])

    await fetchHeartbeatTodayInsights('act_1', 'tok', '2026-10-21')

    const url = urlAt()
    expect(url.pathname).toContain('act_1/insights')
    expect(url.searchParams.get('level')).toBe('adset')
    expect(url.searchParams.get('fields')).toBe('adset_id,spend,impressions')
    expect(JSON.parse(url.searchParams.get('time_range') ?? '{}')).toEqual({
      since: '2026-10-21',
      until: '2026-10-21',
    })
  })
})

describe('paging', () => {
  it('follows paging.next and concatenates rows', async () => {
    const { mock } = stubFetchQueue([
      jsonResponse({ data: [{ id: '1' }], paging: { next: 'https://graph.facebook.com/next-page' } }),
      jsonResponse({ data: [{ id: '2' }] }),
    ])

    const result = await fetchHeartbeatAdsets('act_1', 'tok')

    expect(mock).toHaveBeenCalledTimes(2)
    expect(result.rows.map((r) => r.id)).toEqual(['1', '2'])
    expect(result.complete).toBe(true)
    expect(result.error).toBeNull()
  })
})

describe('error handling', () => {
  it('returns incomplete with the Graph error code on an error envelope', async () => {
    stubFetchQueue([jsonResponse({ error: { code: 190, message: 'expired' } }, 400)])

    const result = await fetchHeartbeatAccount('act_1', 'tok')

    expect(result.complete).toBe(false)
    expect(result.rows).toEqual([])
    expect(result.error?.code).toBe(190)
    expect(result.error?.message).not.toContain('tok')
  })

  it('surfaces HTTP 429 with the Graph error code', async () => {
    stubFetchQueue([jsonResponse({ error: { code: 17, message: 'limit' } }, 429)])

    const result = await fetchHeartbeatAccount('act_1', 'tok')

    expect(result.complete).toBe(false)
    expect(result.error?.status).toBe(429)
    expect(result.error?.code).toBe(17)
  })

  it('reports status 0 on a network failure', async () => {
    stubFetchQueue([new Error('boom')])

    const result = await fetchHeartbeatAccount('act_1', 'tok')

    expect(result.complete).toBe(false)
    expect(result.error?.status).toBe(0)
    expect(result.error?.message).toBe('boom')
  })

  it('keeps rows from earlier pages when a later page fails', async () => {
    stubFetchQueue([
      jsonResponse({ data: [{ id: '1' }], paging: { next: 'https://graph.facebook.com/next-page' } }),
      jsonResponse({ error: { code: 1, message: 'nope' } }, 500),
    ])

    const result = await fetchHeartbeatAdsets('act_1', 'tok')

    expect(result.rows.map((r) => r.id)).toEqual(['1'])
    expect(result.complete).toBe(false)
    expect(result.error?.code).toBe(1)
  })
})

describe('HEARTBEAT_READ_CALLS_PER_ACCOUNT', () => {
  it('is 4', () => {
    expect(HEARTBEAT_READ_CALLS_PER_ACCOUNT).toBe(4)
  })
})
