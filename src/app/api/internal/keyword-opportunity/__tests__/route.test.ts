import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  clients: null as unknown,
  clientsError: null as unknown,
  brief: null as unknown,
  briefError: null as unknown,
  snapshotDay: null as unknown,
  snapshotDayError: null as unknown,
  snapshotRows: [] as unknown,
  snapshotRowsError: null as unknown,
  ideas: [] as unknown,
  ideasError: null as unknown,
  /** when set, only this seed throws; when null every seed throws (if ideasError is set) */
  errorSeed: null as string | null,
  calls: [] as Array<[string, number, number]>,
}))

vi.mock('@/lib/supabase', () => {
  const tableData = (table: string): { data: unknown; error: unknown } => {
    if (table === 'clients') return { data: h.clients, error: h.clientsError }
    if (table === 'master_briefs') return { data: h.brief, error: h.briefError }
    if (table === 'keyword_snapshots') {
      // The snapshot table is read twice: first for the latest day, then for the rows of that day.
      const isDayQuery = h.snapshotDay !== null || h.snapshotDayError !== null
      if (isDayQuery) return { data: h.snapshotDay, error: h.snapshotDayError }
      return { data: h.snapshotRows, error: h.snapshotRowsError }
    }
    return { data: null, error: null }
  }
  const chain = (table: string): Record<string, unknown> => {
    const c: Record<string, unknown> = {}
    c.select = () => c
    c.eq = () => c
    c.order = () => c
    c.limit = () => c
    c.maybeSingle = () => Promise.resolve(tableData(table))
    c.then = (resolve: (v: unknown) => void) => resolve(tableData(table))
    return c
  }
  return { supabaseAdmin: { from: (table: string) => chain(table) } }
})

vi.mock('@/lib/dataforseo/labs-keywords', () => ({
  getKeywordIdeas: async (seed: string, locationCode: number, limit: number) => {
    h.calls.push([seed, locationCode, limit])
    if (h.ideasError && (h.errorSeed === null || h.errorSeed === seed)) throw h.ideasError
    return h.ideas
  },
}))

import { GET } from '../route'
import { estimateMaxCostUsd, MAX_IDEAS_PER_SEED } from '@/lib/seo-intelligence/keyword-opportunity'

const CID = 'c0000000-0000-0000-0000-000000000000'
const req = (qs = '', auth?: string) =>
  new NextRequest(`http://x/api/internal/keyword-opportunity${qs}`, { headers: auth ? { authorization: auth } : {} })

const CLIENT = {
  id: CID,
  domain: 'example.co.nz',
  semrush_db: 'nz',
  brand_aliases: ['cts'],
  competitor_domains: ['wendywutours.co.nz'],
}
const BRIEF = { keyword_seeds: ['seo audit', 'technical seo', 'site speed'] }

const idea = (keyword: string, volume: number, intent = 'commercial') => ({
  keyword,
  search_volume: volume,
  keyword_difficulty: 20,
  intent,
  cpc: 1.5,
})

function reset() {
  h.clients = null
  h.clientsError = null
  h.brief = null
  h.briefError = null
  h.snapshotDay = null
  h.snapshotDayError = null
  h.snapshotRows = []
  h.snapshotRowsError = null
  h.ideas = []
  h.ideasError = null
  h.errorSeed = null
  h.calls = []
}

describe('GET /api/internal/keyword-opportunity', () => {
  afterEach(() => {
    delete process.env.CRON_SECRET
    reset()
  })

  it('fails closed without the secret / wrong bearer; client_id is REQUIRED and must be a UUID', async () => {
    expect((await GET(req(`?client_id=${CID}`))).status).toBe(500)
    process.env.CRON_SECRET = 's'
    expect((await GET(req(`?client_id=${CID}`))).status).toBe(401)
    expect((await GET(req(`?client_id=${CID}`, 'Bearer nope'))).status).toBe(401)
    expect((await GET(req('', 'Bearer s'))).status).toBe(400)
    expect((await GET(req("?client_id=x'%20or%201=1", 'Bearer s'))).status).toBe(400)
  })

  it('a dry run (no dry_run param) makes ZERO vendor calls and returns the plan', async () => {
    process.env.CRON_SECRET = 's'
    h.clients = CLIENT
    h.brief = BRIEF
    const res = await GET(req(`?client_id=${CID}`, 'Bearer s'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.dry_run).toBe(true)
    expect(body.paid_calls_made).toBe(0)
    expect(h.calls.length).toBe(0)
    expect(body.plan.seeds).toEqual(['seo audit', 'technical seo', 'site speed'])
    expect(body.plan.est_max_cost_usd).toBe(estimateMaxCostUsd(3, 150))
  })

  it('dry_run=1 behaves the same as no param — only dry_run=0 spends', async () => {
    process.env.CRON_SECRET = 's'
    h.clients = CLIENT
    h.brief = BRIEF
    const res = await GET(req(`?client_id=${CID}&dry_run=1`, 'Bearer s'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.dry_run).toBe(true)
    expect(h.calls.length).toBe(0)
  })

  it('a real run (dry_run=0) calls the vendor once per seed, in order, and returns a summary', async () => {
    process.env.CRON_SECRET = 's'
    h.clients = CLIENT
    h.brief = BRIEF
    h.ideas = [idea('seo audit services', 500), idea('technical seo help', 300)]
    const res = await GET(req(`?client_id=${CID}&dry_run=0`, 'Bearer s'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(h.calls.length).toBe(3)
    expect(h.calls[0]).toEqual(['seo audit', 2554, 150])
    expect(h.calls[1]).toEqual(['technical seo', 2554, 150])
    expect(h.calls[2]).toEqual(['site speed', 2554, 150])
    expect(body.dry_run).toBe(false)
    expect(body.paid_calls_made).toBe(3)
    expect(body.summary.rows_total).toBeGreaterThan(0)
  })

  it('limit is bounded: 500 and 5 fall back to 150, 200 is used as given', async () => {
    process.env.CRON_SECRET = 's'
    h.clients = CLIENT
    h.brief = BRIEF
    h.ideas = [idea('seo audit services', 500)]
    await GET(req(`?client_id=${CID}&dry_run=0&limit=500`, 'Bearer s'))
    await GET(req(`?client_id=${CID}&dry_run=0&limit=5`, 'Bearer s'))
    await GET(req(`?client_id=${CID}&dry_run=0&limit=200`, 'Bearer s'))
    expect(h.calls[0][2]).toBe(150)
    expect(h.calls[3][2]).toBe(150)
    expect(h.calls[6][2]).toBe(200)
    expect(MAX_IDEAS_PER_SEED).toBeGreaterThanOrEqual(200)
  })

  it('one seed throwing is reported as error, still counts the attempt, and leaks no message text', async () => {
    process.env.CRON_SECRET = 's'
    h.clients = CLIENT
    h.brief = BRIEF
    h.ideas = [idea('seo audit services', 500)]
    h.ideasError = new Error('vendor exploded: secret-token-xyz')
    h.errorSeed = 'technical seo' // only the middle seed fails; the other two succeed
    const res = await GET(req(`?client_id=${CID}&dry_run=0`, 'Bearer s'))
    const text = JSON.stringify(await res.json())
    expect(res.status).toBe(200)
    expect(text).not.toContain('secret-token-xyz')
    expect(text).not.toContain('vendor exploded')
    expect(text).toContain('"status":"error"')
    expect(text).toContain('"paid_calls_made":3')
  })

  it('every seed failing or empty is a 500 no_data, never an empty success', async () => {
    process.env.CRON_SECRET = 's'
    h.clients = CLIENT
    h.brief = BRIEF
    h.ideas = []
    const res = await GET(req(`?client_id=${CID}&dry_run=0`, 'Bearer s'))
    const body = await res.json()
    expect(res.status).toBe(500)
    expect(body.status).toBe('no_data')
    expect(body.success).toBe(false)
  })

  it('no seeds in the brief is a 200 no_seeds with no vendor call', async () => {
    process.env.CRON_SECRET = 's'
    h.clients = CLIENT
    h.brief = { keyword_seeds: [] }
    const res = await GET(req(`?client_id=${CID}&dry_run=0`, 'Bearer s'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.status).toBe('no_seeds')
    expect(h.calls.length).toBe(0)
  })

  it('unknown client is 404; a clients read error is 500 with the fixed text only', async () => {
    process.env.CRON_SECRET = 's'
    h.clients = null
    expect((await GET(req(`?client_id=${CID}`, 'Bearer s'))).status).toBe(404)
    h.clientsError = { message: 'relation "clients" does not exist' }
    const res = await GET(req(`?client_id=${CID}`, 'Bearer s'))
    const text = JSON.stringify(await res.json())
    expect(res.status).toBe(500)
    expect(text).toContain('client read failed')
    expect(text).not.toContain('relation')
  })

  it('brand and competitor-brand phrases are excluded from the summary rows', async () => {
    process.env.CRON_SECRET = 's'
    h.clients = CLIENT
    h.brief = BRIEF
    h.ideas = [
      idea('cts seo audit', 900),
      idea('wendywutours seo', 800),
      idea('seo audit services', 500),
    ]
    const res = await GET(req(`?client_id=${CID}&dry_run=0`, 'Bearer s'))
    const body = await res.json()
    expect(res.status).toBe(200)
    const keywords = body.summary.top_buyer.map((r: { keyword: string }) => r.keyword)
    expect(keywords).toContain('seo audit services')
    expect(keywords).not.toContain('cts seo audit')
    expect(keywords).not.toContain('wendywutours seo')
  })

  it('the relevance gate is applied: phrases sharing no topic word with the seeds, and travel-noise phrases, never reach the summary', async () => {
    process.env.CRON_SECRET = 's'
    h.clients = CLIENT
    h.brief = BRIEF // seeds: seo audit / technical seo / site speed
    h.ideas = [
      idea('technical seo checklist', 900),
      idea('cheap pasta recipes', 40000),
      idea('seo audit flights', 30000),
    ]
    const res = await GET(req(`?client_id=${CID}&dry_run=0`, 'Bearer s'))
    const body = await res.json()
    expect(res.status).toBe(200)
    const all = JSON.stringify(body.summary)
    expect(all).toContain('technical seo checklist')
    expect(all).not.toContain('cheap pasta recipes')
    expect(all).not.toContain('seo audit flights')
    expect(body.summary.excluded.offTopic).toBeGreaterThan(0)
    expect(body.summary.excluded.noise).toBeGreaterThan(0)
  })
})

