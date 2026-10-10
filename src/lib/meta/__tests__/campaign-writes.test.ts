import { afterEach, describe, expect, it, vi } from 'vitest'
import { setCampaignDailyBudget, setCampaignStatus } from '../campaign-writes'

describe('setCampaignDailyBudget', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the campaign-level minor-unit budget', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    expect(await setCampaignDailyBudget('12345', 'token', 4_200)).toBe(true)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/12345')
    expect(init.method).toBe('POST')
    expect(new URLSearchParams(String(init.body)).get('daily_budget')).toBe('4200')
  })

  it.each([['bad-id', 100], ['123', -1], ['123', 1.5], ['123', Number.NaN]])('rejects invalid campaign or amount before network call', async (id, amount) => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect(await setCampaignDailyBudget(id, 'token', amount)).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reports provider rejection as failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 200 })))
    expect(await setCampaignDailyBudget('123', 'token', 4_200)).toBe(false)
  })
})

describe('setCampaignStatus', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the requested campaign status', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    expect(await setCampaignStatus('12345', 'token', 'ACTIVE')).toBe(true)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/12345')
    expect(init.method).toBe('POST')
    expect(new URLSearchParams(String(init.body)).get('status')).toBe('ACTIVE')
  })

  it('rejects invalid campaign IDs before network call', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect(await setCampaignStatus('bad-id', 'token', 'ACTIVE')).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })
})
