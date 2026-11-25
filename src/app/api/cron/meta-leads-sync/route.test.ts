import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const CTS = 'c0000000-0000-0000-0000-000000000000'
const OTHER = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  finish: vi.fn(),
  sync: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))
vi.mock('@/lib/cron/run-logger', () => ({
  startCronRun: async () => ({ id: 'run-1', finish: mocks.finish }),
}))
vi.mock('@/lib/meta/leads-sync', () => ({
  syncClientMetaLeads: (...args: unknown[]) => mocks.sync(...args),
}))
vi.mock('@/lib/ads-strategy/portfolio/account-status-probe', () => ({
  probeBudgetFromDeadline: () => 1_000,
  probeAllAccountStatuses: async () => ({
    clients: 0,
    accounts: 0,
    written: 0,
    unchanged: 0,
    failed: 0,
    rateLimited: 0,
    timedOut: false,
    results: [],
  }),
}))

function query(result: unknown) {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  for (const method of ['select', 'eq', 'gte', 'not', 'delete', 'in']) chain[method] = self
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return chain
}

function emptySync(clientId: string) {
  return {
    clientId,
    clientName: null,
    forms: 0,
    leadsFetched: 0,
    leadsIngested: 0,
    newContacts: 0,
    skippedNoIdentity: 0,
    failed: 0,
    settledLookupFailures: 0,
    mailchimp: {},
  }
}

describe('GET /api/cron/meta-leads-sync allowlist summary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('CRON_SECRET', 'local-test')
    vi.stubEnv('EXTERNAL_DATA_PULL_CLIENT_IDS', '')
    delete process.env.EXTERNAL_DATA_PULL_CLIENT_IDS
    mocks.finish.mockResolvedValue(undefined)
    mocks.sync.mockImplementation(async (client: { id: string }) => emptySync(client.id))
    mocks.from.mockImplementation((table: string) => query(
      table === 'clients'
        ? {
            data: [
              { id: CTS, name: 'CTS', facebook_page_id: 'page-cts', country: 'NZ', semrush_db: 'nz' },
              { id: OTHER, name: 'Other', facebook_page_id: 'page-other', country: 'AU', semrush_db: 'au' },
            ],
            error: null,
          }
        : { data: [], error: null },
    ))
  })

  it('keeps CTS, records skipped_by_allowlist, and does not name the skipped client', async () => {
    const { GET } = await import('./route')
    const res = await GET(new NextRequest('http://localhost/api/cron/meta-leads-sync', {
      headers: { authorization: 'Bearer local-test' },
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.skipped_by_allowlist).toBe(1)
    expect(body.clients).toBe(1)
    expect(JSON.stringify(body)).not.toContain(OTHER)
    expect(mocks.sync).toHaveBeenCalledTimes(1)
    expect(mocks.sync.mock.calls[0]?.[0]).toMatchObject({ id: CTS })
    expect(mocks.finish.mock.calls[0]?.[0]).toMatchObject({
      summary: { skipped_by_allowlist: 1 },
    })
  })
})
