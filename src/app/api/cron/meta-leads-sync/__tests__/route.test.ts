import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  clock: 0,
  finish: vi.fn(async () => undefined),
  probeAll: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        not: async () => ({
          data: [{ id: 'c-1', name: 'C', facebook_page_id: 'p', country: 'NZ', semrush_db: 'nz' }],
          error: null,
        }),
      }),
    }),
  },
}))
vi.mock('@/lib/cron/run-logger', () => ({ startCronRun: vi.fn(async () => ({ finish: h.finish })) }))
vi.mock('@/lib/meta/leads-sync', () => ({
  // 线索同步「跑了很久」：把假时钟推到整轮截止前 10 秒。
  syncClientMetaLeads: vi.fn(async () => {
    h.clock = 590_000
    return {
      clientId: 'c-1', clientName: 'C', forms: 1, leadsFetched: 0, leadsIngested: 0,
      newContacts: 0, skippedNoIdentity: 0, failed: 0, mailchimp: {},
    }
  }),
}))
vi.mock('@/lib/ads-strategy/portfolio/account-status-probe', async () => {
  const real = await vi.importActual<typeof import('@/lib/ads-strategy/portfolio/account-status-probe')>(
    '@/lib/ads-strategy/portfolio/account-status-probe',
  )
  return { ...real, probeAllAccountStatuses: (...a: unknown[]) => h.probeAll(...a) }
})

import { POST } from '../route'

const BASE = 1_700_000_000_000

beforeEach(() => {
  h.clock = 0
  h.finish.mockClear()
  h.probeAll.mockReset()
  process.env.CRON_SECRET = 's'
  vi.spyOn(Date, 'now').mockImplementation(() => BASE + h.clock)
})
afterEach(() => vi.restoreAllMocks())

const call = () =>
  POST(new Request('http://x/api/cron/meta-leads-sync', { method: 'POST', headers: { 'x-cron-secret': 's' } }) as never)

describe('meta-leads-sync shared deadline', () => {
  it('lead sync used most of the time → probe skipped, receipt still written', async () => {
    const res = await call()
    expect(h.probeAll).not.toHaveBeenCalled()
    expect(h.finish).toHaveBeenCalledTimes(1)
    const arg = (h.finish.mock.calls[0] as unknown[])[0] as {
      summary: { accountStatusProbe: { timedOut: boolean; error: string } }
    }
    expect(arg.summary.accountStatusProbe.timedOut).toBe(true)
    expect(arg.summary.accountStatusProbe.error).toContain('skipped')
    expect((await res.json()).ok).toBe(true)
  })
})
