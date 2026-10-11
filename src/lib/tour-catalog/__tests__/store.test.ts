import { describe, it, expect, vi } from 'vitest'
import {
  addAlias,
  applyBatch,
  createPreviewBatch,
  getBatch,
  getDraftRevision,
  getPublishedVersion,
  listRecentBatches,
  loadDraftCatalog,
  mapAliasRow,
  mapDepartureRow,
  mapTourRow,
  planHash,
  planToApplyPayload,
  removeAlias,
  rollbackBatch,
} from '../store'
import {
  getDepartureLabel,
  listChanges,
  mapEditError,
  saveDeparture,
  updateTour,
} from '../store-edit'
import type { ApplyPayload } from '../store'
import type { ImportPlan } from '../plan'
import type { CatalogDeparture } from '../types'

// ---------------------------------------------------------------------------
// Fake Supabase client helpers
// ---------------------------------------------------------------------------

interface QueryResult {
  data: unknown
  error: { message: string; code?: string } | null
}

/**
 * Build a chainable query stub. Every builder method returns the same object;
 * the object is thenable so `await` resolves to the configured result.
 */
function makeQuery(result: QueryResult) {
  const q: Record<string, unknown> = {}
  const chain = () => q
  q.select = vi.fn(chain)
  q.eq = vi.fn(chain)
  q.order = vi.fn(chain)
  q.limit = vi.fn(chain)
  q.range = vi.fn(chain)
  q.insert = vi.fn(chain)
  q.update = vi.fn(chain)
  q.delete = vi.fn(chain)
  q.in = vi.fn(chain)
  q.maybeSingle = vi.fn(() => Promise.resolve(result))
  q.then = (onFulfilled: (value: QueryResult) => unknown) =>
    Promise.resolve(result).then(onFulfilled)
  return q
}

function makeDb(handlers: {
  from?: (table: string) => unknown
  rpc?: (fn: string, args: Record<string, unknown>) => unknown
}) {
  return {
    from: vi.fn((table: string) => handlers.from?.(table)),
    rpc: vi.fn((fn: string, args: Record<string, unknown>) => handlers.rpc?.(fn, args)),
  }
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

describe('mapTourRow', () => {
  it('defaults missing jsonb arrays to []', () => {
    const tour = mapTourRow({
      id: 't1',
      client_id: 'c1',
      slug: 's',
      destination: 'd',
      tier: 'x',
      name: 'n',
      highlights: null,
      itinerary: null,
      inclusions: null,
      exclusions: null,
      tour_cities: null,
      is_active: true,
      manages_departures: false,
      sort_order: 3,
      updated_at: '2026-01-01T00:00:00.000Z',
    })
    expect(tour.highlights).toEqual([])
    expect(tour.itinerary).toEqual([])
    expect(tour.inclusions).toEqual([])
    expect(tour.exclusions).toEqual([])
    expect(tour.tourCities).toEqual([])
    expect(tour.title).toBeNull()
    expect(tour.maxGroupSize).toBeNull()
    expect(tour.sortOrder).toBe(3)
    expect(tour.isActive).toBe(true)
    expect(tour.managesDepartures).toBe(false)
  })

  it('maps populated jsonb arrays and itinerary days', () => {
    const tour = mapTourRow({
      id: 't1',
      client_id: 'c1',
      slug: 's',
      destination: 'd',
      tier: 'x',
      name: 'n',
      highlights: ['a', 'b'],
      itinerary: [{ day: 1, title: 'Day 1', description: 'desc', meals: ['breakfast'] }],
      inclusions: ['i'],
      exclusions: ['e'],
      tour_cities: ['Auckland'],
      max_group_size: 12,
      updated_at: '2026-01-01T00:00:00.000Z',
    })
    expect(tour.highlights).toEqual(['a', 'b'])
    expect(tour.itinerary).toEqual([
      { day: 1, title: 'Day 1', description: 'desc', meals: ['breakfast'] },
    ])
    expect(tour.tourCities).toEqual(['Auckland'])
    expect(tour.maxGroupSize).toBe(12)
  })
})

describe('mapDepartureRow', () => {
  it('preserves updated_at byte-for-byte and defaults internal to {}', () => {
    const raw = '2026-01-01T00:00:00.123456+00:00'
    const dep = mapDepartureRow({
      id: 'd1',
      tour_id: 't1',
      client_id: 'c1',
      depart_on: '2026-03-01',
      return_on: null,
      price_text_override: null,
      status: 'limited',
      internal: null,
      updated_at: raw,
    })
    expect(dep.updatedAt).toBe(raw)
    expect(dep.internal).toEqual({})
    expect(dep.departOn).toBe('2026-03-01')
    expect(dep.returnOn).toBeNull()
    expect(dep.status).toBe('limited')
  })

  it('maps internal fields and falls back to open for unknown status', () => {
    const dep = mapDepartureRow({
      id: 'd1',
      tour_id: 't1',
      client_id: 'c1',
      depart_on: '2026-03-01',
      return_on: '2026-03-10',
      status: 'nonsense',
      internal: { airline: 'NZ', capacity: 20, outboundRoute: 'AKL-SIN' },
      updated_at: 'x',
    })
    expect(dep.status).toBe('open')
    expect(dep.internal).toEqual({
      airline: 'NZ',
      capacity: 20,
      outboundRoute: 'AKL-SIN',
    })
  })
})

describe('mapAliasRow', () => {
  it('maps alias_norm and tour_id', () => {
    expect(mapAliasRow({ alias_norm: 'grand tour', tour_id: 't1' })).toEqual({
      aliasNorm: 'grand tour',
      tourId: 't1',
    })
  })
})

// ---------------------------------------------------------------------------
// planToApplyPayload
// ---------------------------------------------------------------------------

describe('planToApplyPayload', () => {
  it('uses before.updatedAt as expectedUpdatedAt and after for new values', () => {
    const before: CatalogDeparture = {
      id: 'd1',
      tourId: 't1',
      clientId: 'c1',
      departOn: '2026-03-01',
      returnOn: null,
      priceTextOverride: null,
      status: 'open',
      internal: {},
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const plan: ImportPlan = {
      adds: [
        {
          line: 1,
          tourId: 't1',
          departOn: '2026-04-01',
          returnOn: '2026-04-10',
          status: 'open',
          internal: { airline: 'NZ' },
        },
      ],
      updates: [
        {
          line: 2,
          departureId: 'd1',
          tourId: 't1',
          departOn: '2026-03-01',
          before,
          after: { returnOn: '2026-03-12', status: 'limited', internal: { capacity: 5 } },
        },
      ],
      unchangedCount: 0,
      rejected: [],
      warnings: [],
    }

    const payload = planToApplyPayload(plan)
    expect(payload.adds).toEqual([
      {
        tourId: 't1',
        departOn: '2026-04-01',
        returnOn: '2026-04-10',
        status: 'open',
        internal: { airline: 'NZ' },
      },
    ])
    expect(payload.updates).toEqual([
      {
        departureId: 'd1',
        expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
        returnOn: '2026-03-12',
        status: 'limited',
        internal: { capacity: 5 },
      },
    ])
  })
})

// ---------------------------------------------------------------------------
// planHash
// ---------------------------------------------------------------------------

describe('planHash', () => {
  const payload: ApplyPayload = {
    adds: [
      {
        tourId: 't1',
        departOn: '2026-04-01',
        returnOn: '2026-04-10',
        status: 'open',
        internal: { airline: 'NZ', capacity: 20 },
      },
    ],
    updates: [
      {
        departureId: 'd1',
        expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
        returnOn: '2026-03-12',
        status: 'limited',
        internal: { capacity: 5 },
      },
    ],
  }

  it('is deterministic for identical inputs', () => {
    expect(planHash(payload, 2)).toBe(planHash(payload, 2))
    expect(planHash(payload, 2)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is independent of object key order', () => {
    const reordered: ApplyPayload = {
      adds: [
        {
          internal: { capacity: 20, airline: 'NZ' },
          status: 'open',
          returnOn: '2026-04-10',
          departOn: '2026-04-01',
          tourId: 't1',
        },
      ],
      updates: [
        {
          internal: { capacity: 5 },
          status: 'limited',
          returnOn: '2026-03-12',
          expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
          departureId: 'd1',
        },
      ],
    }
    expect(planHash(reordered, 2)).toBe(planHash(payload, 2))
  })

  it('changes when adds, updates or warningCount change', () => {
    const base = planHash(payload, 2)
    expect(planHash({ ...payload, adds: [] }, 2)).not.toBe(base)
    expect(planHash({ ...payload, updates: [] }, 2)).not.toBe(base)
    expect(planHash(payload, 3)).not.toBe(base)
  })
})

// ---------------------------------------------------------------------------
// loadDraftCatalog
// ---------------------------------------------------------------------------

describe('loadDraftCatalog', () => {
  it('orders tours by sort_order then name and departures by depart_on', async () => {
    const toursQuery = makeQuery({
      data: [
        { id: 't1', client_id: 'c1', name: 'A', sort_order: 1, updated_at: 'u1' },
        { id: 't2', client_id: 'c1', name: 'B', sort_order: 2, updated_at: 'u2' },
      ],
      error: null,
    })
    const departuresQuery = makeQuery({
      data: [
        {
          id: 'd1',
          tour_id: 't1',
          client_id: 'c1',
          depart_on: '2026-03-01',
          status: 'open',
          updated_at: 'u3',
        },
      ],
      error: null,
    })
    const aliasesQuery = makeQuery({
      data: [{ alias_norm: 'a', tour_id: 't1' }],
      error: null,
    })

    const db = makeDb({
      from: (table) => {
        if (table === 'tour_catalog_tours') return toursQuery
        if (table === 'tour_catalog_departures') return departuresQuery
        return aliasesQuery
      },
    })

    const snapshot = await loadDraftCatalog(db as never, 'c1')
    expect(snapshot.tours.map((t) => t.id)).toEqual(['t1', 't2'])
    expect(snapshot.departures.map((d) => d.id)).toEqual(['d1'])
    expect(snapshot.aliases).toEqual([{ aliasNorm: 'a', tourId: 't1' }])

    expect(toursQuery.order).toHaveBeenCalledWith('sort_order', { ascending: true })
    expect(toursQuery.order).toHaveBeenCalledWith('name', { ascending: true })
    expect(departuresQuery.order).toHaveBeenCalledWith('depart_on', { ascending: true })
  })

  it('reads every row past the 1000-row PostgREST cap, in stable order, dropping none', async () => {
    // Fake that behaves like PostgREST: a response never carries more than 1000 rows.
    const MAX_ROWS = 1000
    function pagedTable(rows: Record<string, unknown>[]) {
      const q: Record<string, unknown> = {}
      const orders: string[] = []
      let window: [number, number] | null = null
      const chain = () => q
      q.select = vi.fn(chain)
      q.eq = vi.fn(chain)
      q.order = vi.fn((col: string) => {
        orders.push(col)
        return q
      })
      q.range = vi.fn((from: number, to: number) => {
        window = [from, to]
        return q
      })
      q.then = (onFulfilled: (value: QueryResult) => unknown) => {
        const [from, to] = window ?? [0, MAX_ROWS - 1]
        const end = Math.min(to + 1, from + MAX_ROWS)
        return Promise.resolve({ data: rows.slice(from, end), error: null }).then(onFulfilled)
      }
      return { q, orders }
    }

    const tours = pagedTable(
      Array.from({ length: 2345 }, (_, i) => ({ id: `t${i}`, client_id: 'c1', name: `T${i}` })),
    )
    const departures = pagedTable(
      Array.from({ length: 2000 }, (_, i) => ({
        id: `d${i}`,
        tour_id: 't0',
        client_id: 'c1',
        depart_on: '2026-03-01',
        status: 'open',
        updated_at: 'u',
      })),
    )
    const aliases = pagedTable(
      Array.from({ length: 1001 }, (_, i) => ({ alias_norm: `a${i}`, tour_id: 't0' })),
    )
    const db = makeDb({
      from: (table) => {
        if (table === 'tour_catalog_tours') return tours.q
        if (table === 'tour_catalog_departures') return departures.q
        return aliases.q
      },
    })

    const snapshot = await loadDraftCatalog(db as never, 'c1')
    expect(snapshot.tours).toHaveLength(2345)
    expect(snapshot.departures).toHaveLength(2000)
    expect(snapshot.aliases).toHaveLength(1001)
    expect(new Set(snapshot.tours.map((t) => t.id)).size).toBe(2345)
    expect(new Set(snapshot.departures.map((d) => d.id)).size).toBe(2000)
    expect(snapshot.aliases[1000]).toEqual({ aliasNorm: 'a1000', tourId: 't0' })
    // Page boundaries are only stable with a unique tie-breaker as the last sort key.
    expect(tours.orders).toEqual(['sort_order', 'name', 'id', 'sort_order', 'name', 'id', 'sort_order', 'name', 'id'])
    expect(departures.orders.at(-1)).toBe('id')
    expect(aliases.orders.at(-1)).toBe('alias_norm')
  })

  it('throws with the Supabase error message', async () => {
    const toursQuery = makeQuery({ data: null, error: { message: 'boom' } })
    const db = makeDb({ from: () => toursQuery })
    await expect(loadDraftCatalog(db as never, 'c1')).rejects.toThrow('boom')
  })
})

// ---------------------------------------------------------------------------
// getDraftRevision / getPublishedVersion
// ---------------------------------------------------------------------------

describe('getDraftRevision / getPublishedVersion', () => {
  it('reads catalog_version as the draft revision and published_version as the outward version', async () => {
    const q = makeQuery({ data: { catalog_version: 7, published_version: 3 }, error: null })
    const db = makeDb({ from: () => q })
    expect(await getDraftRevision(db as never, 'c1')).toBe(7)
    expect(q.select).toHaveBeenLastCalledWith('catalog_version')
    expect(await getPublishedVersion(db as never, 'c1')).toBe(3)
    expect(q.select).toHaveBeenLastCalledWith('published_version')
    expect(db.from).toHaveBeenCalledWith('tour_catalog_state')
  })

  it('returns 0 for both when no state row exists', async () => {
    const q = makeQuery({ data: null, error: null })
    const db = makeDb({ from: () => q })
    expect(await getDraftRevision(db as never, 'c1')).toBe(0)
    expect(await getPublishedVersion(db as never, 'c1')).toBe(0)
  })

  it('throws with the Supabase error message', async () => {
    const q = makeQuery({ data: null, error: { message: 'state boom' } })
    const db = makeDb({ from: () => q })
    await expect(getDraftRevision(db as never, 'c1')).rejects.toThrow('state boom')
    await expect(getPublishedVersion(db as never, 'c1')).rejects.toThrow('state boom')
  })
})

// ---------------------------------------------------------------------------
// createPreviewBatch
// ---------------------------------------------------------------------------

const batchArgs = {
  clientId: 'c1',
  kind: 'departures' as const,
  fileSha256: 'sha',
  payload: { adds: [], updates: [] } as ApplyPayload,
  summary: { added: 0 },
}

describe('createPreviewBatch', () => {
  it('inserts a new previewed batch when there is no conflict', async () => {
    const insertQuery = makeQuery({ data: { id: 'b1' }, error: null })
    const db = makeDb({ from: () => insertQuery })
    const result = await createPreviewBatch(db as never, batchArgs)
    expect(result).toEqual({ ok: true, batchId: 'b1' })
  })

  it('refreshes an existing previewed batch on unique violation', async () => {
    const insertQuery = makeQuery({
      data: null,
      error: { message: 'duplicate key', code: '23505' },
    })
    const lookupQuery = makeQuery({
      data: { id: 'b1', status: 'previewed' },
      error: null,
    })
    const refreshQuery = makeQuery({ data: { id: 'b1' }, error: null })
    let call = 0
    const db = makeDb({
      from: () => {
        call += 1
        if (call === 1) return insertQuery
        if (call === 2) return lookupQuery
        return refreshQuery
      },
    })

    const result = await createPreviewBatch(db as never, batchArgs)
    expect(result).toEqual({ ok: true, batchId: 'b1' })
    expect(lookupQuery.in).toHaveBeenCalledWith('status', ['previewed', 'applied'])
    expect(refreshQuery.eq).toHaveBeenCalledWith('status', 'previewed')
    expect(refreshQuery.update).toHaveBeenCalledWith({
      row_counts: batchArgs.summary,
      plan: { ...batchArgs.payload, summary: batchArgs.summary },
    })
  })

  it('returns duplicate_file when the existing live batch is applied', async () => {
    const insertQuery = makeQuery({
      data: null,
      error: { message: 'duplicate key', code: '23505' },
    })
    const lookupQuery = makeQuery({
      data: { id: 'b9', status: 'applied' },
      error: null,
    })
    let call = 0
    const db = makeDb({
      from: () => {
        call += 1
        if (call === 1) return insertQuery
        return lookupQuery
      },
    })

    const result = await createPreviewBatch(db as never, batchArgs)
    expect(result).toEqual({ ok: false, reason: 'duplicate_file', existingBatchId: 'b9' })
  })

  it('returns db_error when the insert fails for another reason', async () => {
    const insertQuery = makeQuery({ data: null, error: { message: 'boom' } })
    const db = makeDb({ from: () => insertQuery })
    const result = await createPreviewBatch(db as never, batchArgs)
    expect(result).toEqual({ ok: false, reason: 'db_error', message: 'boom' })
  })
})

// ---------------------------------------------------------------------------
// addAlias / removeAlias
// ---------------------------------------------------------------------------

describe('addAlias', () => {
  it('rejects an empty alias', async () => {
    const db = makeDb({})
    const result = await addAlias(db as never, 'c1', '   ', 't1')
    expect(result).toEqual({ ok: false, message: 'empty_alias' })
  })

  it('returns tour_not_found when the tour does not exist', async () => {
    const tourQuery = makeQuery({ data: null, error: null })
    const db = makeDb({ from: () => tourQuery })
    const result = await addAlias(db as never, 'c1', 'grand tour', 't1')
    expect(result).toEqual({ ok: false, message: 'tour_not_found' })
  })

  it('returns alias_taken with existingTourId when the alias points elsewhere', async () => {
    const tourQuery = makeQuery({ data: { id: 't1' }, error: null })
    const aliasQuery = makeQuery({ data: { tour_id: 't2' }, error: null })
    let call = 0
    const db = makeDb({
      from: () => {
        call += 1
        return call === 1 ? tourQuery : aliasQuery
      },
    })
    const result = await addAlias(db as never, 'c1', 'grand tour', 't1')
    expect(result).toEqual({ ok: false, message: 'alias_taken', existingTourId: 't2' })
  })

  it('is idempotent when the alias already points to the same tour', async () => {
    const tourQuery = makeQuery({ data: { id: 't1' }, error: null })
    const aliasQuery = makeQuery({ data: { tour_id: 't1' }, error: null })
    let call = 0
    const db = makeDb({
      from: () => {
        call += 1
        return call === 1 ? tourQuery : aliasQuery
      },
    })
    const result = await addAlias(db as never, 'c1', 'grand tour', 't1')
    expect(result).toEqual({ ok: true, aliasNorm: 'grand tour' })
  })

  it('inserts a new alias when none exists', async () => {
    const tourQuery = makeQuery({ data: { id: 't1' }, error: null })
    const aliasQuery = makeQuery({ data: null, error: null })
    const insertQuery = makeQuery({ data: null, error: null })
    let call = 0
    const db = makeDb({
      from: () => {
        call += 1
        if (call === 1) return tourQuery
        if (call === 2) return aliasQuery
        return insertQuery
      },
    })
    const result = await addAlias(db as never, 'c1', 'grand tour', 't1')
    expect(result).toEqual({ ok: true, aliasNorm: 'grand tour' })
    expect(insertQuery.insert).toHaveBeenCalledWith({
      client_id: 'c1',
      alias_norm: 'grand tour',
      tour_id: 't1',
    })
  })
})

describe('removeAlias', () => {
  it('returns ok when a row was deleted', async () => {
    const deleteQuery = makeQuery({ data: { alias_norm: 'grand tour' }, error: null })
    const db = makeDb({ from: () => deleteQuery })
    const result = await removeAlias(db as never, 'c1', 'grand tour')
    expect(result).toEqual({ ok: true })
    expect(deleteQuery.delete).toHaveBeenCalled()
    expect(deleteQuery.eq).toHaveBeenCalledWith('client_id', 'c1')
    expect(deleteQuery.eq).toHaveBeenCalledWith('alias_norm', 'grand tour')
    expect(deleteQuery.select).toHaveBeenCalledWith('alias_norm')
  })

  it('returns alias_not_found when no row matched', async () => {
    const deleteQuery = makeQuery({ data: null, error: null })
    const db = makeDb({ from: () => deleteQuery })
    const result = await removeAlias(db as never, 'c1', 'grand tour')
    expect(result).toEqual({ ok: false, message: 'alias_not_found' })
  })

  it('returns alias_failed on a database error', async () => {
    const deleteQuery = makeQuery({ data: null, error: { message: 'boom' } })
    const db = makeDb({ from: () => deleteQuery })
    const result = await removeAlias(db as never, 'c1', 'grand tour')
    expect(result).toEqual({ ok: false, message: 'alias_failed' })
  })
})

// ---------------------------------------------------------------------------
// mapEditError
// ---------------------------------------------------------------------------

describe('mapEditError', () => {
  const cases: Array<[string, string]> = [
    ['conflict:stale:t1', 'conflict'],
    ['conflict:duplicate_departure', 'duplicate'],
    ['tour_not_found', 'not_found'],
    ['departure_not_found', 'not_found'],
    ['field_not_editable:slug', 'invalid'],
    ['invalid_null:name', 'invalid'],
    ['depart_on_not_editable', 'invalid'],
    ['depart_on_required', 'invalid'],
    ['invalid_dates', 'invalid'],
    ['something_else', 'error'],
  ]

  it.each(cases)('maps %s to %s', (message, code) => {
    const result = mapEditError(message)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(code)
      expect(result.message).toBe(message)
    }
  })
})

// ---------------------------------------------------------------------------
// updateTour
// ---------------------------------------------------------------------------

describe('updateTour', () => {
  it('calls the RPC with snake_case args and maps the returned row', async () => {
    const rpc = vi.fn(() => ({
      data: {
        id: 't1',
        client_id: 'c1',
        slug: 's',
        destination: 'd',
        tier: 'x',
        name: 'New name',
        highlights: [],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        tour_cities: [],
        is_active: true,
        manages_departures: false,
        sort_order: 1,
        updated_at: '2026-02-01T00:00:00.000Z',
      },
      error: null,
    }))
    const db = makeDb({ rpc })

    const result = await updateTour(db as never, 'c1', 't1', '2026-01-01T00:00:00.000Z', { name: 'New name' }, 'alice')
    expect(rpc).toHaveBeenCalledWith('tour_catalog_update_tour', {
      p_client_id: 'c1',
      p_tour_id: 't1',
      p_expected_updated_at: '2026-01-01T00:00:00.000Z',
      p_patch: { name: 'New name' },
      p_actor: 'alice',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.id).toBe('t1')
      expect(result.value.name).toBe('New name')
    }
  })

  it('maps a stale conflict error', async () => {
    const rpc = vi.fn(() => ({ data: null, error: { message: 'conflict:stale:t1' } }))
    const db = makeDb({ rpc })
    const result = await updateTour(db as never, 'c1', 't1', 'x', {}, 'alice')
    expect(result).toEqual({ ok: false, code: 'conflict', message: 'conflict:stale:t1' })
  })
})

// ---------------------------------------------------------------------------
// saveDeparture
// ---------------------------------------------------------------------------

describe('saveDeparture', () => {
  it('calls the RPC with snake_case args and maps the returned row', async () => {
    const rpc = vi.fn(() => ({
      data: {
        id: 'd1',
        tour_id: 't1',
        client_id: 'c1',
        depart_on: '2026-03-01',
        return_on: '2026-03-10',
        price_text_override: null,
        status: 'open',
        internal: {},
        updated_at: '2026-02-01T00:00:00.000Z',
      },
      error: null,
    }))
    const db = makeDb({ rpc })

    const result = await saveDeparture(
      db as never,
      'c1',
      't1',
      'd1',
      '2026-01-01T00:00:00.000Z',
      { status: 'open' },
      'alice',
    )
    expect(rpc).toHaveBeenCalledWith('tour_catalog_save_departure', {
      p_client_id: 'c1',
      p_tour_id: 't1',
      p_departure_id: 'd1',
      p_expected_updated_at: '2026-01-01T00:00:00.000Z',
      p_fields: { status: 'open' },
      p_actor: 'alice',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.id).toBe('d1')
      expect(result.value.departOn).toBe('2026-03-01')
    }
  })

  it('passes null departureId and expectedUpdatedAt for a new departure', async () => {
    const rpc = vi.fn(() => ({
      data: {
        id: 'd2',
        tour_id: 't1',
        client_id: 'c1',
        depart_on: '2026-05-01',
        return_on: null,
        price_text_override: null,
        status: 'open',
        internal: {},
        updated_at: '2026-02-01T00:00:00.000Z',
      },
      error: null,
    }))
    const db = makeDb({ rpc })

    const result = await saveDeparture(db as never, 'c1', 't1', null, null, { depart_on: '2026-05-01' }, 'alice')
    expect(rpc).toHaveBeenCalledWith('tour_catalog_save_departure', {
      p_client_id: 'c1',
      p_tour_id: 't1',
      p_departure_id: null,
      p_expected_updated_at: null,
      p_fields: { depart_on: '2026-05-01' },
      p_actor: 'alice',
    })
    expect(result.ok).toBe(true)
  })

  it('maps a duplicate departure error', async () => {
    const rpc = vi.fn(() => ({ data: null, error: { message: 'conflict:duplicate_departure' } }))
    const db = makeDb({ rpc })
    const result = await saveDeparture(db as never, 'c1', 't1', null, null, {}, 'alice')
    expect(result).toEqual({ ok: false, code: 'duplicate', message: 'conflict:duplicate_departure' })
  })
})

// ---------------------------------------------------------------------------
// listChanges
// ---------------------------------------------------------------------------

describe('listChanges', () => {
  it('returns [] without querying when entityIds is empty', async () => {
    const from = vi.fn()
    const db = makeDb({ from })
    const result = await listChanges(db as never, 'c1', [])
    expect(result).toEqual([])
    expect(from).not.toHaveBeenCalled()
  })

  it('filters by client and entity ids, orders desc and maps rows', async () => {
    const q = makeQuery({
      data: [
        {
          id: 'l1',
          entity: 'tour',
          entity_id: 't1',
          action: 'update',
          before: { name: 'old' },
          after: { name: 'new' },
          actor: 'edit by alice',
          created_at: '2026-02-01T00:00:00.000Z',
        },
        {
          id: 'l2',
          entity: 'departure',
          entity_id: 'd1',
          action: 'insert',
          before: null,
          after: { status: 'open' },
          actor: 'edit by alice',
          created_at: '2026-02-02T00:00:00.000Z',
        },
      ],
      error: null,
    })
    const db = makeDb({ from: () => q })

    const result = await listChanges(db as never, 'c1', ['t1', 'd1'], 10)
    expect(q.eq).toHaveBeenCalledWith('client_id', 'c1')
    expect(q.in).toHaveBeenCalledWith('entity_id', ['t1', 'd1'])
    expect(q.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(q.limit).toHaveBeenCalledWith(10)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      id: 'l1',
      entity: 'tour',
      entityId: 't1',
      action: 'update',
      before: { name: 'old' },
      after: { name: 'new' },
      actor: 'edit by alice',
      createdAt: '2026-02-01T00:00:00.000Z',
    })
    expect(result[1].before).toBeNull()
    expect(result[1].entity).toBe('departure')
  })

  it('throws with the Supabase error message', async () => {
    const q = makeQuery({ data: null, error: { message: 'log boom' } })
    const db = makeDb({ from: () => q })
    await expect(listChanges(db as never, 'c1', ['t1'])).rejects.toThrow('log boom')
  })
})

// ---------------------------------------------------------------------------
// getDepartureLabel
// ---------------------------------------------------------------------------

describe('getDepartureLabel', () => {
  it('returns the tour name and depart_on', async () => {
    const depQuery = makeQuery({ data: { depart_on: '2026-03-01', tour_id: 't1' }, error: null })
    const tourQuery = makeQuery({ data: { name: 'Grand Tour' }, error: null })
    let call = 0
    const db = makeDb({
      from: () => {
        call += 1
        return call === 1 ? depQuery : tourQuery
      },
    })

    const result = await getDepartureLabel(db as never, 'c1', 'd1')
    expect(result).toEqual({ tourName: 'Grand Tour', departOn: '2026-03-01' })
    expect(depQuery.eq).toHaveBeenCalledWith('id', 'd1')
    expect(depQuery.eq).toHaveBeenCalledWith('client_id', 'c1')
    expect(tourQuery.eq).toHaveBeenCalledWith('id', 't1')
    expect(tourQuery.eq).toHaveBeenCalledWith('client_id', 'c1')
  })

  it('returns null when the departure is missing', async () => {
    const depQuery = makeQuery({ data: null, error: null })
    const db = makeDb({ from: () => depQuery })
    expect(await getDepartureLabel(db as never, 'c1', 'd1')).toBeNull()
  })

  it('returns null when the tour is missing', async () => {
    const depQuery = makeQuery({ data: { depart_on: '2026-03-01', tour_id: 't1' }, error: null })
    const tourQuery = makeQuery({ data: null, error: null })
    let call = 0
    const db = makeDb({
      from: () => {
        call += 1
        return call === 1 ? depQuery : tourQuery
      },
    })
    expect(await getDepartureLabel(db as never, 'c1', 'd1')).toBeNull()
  })

  it('returns null on a database error', async () => {
    const depQuery = makeQuery({ data: null, error: { message: 'boom' } })
    const db = makeDb({ from: () => depQuery })
    expect(await getDepartureLabel(db as never, 'c1', 'd1')).toBeNull()
  })
})
