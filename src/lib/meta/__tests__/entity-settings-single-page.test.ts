import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchAdsetsSinglePage } from '../entity-settings'

const jsonResponse = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchAdsetsSinglePage', () => {
  it('filters on the caller statuses (including PENDING_BILLING_INFO) and reads one page', async () => {
    const mock = vi.fn().mockResolvedValueOnce(jsonResponse({ data: [{ id: 'a1' }] }))
    vi.stubGlobal('fetch', mock)
    const r = await fetchAdsetsSinglePage('act_1', 'tok', ['ACTIVE', 'PENDING_BILLING_INFO'])
    expect(mock).toHaveBeenCalledTimes(1)
    const url = new URL(String(mock.mock.calls[0][0]))
    expect(url.searchParams.get('filtering')).toContain('PENDING_BILLING_INFO')
    expect(r.complete).toBe(true)
    expect(r.rows).toHaveLength(1)
  })

  it('a paging.next is NOT followed: exactly one HTTP request, result incomplete', async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'a1' }], paging: { next: 'https://graph.example/next' } }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'a2' }] }))
    vi.stubGlobal('fetch', mock)
    const r = await fetchAdsetsSinglePage('act_1', 'tok', ['ACTIVE'])
    expect(mock).toHaveBeenCalledTimes(1)
    expect(r.complete).toBe(false)
    expect(r.error?.message).toContain('more than one page')
  })

  it('an http error becomes an incomplete result with no rows', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ error: { message: 'x', code: 4 } }, 400)))
    const r = await fetchAdsetsSinglePage('act_1', 'tok', ['ACTIVE'])
    expect(r.complete).toBe(false)
    expect(r.rows).toEqual([])
  })
})
