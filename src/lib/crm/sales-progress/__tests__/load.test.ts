/**
 * Tests for the sales-progress data layer (units.ts + load.ts).
 * Uses a small in-memory fake Supabase client: no network, no real DB.
 * Covers unit building, error propagation, order mapping, the legacy-column
 * retry path, and a static check that neither file ever writes to the DB.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDepartureUnitSource } from '../units'
import { loadSalesProgress } from '../load'
import type { SalesUnit } from '../types'
import type { SalesUnitSource } from '../units'

interface FakeCall {
  table: string
  method: string
}

interface FakeDb {
  calls: FakeCall[]
  from(table: string): FakeQuery
}

interface FakeQuery {
  select(columns: string): FakeQuery
  eq(column: string, value: unknown): FakeQuery
  order(column: string, options?: unknown): FakeQuery
  range(from: number, to: number): FakeQuery
  in(column: string, values: unknown[]): FakeQuery
  then(resolve: (value: { data: unknown[] | null; error: { message: string } | null }) => unknown): Promise<unknown>
}

function createFakeDb(
  rowsByTable: Record<string, unknown[]>,
  errorsByTable: Record<string, string> = {},
  /** when set for a table, the error is only returned if the selected columns contain this text */
  errorOnlyWhenSelecting: Record<string, string> = {},
): FakeDb {
  const calls: FakeCall[] = []
  const db: FakeDb = {
    calls,
    from(table: string) {
      calls.push({ table, method: 'from' })
      let selected = ''
      const query: FakeQuery = {
        select(columns: string) {
          selected = columns
          calls.push({ table, method: `select:${columns}` })
          return query
        },
        eq(column: string) {
          calls.push({ table, method: `eq:${column}` })
          return query
        },
        order(column: string) {
          calls.push({ table, method: `order:${column}` })
          return query
        },
        range(from: number, to: number) {
          calls.push({ table, method: `range:${from}-${to}` })
          return query
        },
        in(column: string) {
          calls.push({ table, method: `in:${column}` })
          return query
        },
        then(resolve) {
          const error = errorsByTable[table]
          const only = errorOnlyWhenSelecting[table]
          if (error !== undefined && (only === undefined || selected.includes(only))) {
            return Promise.resolve(resolve({ data: null, error: { message: error } }))
          }
          const rows = rowsByTable[table] ?? []
          return Promise.resolve(resolve({ data: rows, error: null }))
        },
      }
      return query
    },
  }
  return db
}

const DEPARTURE_ROW = {
  id: 'dep-1',
  tour_id: 'tour-1',
  depart_on: '2029-03-11',
  status: 'open',
  internal: { capacity: 20, airline: 'CA' },
}

const TOUR_ROW = { id: 'tour-1', name: 'X', max_group_size: 18 }

describe('createDepartureUnitSource', () => {
  it('builds units with label, capacity and note, hiding internal keys', async () => {
    const db = createFakeDb({
      tour_catalog_departures: [DEPARTURE_ROW],
      tour_catalog_tours: [TOUR_ROW],
    })
    const source = createDepartureUnitSource(db as never)
    const units = await source.listSalesUnits('client-1')

    expect(units).toHaveLength(1)
    expect(units[0].label).toBe('X · 2029-03-11')
    expect(units[0].capacity).toBe(18)
    expect(units[0].capacityNote).toBe('内部 20 / 官方 18，按 18 算')
    expect(JSON.stringify(units)).not.toContain('airline')
  })

  it('throws on a query error instead of returning an empty list', async () => {
    const db = createFakeDb(
      { tour_catalog_departures: [], tour_catalog_tours: [] },
      { tour_catalog_departures: 'boom' },
    )
    const source = createDepartureUnitSource(db as never)
    await expect(source.listSalesUnits('client-1')).rejects.toThrow('boom')
  })
})

const BOOKING_ROW = {
  id: 'b-1',
  tour_id: 'tour-1',
  departure_id: 'dep-1',
  departure_depart_on: '2029-03-11',
  booked_on: '2029-01-01',
  party_size: 2,
  status: 'active',
  origin_kind: 'company_confirmed',
  evidence_ref: 'INV-1',
}

function fakeSource(units: SalesUnit[]): SalesUnitSource {
  return {
    async listSalesUnits() {
      return units
    },
  }
}

const UNIT: SalesUnit = {
  unitId: 'dep-1',
  groupId: 'tour-1',
  label: 'X · 2029-03-11',
  date: '2029-03-11',
  capacity: 18,
  capacityNote: null,
  unitStatus: 'open',
}

describe('loadSalesProgress', () => {
  it('maps orders and returns computed rows', async () => {
    const db = createFakeDb({ crm_bookings: [BOOKING_ROW] })
    const data = await loadSalesProgress(db as never, 'client-1', fakeSource([UNIT]))

    expect(data.originColumnsMissing).toBe(false)
    expect(data.result.rows).toHaveLength(1)
    expect(data.result.rows[0].companyConfirmed).toBe(2)
    expect(data.result.activeOrders).toBe(1)
    expect(typeof data.generatedAt).toBe('string')
  })

  it('retries without origin columns and marks all orders unverified', async () => {
    const db = createFakeDb(
      { crm_bookings: [{ ...BOOKING_ROW, origin_kind: null, evidence_ref: null }] },
      { crm_bookings: 'column "origin_kind" does not exist' },
      { crm_bookings: 'origin_kind' },
    )
    const data = await loadSalesProgress(db as never, 'client-1', fakeSource([UNIT]))

    expect(data.originColumnsMissing).toBe(true)
    expect(data.result.rows[0].unverified).toBe(2)
    expect(data.result.rows[0].companyConfirmed).toBe(0)
  })

  it('hides past departures that have no orders, keeps past ones that do, and keeps upcoming and undated ones', async () => {
    const mk = (unitId: string, date: string | null): SalesUnit => ({ ...UNIT, unitId, label: unitId, date })
    const db = createFakeDb({ crm_bookings: [{ ...BOOKING_ROW, departure_id: 'past-with-order' }] })
    const data = await loadSalesProgress(
      db as never,
      'client-1',
      fakeSource([mk('past-empty', '2026-01-01'), mk('past-with-order', '2026-01-02'), mk('upcoming', '2026-12-01'), mk('undated', null)]),
      () => new Date('2026-10-13T02:00:00Z'),
    )
    expect(data.result.rows.map((r) => r.unit.unitId)).toEqual(['past-with-order', 'upcoming', 'undated'])
  })

  it('matches the real PostgREST shape for a missing column (table-qualified name)', async () => {
    const db = createFakeDb(
      { crm_bookings: [{ ...BOOKING_ROW, origin_kind: null, evidence_ref: null }] },
      { crm_bookings: 'column crm_bookings.origin_kind does not exist' },
      { crm_bookings: 'origin_kind' },
    )
    const data = await loadSalesProgress(db as never, 'client-1', fakeSource([UNIT]))
    expect(data.originColumnsMissing).toBe(true)
  })

  it('🔴 an error that merely mentions the column (not "does not exist") is NOT swallowed', async () => {
    const db = createFakeDb(
      { crm_bookings: [] },
      { crm_bookings: 'permission denied for column origin_kind' },
      { crm_bookings: 'origin_kind' },
    )
    await expect(
      loadSalesProgress(db as never, 'client-1', fakeSource([UNIT])),
    ).rejects.toThrow('permission denied for column origin_kind')
  })

  it('head-counts that are not positive whole numbers are treated as not filled in (never shrink the total)', async () => {
    const rows = [0, -3, 2.5].map((n, i) => ({ ...BOOKING_ROW, id: `b-${i}`, party_size: n }))
    const db = createFakeDb({ crm_bookings: rows })
    const data = await loadSalesProgress(db as never, 'client-1', fakeSource([UNIT]))
    expect(data.result.rows[0].total).toBe(0)
    expect(data.result.rows[0].unfilledOrders).toBe(3)
    expect(data.result.rows[0].remaining).toBe(18)
  })

  it('a string head-count is an unmappable row (throws, never silently dropped)', async () => {
    const db = createFakeDb({ crm_bookings: [{ ...BOOKING_ROW, party_size: '2' }] })
    await expect(
      loadSalesProgress(db as never, 'client-1', fakeSource([UNIT])),
    ).rejects.toThrow('unmappable booking row')
  })

  it('🔴 every query is limited to the client (eq client_id on orders, departures and tours)', async () => {
    const db = createFakeDb({
      crm_bookings: [BOOKING_ROW],
      tour_catalog_departures: [DEPARTURE_ROW],
      tour_catalog_tours: [TOUR_ROW],
    })
    await loadSalesProgress(db as never, 'client-1', createDepartureUnitSource(db as never))
    for (const table of ['crm_bookings', 'tour_catalog_departures', 'tour_catalog_tours']) {
      const mine = db.calls.filter((c) => c.table === table)
      expect(mine.some((c) => c.method === 'eq:client_id'), table).toBe(true)
    }
  })

  it('an unreadable departure row fails the load instead of being dropped', async () => {
    const db = createFakeDb({
      tour_catalog_departures: [{ ...DEPARTURE_ROW, depart_on: null }],
      tour_catalog_tours: [TOUR_ROW],
    })
    await expect(createDepartureUnitSource(db as never).listSalesUnits('client-1')).rejects.toThrow('unmappable departure row')
  })

  it('throws on a different error', async () => {
    const db = createFakeDb({ crm_bookings: [] }, { crm_bookings: 'permission denied' })
    await expect(
      loadSalesProgress(db as never, 'client-1', fakeSource([UNIT])),
    ).rejects.toThrow('permission denied')
  })

  it('throws unmappable booking row on a bad status', async () => {
    const db = createFakeDb({ crm_bookings: [{ ...BOOKING_ROW, status: 'weird' }] })
    await expect(
      loadSalesProgress(db as never, 'client-1', fakeSource([UNIT])),
    ).rejects.toThrow('unmappable booking row')
  })
})

describe('no writes in the data layer', () => {
  const forbidden = ['.insert(', '.update(', '.delete(', '.upsert(', '.rpc(']

  it('units.ts and load.ts contain no write calls', () => {
    const dir = join(__dirname, '..')
    for (const file of ['units.ts', 'load.ts']) {
      const source = readFileSync(join(dir, file), 'utf8')
      for (const token of forbidden) {
        expect(source).not.toContain(token)
      }
    }
  })
})
