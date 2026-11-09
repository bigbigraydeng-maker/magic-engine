import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const { mockInspectUrl } = vi.hoisted(() => ({ mockInspectUrl: vi.fn() }))

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/gsc/inspect', () => ({
  inspectUrl: mockInspectUrl,
  InspectQuotaError: class InspectQuotaError extends Error {},
}))

import { runIndexCheckBatch, INSPECTABLE_CRAWL_STATUSES } from '../index-check'

type ClientRow = {
  id: string
  seo_config: { weekly_blog: boolean }
}

type ConnectorRow = {
  client_id: string
  anchor: string
  status: string
  config: { site_url: string }
}

type PageRow = {
  id: string
  client_id: string
  url: string
  crawl_status: string
  index_checked_at: string | null
  first_not_indexed_at: string | null
}

interface UpdateRecord {
  id: string
  patch: Record<string, unknown>
}

type Row = ClientRow | ConnectorRow | PageRow

interface QueryResult {
  data: Row[]
  error: null
}

interface Query {
  select(cols: string): Query
  eq(col: string, val: unknown): Query
  in(col: string, vals: readonly unknown[]): Query
  contains(col: string, obj: Record<string, unknown>): Query
  order(col: string, opts: { ascending: boolean; nullsFirst: boolean }): Query
  limit(n: number): Query
  update(patch: Record<string, unknown>): Query
  then(resolve: (value: QueryResult) => void): void
}

interface FakeDb {
  from(table: string): Query
  updates: UpdateRecord[]
}

function asClient(x: object): SupabaseClient {
  return x as SupabaseClient
}

function makeFakeDb(): FakeDb {
  const tables: Record<string, Row[]> = {
    clients: [{ id: 'client-1', seo_config: { weekly_blog: true } }],
    client_connectors: [
      {
        client_id: 'client-1',
        anchor: 'gsc',
        status: 'connected',
        config: { site_url: 'sc-domain:example.com' },
      },
    ],
    client_site_pages: [
      {
        id: 'p-crawled',
        client_id: 'client-1',
        url: 'https://example.com/a',
        crawl_status: 'crawled',
        index_checked_at: null,
        first_not_indexed_at: null,
      },
      {
        id: 'p-blocked',
        client_id: 'client-1',
        url: 'https://example.com/b',
        crawl_status: 'antibot_challenged',
        index_checked_at: null,
        first_not_indexed_at: null,
      },
      {
        id: 'p-failed',
        client_id: 'client-1',
        url: 'https://example.com/c',
        crawl_status: 'failed',
        index_checked_at: null,
        first_not_indexed_at: null,
      },
      {
        id: 'p-pending',
        client_id: 'client-1',
        url: 'https://example.com/d',
        crawl_status: 'pending',
        index_checked_at: null,
        first_not_indexed_at: null,
      },
    ],
  }

  const updates: UpdateRecord[] = []

  function from(table: string): Query {
    const rows = tables[table] ?? []
    let filtered: Row[] = rows.slice()
    let pendingPatch: Record<string, unknown> | null = null

    const query: Query = {
      select() {
        return query
      },
      eq(col, val) {
        filtered = filtered.filter((r) => (r as Record<string, unknown>)[col] === val)
        return query
      },
      in(col, vals) {
        filtered = filtered.filter((r) => vals.includes((r as Record<string, unknown>)[col]))
        return query
      },
      contains(col, obj) {
        filtered = filtered.filter((r) => {
          const nested = (r as Record<string, unknown>)[col]
          if (typeof nested !== 'object' || nested === null) return false
          const record = nested as Record<string, unknown>
          return Object.keys(obj).every((k) => record[k] === obj[k])
        })
        return query
      },
      order() {
        return query
      },
      limit(n) {
        filtered = filtered.slice(0, n)
        return query
      },
      update(patch) {
        pendingPatch = patch
        return query
      },
      then(resolve) {
        if (pendingPatch) {
          for (const row of filtered) {
            updates.push({ id: (row as { id: string }).id, patch: pendingPatch })
          }
          resolve({ data: [], error: null })
          return
        }
        resolve({ data: filtered, error: null })
      },
    }

    return query
  }

  return { from, updates }
}

beforeEach(() => {
  mockInspectUrl.mockReset()
})

describe('INSPECTABLE_CRAWL_STATUSES', () => {
  it('includes crawled and antibot_challenged', () => {
    expect(INSPECTABLE_CRAWL_STATUSES).toEqual(['crawled', 'antibot_challenged'])
  })
})

describe('runIndexCheckBatch', () => {
  it('inspects crawled and firewall-blocked pages, skipping failed/pending', async () => {
    const db = makeFakeDb()
    mockInspectUrl.mockResolvedValue({
      coverageState: 'Crawled - currently not indexed',
      verdict: 'NEUTRAL',
      indexed: false,
    })

    const result = await runIndexCheckBatch(asClient(db))

    const inspectedUrls = mockInspectUrl.mock.calls.map((c) => c[1] as string).sort()
    expect(inspectedUrls).toEqual(['https://example.com/a', 'https://example.com/b'])
    expect(inspectedUrls).not.toContain('https://example.com/c')
    expect(inspectedUrls).not.toContain('https://example.com/d')

    expect(result.checked).toBe(2)
    expect(result.not_indexed).toBe(2)

    const crawledPatch = db.updates.find((u) => u.id === 'p-crawled')
    const blockedPatch = db.updates.find((u) => u.id === 'p-blocked')
    expect(crawledPatch?.patch.index_verdict).toBe('Crawled - currently not indexed')
    expect(crawledPatch?.patch.first_not_indexed_at).not.toBeNull()
    expect(blockedPatch?.patch.index_verdict).toBe('Crawled - currently not indexed')
    expect(blockedPatch?.patch.first_not_indexed_at).not.toBeNull()
  })

  it('clears first_not_indexed_at when a blocked page is reported indexed', async () => {
    const db = makeFakeDb()
    mockInspectUrl.mockResolvedValue({
      coverageState: 'Submitted and indexed',
      verdict: 'PASS',
      indexed: true,
    })

    await runIndexCheckBatch(asClient(db))

    const blockedPatch = db.updates.find((u) => u.id === 'p-blocked')
    expect(blockedPatch?.patch.first_not_indexed_at).toBeNull()
  })
})
