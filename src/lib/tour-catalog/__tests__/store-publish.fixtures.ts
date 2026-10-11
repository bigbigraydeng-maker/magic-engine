/**
 * Table-modelled fake Supabase and row fixtures for store-publish tests.
 * Split from store-publish.test.ts to stay under the 800-line limit.
 */
import { vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PublishPreviewResponse, PublishRequest, RevertRequest } from '../publish-contract'

// ---------------------------------------------------------------------------
// Fake Supabase (table-modelled, not call-order modelled)
// ---------------------------------------------------------------------------

export interface FakeError {
  message: string
}

export interface FakeResult {
  data: unknown
  error: FakeError | null
}

export interface FakeSeed {
  state?: Record<string, unknown> | null
  tours?: Record<string, unknown>[]
  departures?: Record<string, unknown>[]
  aliases?: Record<string, unknown>[]
  published?: Record<string, unknown>[]
  rpc?: (fn: string, args: Record<string, unknown>) => FakeResult
  failTable?: string
}

export interface FakeDb {
  fromCalls: string[]
  selects: Array<{ table: string; cols: string }>
  rpc: ReturnType<typeof vi.fn>
  from: (table: string) => unknown
}

export function tableRows(seed: FakeSeed, table: string): Record<string, unknown>[] {
  if (table === 'tour_catalog_state') {
    return seed.state === null || seed.state === undefined ? [] : [seed.state]
  }
  if (table === 'tour_catalog_tours') {
    return seed.tours ?? []
  }
  if (table === 'tour_catalog_departures') {
    return seed.departures ?? []
  }
  if (table === 'tour_catalog_aliases') {
    return seed.aliases ?? []
  }
  if (table === 'tour_catalog_published') {
    return seed.published ?? []
  }
  return []
}

export function makeFakeDb(seed: FakeSeed): FakeDb {
  const db: FakeDb = {
    fromCalls: [],
    selects: [],
    rpc: vi.fn(),
    from: (table: string) => {
      db.fromCalls.push(table)
      const filters: Array<{ col: string; val: unknown }> = []
      let orderCol: string | null = null
      let orderAscending = true
      let limitCount: number | null = null
      let rangeWindow: [number, number] | null = null

      const applyFilters = (): Record<string, unknown>[] => {
        let rows = tableRows(seed, table).filter((row) =>
          filters.every((f) => row[f.col] === f.val),
        )
        if (orderCol !== null) {
          const col = orderCol
          const asc = orderAscending
          rows = [...rows].sort((a, b) => {
            const av = a[col]
            const bv = b[col]
            if (av === bv) return 0
            const cmp = (av as never) < (bv as never) ? -1 : 1
            return asc ? cmp : -cmp
          })
        }
        if (limitCount !== null) {
          rows = rows.slice(0, limitCount)
        }
        if (rangeWindow !== null) {
          rows = rows.slice(rangeWindow[0], rangeWindow[1] + 1)
        }
        return rows
      }

      const terminal = (): FakeResult => {
        if (seed.failTable === table) {
          return { data: null, error: { message: 'boom' } }
        }
        return { data: applyFilters(), error: null }
      }

      const builder = {
        select: (cols: string) => {
          db.selects.push({ table, cols })
          return builder
        },
        eq: (col: string, val: unknown) => {
          filters.push({ col, val })
          return builder
        },
        order: (col: string, opts: { ascending: boolean }) => {
          if (orderCol === null) {
            orderCol = col
            orderAscending = opts.ascending
          }
          return builder
        },
        limit: (n: number) => {
          limitCount = n
          return builder
        },
        range: (from: number, to: number) => {
          rangeWindow = [from, to]
          return builder
        },
        maybeSingle: () => {
          if (seed.failTable === table) {
            return Promise.resolve({ data: null, error: { message: 'boom' } })
          }
          const rows = applyFilters()
          return Promise.resolve({ data: rows.length > 0 ? rows[0] : null, error: null })
        },
        then: (resolve: (value: FakeResult) => unknown) => {
          return Promise.resolve(terminal()).then(resolve)
        },
      }
      return builder
    },
  }
  db.rpc.mockImplementation((fn: string, args: Record<string, unknown>) => {
    if (seed.rpc !== undefined) {
      return Promise.resolve(seed.rpc(fn, args))
    }
    return Promise.resolve({ data: { version: 99 }, error: null })
  })
  return db
}

export function asDb(db: FakeDb): SupabaseClient {
  return db as never
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export const CLIENT_ID = 'c1'
export const TODAY = '2026-10-10'

export function tourRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 't1',
    client_id: 'c1',
    slug: 's1',
    destination: 'china',
    tier: 'discovery',
    name: 'Golden China',
    title: null,
    short_description: null,
    duration_text: '10 days',
    display_price_text: 'From NZD $4,999 per person',
    highlights: [],
    itinerary: [],
    inclusions: [],
    exclusions: [],
    tour_cities: [],
    single_supplement: null,
    max_group_size: null,
    is_active: true,
    manages_departures: true,
    sort_order: 1,
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

export function departureRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'd1',
    tour_id: 't1',
    client_id: 'c1',
    depart_on: '2027-03-11',
    return_on: '2027-03-25',
    price_text_override: null,
    status: 'open',
    internal: {},
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

export function publishedRow(
  version: number,
  tours: Record<string, unknown>[],
  departures: Record<string, unknown>[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    client_id: 'c1',
    version,
    snapshot: { schema_version: 1, tours, departures },
    summary: {},
    note: '',
    published_by: 'pm@x',
    source_version: null,
    draft_version: 1,
    created_at: '2026-10-01T00:00:00Z',
    ...extra,
  }
}

export function stateRow(catalogVersion: number, publishedVersion: number): Record<string, unknown> {
  return { client_id: 'c1', catalog_version: catalogVersion, published_version: publishedVersion }
}

export function validReq(
  preview: PublishPreviewResponse,
  overrides: Partial<PublishRequest> = {},
): PublishRequest {
  return {
    draftVersion: preview.draftVersion,
    publishedVersion: preview.publishedVersion,
    diffHash: preview.diffHash,
    acknowledgeHighRisk: true,
    acknowledgeAfterRevert: true,
    confirmSellableCount: preview.sellable.after,
    note: 'n',
    ...overrides,
  }
}

export function validRevertReq(
  preview: { publishedVersion: number; diffHash: string; sellable: { after: number } },
  version: number,
  overrides: Partial<RevertRequest> = {},
): RevertRequest {
  return {
    version,
    publishedVersion: preview.publishedVersion,
    diffHash: preview.diffHash,
    acknowledgeHighRisk: true,
    confirmSellableCount: preview.sellable.after,
    ...overrides,
  }
}
