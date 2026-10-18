import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(), receipts: [] as unknown[], rows: [] as unknown[], receiptError: null as unknown,
  rowError: null as unknown, filters: [] as Array<[string, unknown]>,
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))

import { loadStoredGscEvidence } from './topic-gsc-evidence'

const clientId = '11111111-1111-4111-8111-111111111111'
const keyword = 'china tours from nz'
const page = 'https://www.ctstours.co.nz/china-tours-from-new-zealand?utm_source=test'
const receipt = {
  id: '22222222-2222-4222-8222-222222222222',
  request_start_day: '2026-10-01', request_end_day: '2026-10-14',
  data_from_day: '2026-10-01', data_through_day: '2026-10-14',
  finished_at: '2026-10-17T00:00:00Z', skipped_long_urls: 0,
}

function builder(table: string) {
  const result = table === 'gsc_query_page_fetch_receipts'
    ? { data: mocks.receipts, error: mocks.receiptError }
    : { data: mocks.rows, error: mocks.rowError }
  const chain = {
    select: () => chain,
    eq: (key: string, value: unknown) => { mocks.filters.push([key, value]); return chain },
    gte: (key: string, value: unknown) => { mocks.filters.push([`gte:${key}`, value]); return chain },
    lte: (key: string, value: unknown) => { mocks.filters.push([`lte:${key}`, value]); return chain },
    order: () => chain,
    limit: () => Promise.resolve(result),
    range: () => Promise.resolve(result),
  }
  return chain
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-19T00:00:00Z'))
  mocks.from.mockReset().mockImplementation(builder)
  mocks.filters = []
  mocks.receipts = [receipt]
  mocks.rows = [
    { day: '2026-10-12', page_url: page, clicks: 2, impressions: 20 },
    { day: '2026-10-13', page_url: page, clicks: 3, impressions: 30 },
  ]
  mocks.receiptError = null
  mocks.rowError = null
})

describe('stored GSC evidence for a topic', () => {
  it('sums only exact keyword and landing-page rows from a complete receipt', async () => {
    const evidence = await loadStoredGscEvidence(clientId, keyword, page)
    expect(evidence).toMatchObject({
      status: 'observed', metricName: 'GSC impressions', value: 50,
      market: 'All countries; source has no country dimension',
    })
    expect(evidence.finding).toContain('5 clicks')
    expect(mocks.filters).toEqual(expect.arrayContaining([
      ['client_id', clientId], ['query', keyword],
      ['page_key', 'ctstours.co.nz/china-tours-from-new-zealand'],
      ['gte:day', '2026-10-01'], ['lte:day', '2026-10-14'],
    ]))
  })

  it('marks absent rows uncollected instead of treating them as zero impressions', async () => {
    mocks.rows = []
    expect(await loadStoredGscEvidence(clientId, keyword, page)).toMatchObject({ status: 'not_collected' })
  })

  it('does not read row metrics from stale or incomplete receipts', async () => {
    mocks.receipts = [{ ...receipt, data_through_day: '2026-08-01' }]
    expect(await loadStoredGscEvidence(clientId, keyword, page)).toMatchObject({ status: 'not_collected' })
    expect(mocks.from).not.toHaveBeenCalledWith('gsc_query_page_daily')
  })

  it('fails closed if source metrics cannot be read', async () => {
    mocks.rowError = { message: 'read unavailable' }
    expect(await loadStoredGscEvidence(clientId, keyword, page)).toMatchObject({ status: 'not_collected' })
  })

  it('rejects invalid source totals instead of saving a misleading metric', async () => {
    mocks.rows = [{ day: '2026-10-13', page_url: page, clicks: -1, impressions: 30 }]
    expect(await loadStoredGscEvidence(clientId, keyword, page)).toMatchObject({ status: 'not_collected' })
  })
})
