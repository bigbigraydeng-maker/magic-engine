// Tests for the read-only booking import reader and preview runner.
// Uses a small in-memory fake Supabase client: no network, no real DB.
// Covers contact matching, departure resolution, order lookup, the missing
// evidence_ref retry path, client scoping, the no-writes guarantee, and the
// end-to-end preview output (including that no PII ever leaks into the lines).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readFacts, type Normalisers } from '../reader'
import { runPreview } from '../run-preview'
import type { ImportRow } from '../types'

interface FakeCall {
  table: string
  method: string
}

interface FakeQuery {
  select(columns: string): FakeQuery
  eq(column: string, value: unknown): FakeQuery
  in(column: string, values: unknown[]): FakeQuery
  order(column: string, options?: unknown): FakeQuery
  range(from: number, to: number): FakeQuery
  then(
    resolve: (value: { data: unknown[] | null; error: { message: string } | null }) => unknown,
  ): Promise<unknown>
}

interface FakeDb {
  calls: FakeCall[]
  from(table: string): FakeQuery
}

function createFakeDb(
  rowsByTable: Record<string, unknown[]>,
  errorsByTable: Record<string, string> = {},
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
        in(column: string) {
          calls.push({ table, method: `in:${column}` })
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

const norm: Normalisers = {
  normalisePhone(raw) {
    if (raw === null || raw === undefined) return null
    const digits = raw.replace(/\D+/g, '')
    if (digits.length === 0) return null
    return digits.startsWith('0') ? `+64${digits.slice(1)}` : digits
  },
  normaliseEmail(raw) {
    if (raw === null || raw === undefined) return null
    const trimmed = raw.trim()
    return trimmed.length === 0 ? null : trimmed.toLowerCase()
  },
}

function makeRow(overrides: Partial<ImportRow> = {}): ImportRow {
  return {
    index: 0,
    invoice: '12345',
    originKind: 'company_confirmed',
    partySize: 2,
    tourKey: 'essentials',
    departOn: '2029-03-11',
    bookedOn: '2029-01-01',
    phone: '021 555 0100',
    email: 'Guest@Example.com',
    depositPaid: false,
    paidOn: null,
    ...overrides,
  }
}

const TOUR_ROW = { id: 'tour-1', slug: 'essentials' }
const DEPARTURE_ROW = { id: 'dep-1', tour_id: 'tour-1', depart_on: '2029-03-11' }

describe('readFacts - contacts', () => {
  it('matches none when no identity is found', async () => {
    const db = createFakeDb({
      contact_identities: [],
      tour_catalog_tours: [TOUR_ROW],
      tour_catalog_departures: [DEPARTURE_ROW],
      crm_bookings: [],
    })
    const { facts } = await readFacts(db as never, 'client-1', [makeRow()], norm)
    expect(facts[0].contact).toEqual({ kind: 'none' })
  })

  it('matches one by phone', async () => {
    const db = createFakeDb({
      contact_identities: [{ contact_id: 'c-1', kind: 'phone', value: '+64215550100' }],
      tour_catalog_tours: [TOUR_ROW],
      tour_catalog_departures: [DEPARTURE_ROW],
      crm_bookings: [],
    })
    const { facts } = await readFacts(db as never, 'client-1', [makeRow()], norm)
    expect(facts[0].contact).toEqual({ kind: 'one', contactId: 'c-1' })
  })

  it('matches one by email', async () => {
    const db = createFakeDb({
      contact_identities: [{ contact_id: 'c-2', kind: 'email', value: 'guest@example.com' }],
      tour_catalog_tours: [TOUR_ROW],
      tour_catalog_departures: [DEPARTURE_ROW],
      crm_bookings: [],
    })
    const { facts } = await readFacts(db as never, 'client-1', [makeRow()], norm)
    expect(facts[0].contact).toEqual({ kind: 'one', contactId: 'c-2' })
  })

  it('matches many when phone and email point at different contacts', async () => {
    const db = createFakeDb({
      contact_identities: [
        { contact_id: 'c-1', kind: 'phone', value: '+64215550100' },
        { contact_id: 'c-2', kind: 'email', value: 'guest@example.com' },
      ],
      tour_catalog_tours: [TOUR_ROW],
      tour_catalog_departures: [DEPARTURE_ROW],
      crm_bookings: [],
    })
    const { facts } = await readFacts(db as never, 'client-1', [makeRow()], norm)
    expect(facts[0].contact).toEqual({ kind: 'many', contactIds: ['c-1', 'c-2'] })
  })

  it('unions ids when phone and email point at the same contact', async () => {
    const db = createFakeDb({
      contact_identities: [
        { contact_id: 'c-1', kind: 'phone', value: '+64215550100' },
        { contact_id: 'c-1', kind: 'email', value: 'guest@example.com' },
      ],
      tour_catalog_tours: [TOUR_ROW],
      tour_catalog_departures: [DEPARTURE_ROW],
      crm_bookings: [],
    })
    const { facts } = await readFacts(db as never, 'client-1', [makeRow()], norm)
    expect(facts[0].contact).toEqual({ kind: 'one', contactId: 'c-1' })
  })
})

describe('readFacts - departures', () => {
  it('resolves a departure by slug and date', async () => {
    const db = createFakeDb({
      contact_identities: [],
      tour_catalog_tours: [TOUR_ROW],
      tour_catalog_departures: [DEPARTURE_ROW],
      crm_bookings: [],
    })
    const { facts } = await readFacts(db as never, 'client-1', [makeRow()], norm)
    expect(facts[0].departure).toEqual({ departureId: 'dep-1', tourId: 'tour-1' })
  })

  it('returns null when no departure matches', async () => {
    const db = createFakeDb({
      contact_identities: [],
      tour_catalog_tours: [TOUR_ROW],
      tour_catalog_departures: [DEPARTURE_ROW],
      crm_bookings: [],
    })
    const { facts } = await readFacts(
      db as never,
      'client-1',
      [makeRow({ departOn: '2029-04-01' })],
      norm,
    )
    expect(facts[0].departure).toBeNull()
  })
})

describe('readFacts - orders', () => {
  const ORDER_ROW = {
    id: 'b-1',
    contact_id: 'c-1',
    departure_id: 'dep-1',
    status: 'active',
    evidence_ref: '12-345',
  }

  it('finds an order by normalised invoice and by guest+departure', async () => {
    const db = createFakeDb({
      contact_identities: [{ contact_id: 'c-1', kind: 'phone', value: '+64215550100' }],
      tour_catalog_tours: [TOUR_ROW],
      tour_catalog_departures: [DEPARTURE_ROW],
      crm_bookings: [ORDER_ROW],
    })
    const { facts } = await readFacts(db as never, 'client-1', [makeRow()], norm)
    expect(facts[0].orderWithInvoice?.bookingId).toBe('b-1')
    expect(facts[0].orderForGuestAndDeparture?.bookingId).toBe('b-1')
  })

  it('retries without evidence_ref and marks originColumnsMissing', async () => {
    const db = createFakeDb(
      {
        contact_identities: [],
        tour_catalog_tours: [TOUR_ROW],
        tour_catalog_departures: [DEPARTURE_ROW],
        crm_bookings: [
          { id: 'b-1', contact_id: 'c-1', departure_id: 'dep-1', status: 'active' },
        ],
      },
      { crm_bookings: 'column crm_bookings.evidence_ref does not exist' },
      { crm_bookings: 'evidence_ref' },
    )
    const { facts, originColumnsMissing } = await readFacts(
      db as never,
      'client-1',
      [makeRow()],
      norm,
    )
    expect(originColumnsMissing).toBe(true)
    expect(facts[0].orderWithInvoice).toBeNull()
  })

  it('throws on a different error', async () => {
    const db = createFakeDb(
      {
        contact_identities: [],
        tour_catalog_tours: [TOUR_ROW],
        tour_catalog_departures: [DEPARTURE_ROW],
        crm_bookings: [],
      },
      { crm_bookings: 'permission denied' },
    )
    await expect(readFacts(db as never, 'client-1', [makeRow()], norm)).rejects.toThrow(
      'permission denied',
    )
  })
})

describe('readFacts - scoping and no writes', () => {
  it('every query is limited to the client', async () => {
    const db = createFakeDb({
      contact_identities: [],
      tour_catalog_tours: [TOUR_ROW],
      tour_catalog_departures: [DEPARTURE_ROW],
      crm_bookings: [],
    })
    await readFacts(db as never, 'client-1', [makeRow()], norm)
    for (const table of [
      'contact_identities',
      'tour_catalog_tours',
      'tour_catalog_departures',
      'crm_bookings',
    ]) {
      const mine = db.calls.filter((c) => c.table === table)
      expect(mine.some((c) => c.method === 'eq:client_id'), table).toBe(true)
    }
  })

  it('never calls a write method', async () => {
    const db = createFakeDb({
      contact_identities: [],
      tour_catalog_tours: [TOUR_ROW],
      tour_catalog_departures: [DEPARTURE_ROW],
      crm_bookings: [],
    })
    await readFacts(db as never, 'client-1', [makeRow()], norm)
    const forbidden = ['insert', 'update', 'delete', 'upsert', 'rpc']
    for (const call of db.calls) {
      for (const token of forbidden) {
        expect(call.method).not.toContain(token)
      }
    }
  })
})

describe('runPreview', () => {
  const READY_JSON = JSON.stringify([
    {
      invoice: '12345',
      originKind: 'company_confirmed',
      partySize: 2,
      tourKey: 'essentials',
      departOn: '2029-03-11',
      bookedOn: '2029-01-01',
      phone: '021 555 0100',
      email: 'Guest@Example.com',
      depositPaid: false,
    },
  ])

  it('renders a header and a plan fingerprint, and never leaks PII', async () => {
    const db = createFakeDb({
      contact_identities: [{ contact_id: 'c-1', kind: 'phone', value: '+64215550100' }],
      tour_catalog_tours: [TOUR_ROW],
      tour_catalog_departures: [DEPARTURE_ROW],
      crm_bookings: [],
    })
    const result = await runPreview({
      clientId: 'client-1',
      rawJson: READY_JSON,
      db: db as never,
      norm,
    })
    const text = result.lines.join('\n')
    expect(text).toContain('预览（只读，没有写入任何东西）')
    expect(text).toContain('计划指纹：')
    expect(text).not.toContain('5550100')
    expect(text).not.toContain('guest@example.com')
    expect(text).not.toContain('Guest@Example.com')
  })

  it('reports bad JSON with a single line', async () => {
    const db = createFakeDb({})
    const result = await runPreview({
      clientId: 'client-1',
      rawJson: 'not json',
      db: db as never,
      norm,
    })
    expect(result.lines).toEqual(['输入文件不是合法的 JSON'])
    expect(result.items).toEqual([])
    expect(result.planSha).toBe('')
  })

  it('reports an invalid row with its code and counts it', async () => {
    const badJson = JSON.stringify([
      {
        invoice: 'nope',
        originKind: 'company_confirmed',
        partySize: 2,
        tourKey: 'essentials',
        departOn: '2029-03-11',
        bookedOn: '2029-01-01',
        phone: '021 555 0100',
        email: null,
        depositPaid: false,
      },
    ])
    const db = createFakeDb({
      contact_identities: [],
      tour_catalog_tours: [TOUR_ROW],
      tour_catalog_departures: [DEPARTURE_ROW],
      crm_bookings: [],
    })
    const result = await runPreview({
      clientId: 'client-1',
      rawJson: badJson,
      db: db as never,
      norm,
    })
    expect(result.invalidCount).toBe(1)
    expect(result.lines.join('\n')).toContain('bad_invoice')
  })

  it('end to end: one ready, one already imported, one contact_not_found', async () => {
    const rows = [
      {
        invoice: '11111',
        originKind: 'company_confirmed',
        partySize: 2,
        tourKey: 'essentials',
        departOn: '2029-03-11',
        bookedOn: '2029-01-01',
        phone: '021 555 0100',
        email: null,
        depositPaid: false,
      },
      {
        invoice: '22222',
        originKind: 'company_confirmed',
        partySize: 2,
        tourKey: 'essentials',
        departOn: '2029-03-11',
        bookedOn: '2029-01-01',
        phone: '021 555 0100',
        email: null,
        depositPaid: false,
      },
      {
        invoice: '33333',
        originKind: 'company_confirmed',
        partySize: 2,
        tourKey: 'essentials',
        departOn: '2029-03-11',
        bookedOn: '2029-01-01',
        phone: '021 555 0199',
        email: null,
        depositPaid: false,
      },
    ]
    const db = createFakeDb({
      contact_identities: [{ contact_id: 'c-1', kind: 'phone', value: '+64215550100' }],
      tour_catalog_tours: [TOUR_ROW],
      tour_catalog_departures: [DEPARTURE_ROW],
      crm_bookings: [
        {
          id: 'b-1',
          contact_id: 'c-1',
          departure_id: 'dep-1',
          status: 'active',
          evidence_ref: ' 22-222 ',
        },
      ],
    })
    const result = await runPreview({
      clientId: 'client-1',
      rawJson: JSON.stringify(rows),
      db: db as never,
      norm,
    })
    const text = result.lines.join('\n')
    expect(text).toContain('预览（只读，没有写入任何东西）')
    expect(text).toContain('计划指纹：')
    expect(text).toContain('contact_not_found')
    expect(text).toContain('already_imported')
    expect(text).not.toContain('5550100')
    expect(text).not.toContain('5550199')
  })
})

describe('scripts/import-march-bookings.ts', () => {
  it('refuses --apply and contains no write calls', () => {
    const scriptPath = join(__dirname, '..', '..', '..', '..', '..', 'scripts', 'import-march-bookings.ts')
    const source = readFileSync(scriptPath, 'utf8')
    expect(source).toContain('--apply')
    expect(source).toContain('return 2')
    for (const token of ['.insert(', '.update(', '.delete(', '.upsert(', '.rpc(']) {
      expect(source).not.toContain(token)
    }
  })
})
