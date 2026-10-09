import { describe, it, expect, vi } from 'vitest'
import {
  addAlias,
  applyBatch,
  createPreviewBatch,
  getBatch,
  listRecentBatches,
  loadCatalog,
  mapAliasRow,
  mapDepartureRow,
  mapTourRow,
  planToApplyPayload,
  rollbackBatch,
} from '../store'
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
  q.insert = vi.fn(chain)
  q.update = vi.fn(chain)
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
// loadCatalog
// ---------------------------------------------------------------------------

describe('loadCatalog', () => {
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

    const snapshot = await loadCatalog(db as never, 'c1')
    expect(snapshot.tours.map((t) => t.id)).toEqual(['t1', 't2'])
    expect(snapshot.departures.map((d) => d.id)).toEqual(['d1'])
    expect(snapshot.aliases).toEqual([{ aliasNorm: 'a', tourId: 't1' }])

    expect(toursQuery.order).toHaveBeenCalledWith('sort_order', { ascending: true })
    expect(toursQuery.order).toHaveBeenCalledWith('name', { ascending: true })
    expect(departuresQuery.order).toHaveBeenCalledWith('depart_on', { ascending: true })
  })

  it('throws with the Supabase error message', async () => {
    const toursQuery = makeQuery({ data: null, error: { message: 'boom' } })
    const db = makeDb({ from: () => toursQuery })
    await expect(loadCatalog(db as never, 'c1')).rejects.toThrow('boom')
  })
})

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

describe('getBatch', () => {
  it('returns null when not found', async () => {
    const q = makeQuery({ data: null, error: null })
    const db = makeDb({ from: () => q })
    expect(await getBatch(db as never, 'c1', 'b1')).toBeNull()
  })

  it('maps a found batch', async () => {
    const q = makeQuery({
      data: {
        id: 'b1',
        client_id: 'c1',
        kind: 'departures',
        status: 'previewed',
        file_sha256: 'abc',
        row_counts: { adds: 1 },
        plan: { adds: [] },
        created_at: '2026-01-01T00:00:00.000Z',
      },
      error: null,
    })
    const db = makeDb({ from: () => q })
    const batch = await getBatch(db as never, 'c1', 'b1')
    expect(batch).toEqual({
      id: 'b1',
      clientId: 'c1',
      kind: 'departures',
      status: 'previewed',
      fileSha256: 'abc',
      rowCounts: { adds: 1 },
      plan: { adds: [] },
      createdAt: '2026-01-01T00:00:00.000Z',
    })
  })
})

describe('listRecentBatches', () => {
  it('orders newest first and applies the limit', async () => {
    const q = makeQuery({ data: [], error: null })
    const db = makeDb({ from: () => q })
    await listRecentBatches(db as never, 'c1', 5)
    expect(q.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(q.limit).toHaveBeenCalledWith(5)
  })
})

describe('createPreviewBatch', () => {
  const payload: ApplyPayload = { adds: [], updates: [] }

  it('inserts a previewed batch and returns the id', async () => {
    const q = makeQuery({ data: { id: 'b1' }, error: null })
    const db = makeDb({ from: () => q })
    const result = await createPreviewBatch(db as never, {
      clientId: 'c1',
      kind: 'departures',
      fileSha256: 'abc',
      payload,
      summary: { adds: 0 },
    })
    expect(result).toEqual({ ok: true, batchId: 'b1' })
    expect(q.insert).toHaveBeenCalledWith({
      client_id: 'c1',
      kind: 'departures',
      file_sha256: 'abc',
      row_counts: { adds: 0 },
      plan: { adds: [], updates: [], summary: { adds: 0 } },
      status: 'previewed',
    })
  })

  it('returns duplicate_file on unique violation', async () => {
    const insertQuery = makeQuery({
      data: null,
      error: { message: 'duplicate key', code: '23505' },
    })
    const lookupQuery = makeQuery({ data: { id: 'existing', status: 'applied' }, error: null })
    let call = 0
    const db = makeDb({
      from: () => {
        call += 1
        return call === 1 ? insertQuery : lookupQuery
      },
    })
    const result = await createPreviewBatch(db as never, {
      clientId: 'c1',
      kind: 'departures',
      fileSha256: 'abc',
      payload,
      summary: {},
    })
    expect(result).toEqual({
      ok: false,
      reason: 'duplicate_file',
      existingBatchId: 'existing',
    })
  })

  it('refreshes the plan when the same file is previewed again before being applied', async () => {
    const insertQuery = makeQuery({
      data: null,
      error: { message: 'duplicate key', code: '23505' },
    })
    const lookupQuery = makeQuery({ data: { id: 'existing', status: 'previewed' }, error: null })
    const updateQuery = makeQuery({ data: { id: 'existing' }, error: null })
    const queries = [insertQuery, lookupQuery, updateQuery]
    let call = 0
    const db = makeDb({ from: () => queries[call++] })
    const result = await createPreviewBatch(db as never, {
      clientId: 'c1',
      kind: 'departures',
      fileSha256: 'abc',
      payload,
      summary: { adds: 3 },
    })
    expect(result).toEqual({ ok: true, batchId: 'existing' })
    expect(updateQuery.update).toHaveBeenCalledWith({
      row_counts: { adds: 3 },
      plan: { adds: [], updates: [], summary: { adds: 3 } },
    })
    expect(updateQuery.eq).toHaveBeenCalledWith('status', 'previewed')
  })

  it('returns db_error for other failures', async () => {
    const q = makeQuery({ data: null, error: { message: 'nope' } })
    const db = makeDb({ from: () => q })
    const result = await createPreviewBatch(db as never, {
      clientId: 'c1',
      kind: 'departures',
      fileSha256: 'abc',
      payload,
      summary: {},
    })
    expect(result).toEqual({ ok: false, reason: 'db_error', message: 'nope' })
  })
})

// ---------------------------------------------------------------------------
// applyBatch / rollbackBatch
// ---------------------------------------------------------------------------

describe('applyBatch', () => {
  it('returns the rpc result on success', async () => {
    const db = makeDb({
      rpc: () => ({ data: { added: 1, updated: 0 }, error: null }),
    })
    const result = await applyBatch(db as never, 'c1', 'b1', 'me')
    expect(result).toEqual({ ok: true, result: { added: 1, updated: 0 } })
    expect(db.rpc).toHaveBeenCalledWith('tour_catalog_apply_batch', {
      p_client_id: 'c1',
      p_batch_id: 'b1',
      p_applied_by: 'me',
    })
  })

  it('maps batch_not_applicable to not_applicable', async () => {
    const db = makeDb({
      rpc: () => ({ data: null, error: { message: 'batch_not_applicable' } }),
    })
    const result = await applyBatch(db as never, 'c1', 'b1', 'me')
    expect(result).toEqual({
      ok: false,
      code: 'not_applicable',
      message: 'batch_not_applicable',
    })
  })

  it('maps conflict:stale:abc to conflict', async () => {
    const db = makeDb({
      rpc: () => ({ data: null, error: { message: 'conflict:stale:abc' } }),
    })
    const result = await applyBatch(db as never, 'c1', 'b1', 'me')
    expect(result).toEqual({
      ok: false,
      code: 'conflict',
      message: 'conflict:stale:abc',
    })
  })

  it('maps unknown errors to error', async () => {
    const db = makeDb({
      rpc: () => ({ data: null, error: { message: 'boom' } }),
    })
    const result = await applyBatch(db as never, 'c1', 'b1', 'me')
    expect(result).toEqual({ ok: false, code: 'error', message: 'boom' })
  })
})

describe('rollbackBatch', () => {
  it('calls the rollback rpc and returns the result', async () => {
    const db = makeDb({
      rpc: () => ({ data: { added: 0, updated: 1 }, error: null }),
    })
    const result = await rollbackBatch(db as never, 'c1', 'b1')
    expect(result).toEqual({ ok: true, result: { added: 0, updated: 1 } })
    expect(db.rpc).toHaveBeenCalledWith('tour_catalog_rollback_batch', {
      p_client_id: 'c1',
      p_batch_id: 'b1',
    })
  })

  it('maps batch_not_rollbackable to not_applicable', async () => {
    const db = makeDb({
      rpc: () => ({ data: null, error: { message: 'batch_not_rollbackable' } }),
    })
    const result = await rollbackBatch(db as never, 'c1', 'b1')
    expect(result).toEqual({
      ok: false,
      code: 'not_applicable',
      message: 'batch_not_rollbackable',
    })
  })
})

// ---------------------------------------------------------------------------
// addAlias
// ---------------------------------------------------------------------------

describe('addAlias', () => {
  it('refuses an empty normalized alias', async () => {
    const db = makeDb({})
    const result = await addAlias(db as never, 'c1', '   ', 't1')
    expect(result).toEqual({ ok: false, message: 'empty_alias' })
    expect(db.from).not.toHaveBeenCalled()
  })

  it('returns tour_not_found when the tour is not in the client', async () => {
    const tourQuery = makeQuery({ data: null, error: null })
    const db = makeDb({ from: () => tourQuery })
    const result = await addAlias(db as never, 'c1', 'Grand Tour', 't1')
    expect(result).toEqual({ ok: false, message: 'tour_not_found' })
  })

  it('returns alias_taken when the alias points to a different tour', async () => {
    const tourQuery = makeQuery({ data: { id: 't1' }, error: null })
    const aliasQuery = makeQuery({ data: { tour_id: 't2' }, error: null })
    let call = 0
    const db = makeDb({
      from: () => {
        call += 1
        return call === 1 ? tourQuery : aliasQuery
      },
    })
    const result = await addAlias(db as never, 'c1', 'Grand Tour', 't1')
    expect(result).toEqual({ ok: false, message: 'alias_taken' })
  })

  it('is a no-op when the alias already points to the same tour', async () => {
    const tourQuery = makeQuery({ data: { id: 't1' }, error: null })
    const aliasQuery = makeQuery({ data: { tour_id: 't1' }, error: null })
    let call = 0
    const db = makeDb({
      from: () => {
        call += 1
        return call === 1 ? tourQuery : aliasQuery
      },
    })
    const result = await addAlias(db as never, 'c1', 'Grand Tour', 't1')
    expect(result).toEqual({ ok: true, aliasNorm: 'grand tour' })
    expect(aliasQuery.insert).not.toHaveBeenCalled()
  })

  it('inserts a new alias and returns the normalized form', async () => {
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
    const result = await addAlias(db as never, 'c1', 'Grand & Tour', 't1')
    expect(result).toEqual({ ok: true, aliasNorm: 'grand and tour' })
    expect(insertQuery.insert).toHaveBeenCalledWith({
      client_id: 'c1',
      alias_norm: 'grand and tour',
      tour_id: 't1',
    })
  })
})
