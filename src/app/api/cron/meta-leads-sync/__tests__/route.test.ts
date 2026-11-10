import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  clock: 0,
  finish: vi.fn(async () => undefined),
  probeAll: vi.fn(),
  running: [] as { id: string; started_at: string }[],
  deletes: [] as string[],
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table !== 'cron_run_logs') {
        return {
          select: () => ({
            not: async () => ({
              data: [{ id: 'c-1', name: 'C', facebook_page_id: 'p', country: 'NZ', semrush_db: 'nz' }],
              error: null,
            }),
          }),
        }
      }
      let mode: 'select' | 'delete' = 'select'
      const filters: Record<string, string> = {}
      const chain = {
        select: () => chain,
        delete: () => {
          mode = 'delete'
          return chain
        },
        eq: (col: string, val: string) => {
          filters[col] = val
          return chain
        },
        gte: async () => ({ data: h.running, error: null }),
        then: (
          resolve: (value: { error: null }) => unknown,
          reject?: (err: unknown) => unknown,
        ) => {
          if (mode === 'delete' && filters.id) h.deletes.push(filters.id)
          return Promise.resolve({ error: null }).then(resolve, reject)
        },
      }
      return chain
    },
  },
}))
vi.mock('@/lib/cron/run-logger', () => ({
  startCronRun: vi.fn(async () => ({ id: 'run-new', finish: h.finish })),
}))
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

import { startCronRun } from '@/lib/cron/run-logger'
import { syncClientMetaLeads } from '@/lib/meta/leads-sync'
import { POST } from '../route'

const BASE = 1_700_000_000_000

beforeEach(() => {
  h.clock = 0
  h.running = []
  h.deletes = []
  h.finish.mockClear()
  h.probeAll.mockReset()
  vi.mocked(startCronRun).mockClear()
  vi.mocked(syncClientMetaLeads).mockClear()
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
    expect(startCronRun).toHaveBeenCalledTimes(1)
    expect(h.finish).toHaveBeenCalledTimes(1)
    const arg = (h.finish.mock.calls[0] as unknown[])[0] as {
      summary: { accountStatusProbe: { timedOut: boolean; error: string } }
    }
    expect(arg.summary.accountStatusProbe.timedOut).toBe(true)
    expect(arg.summary.accountStatusProbe.error).toContain('skipped')
    expect((await res.json()).ok).toBe(true)
  })

  it('a fresh running row skips the sync and writes no second log', async () => {
    h.running = [{ id: 'run-old', started_at: new Date(BASE).toISOString() }]
    const res = await call()
    expect(syncClientMetaLeads).not.toHaveBeenCalled()
    expect(startCronRun).not.toHaveBeenCalled()
    expect(h.finish).not.toHaveBeenCalled()
    expect(h.deletes).toEqual([])
    expect(await res.json()).toEqual({ ok: true, skipped: 'overlap', activeRunId: 'run-old' })
  })
})
