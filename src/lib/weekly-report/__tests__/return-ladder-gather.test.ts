import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const configProbe = vi.fn()
const outcomeConfigProbe = vi.fn()
const evaluationDateProbe = vi.fn()

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/ads-strategy/config', () => ({ loadAdStrategyConfigWithSource: (id: string) => configProbe(id) }))
vi.mock('@/lib/ads-strategy/portfolio/outcome-config', () => ({ loadOutcomeConfig: (id: string) => outcomeConfigProbe(id) }))
vi.mock('@/lib/ads-strategy/account-timezone', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/ads-strategy/account-timezone')>()
  return { ...original, resolveClientEvaluationDate: (...args: unknown[]) => evaluationDateProbe(...args) }
})

import { gatherReturnLadders, readPages, PAGE_SIZE, MAX_PAGES } from '../return-ladder-gather'

// ---------------------------------------------------------------------------
// Fake database
// ---------------------------------------------------------------------------

interface RecordedCall {
  table: string
  method: string
  select?: string
  filters?: Array<{ op: string; col: string; value: unknown }>
  range?: { from: number; to: number }
  limit?: number
}

interface FakeDb {
  client: { from: (table: string) => unknown; rpc: (...args: unknown[]) => unknown }
  calls: RecordedCall[]
}

type Row = Record<string, unknown>

function matchesFilters(row: Row, filters: Array<{ op: string; col: string; value: unknown }>): boolean {
  for (const f of filters) {
    const cell = row[f.col]
    if (f.op === 'eq') {
      if (cell !== f.value) return false
    } else if (f.op === 'neq') {
      if (cell === f.value) return false
    } else if (f.op === 'gte') {
      if (typeof cell !== 'string' || typeof f.value !== 'string') return false
      if (cell < f.value) return false
    } else if (f.op === 'in') {
      const list = Array.isArray(f.value) ? f.value : []
      if (!list.includes(cell)) return false
    }
  }
  return true
}

function fakeDb(tables: Record<string, Row[]>, opts: { failTables?: string[] } = {}): FakeDb {
  const calls: RecordedCall[] = []
  const failTables = opts.failTables ?? []

  const makeBuilder = (table: string) => {
    const filters: Array<{ op: string; col: string; value: unknown }> = []
    let selectCols: string | undefined
    let rangeArgs: { from: number; to: number } | undefined
    let limitArg: number | undefined

    const record = (method: string) => {
      calls.push({
        table,
        method,
        select: selectCols,
        filters: filters.slice(),
        range: rangeArgs,
        limit: limitArg,
      })
    }

    const builder = {
      select(cols: string) {
        selectCols = cols
        return builder
      },
      eq(col: string, value: unknown) {
        filters.push({ op: 'eq', col, value })
        return builder
      },
      neq(col: string, value: unknown) {
        filters.push({ op: 'neq', col, value })
        return builder
      },
      gte(col: string, value: unknown) {
        filters.push({ op: 'gte', col, value })
        return builder
      },
      in(col: string, values: unknown) {
        filters.push({ op: 'in', col, value: values })
        return builder
      },
      order() {
        return builder
      },
      limit(n: number) {
        limitArg = n
        return builder
      },
      range(from: number, to: number) {
        rangeArgs = { from, to }
        return builder
      },
      insert() {
        calls.push({ table, method: 'WRITE' })
        return builder
      },
      update() {
        calls.push({ table, method: 'WRITE' })
        return builder
      },
      upsert() {
        calls.push({ table, method: 'WRITE' })
        return builder
      },
      delete() {
        calls.push({ table, method: 'WRITE' })
        return builder
      },
      then(resolve: (value: { data: unknown; error: { message: string } | null }) => unknown) {
        record('await')
        if (failTables.includes(table)) {
          return Promise.resolve(resolve({ data: null, error: { message: 'boom' } }))
        }
        const all = tables[table] ?? []
        let rows = all.filter(r => matchesFilters(r, filters))
        if (rangeArgs !== undefined) {
          rows = rows.slice(rangeArgs.from, rangeArgs.to + 1)
        } else if (limitArg !== undefined) {
          rows = rows.slice(0, limitArg)
        }
        return Promise.resolve(resolve({ data: rows, error: null }))
      },
    }
    return builder
  }

  const client = {
    from: (table: string) => makeBuilder(table),
    rpc: (..._args: unknown[]) => {
      calls.push({ table: 'rpc', method: 'WRITE' })
      return makeBuilder('rpc')
    },
  }

  return { client, calls }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date('2026-10-09T18:30:00Z')

function baseTables(): Record<string, Row[]> {
  return {
    ad_daily_insights: [
      {
        id: 'ins_a1', client_id: 'client_a', ad_account_id: 'acct_a', platform: 'p1',
        level: 'campaign', insight_date: '2026-10-05', entity_id: 'e1',
        spend: '12.50', leads: '3', messaging_conversations: '1',
      },
      {
        id: 'ins_a2', client_id: 'client_a', ad_account_id: 'acct_a', platform: 'p1',
        level: 'campaign', insight_date: '2026-10-06', entity_id: 'e2',
        spend: '7.50', leads: '2', messaging_conversations: '0',
      },
      {
        id: 'ins_b1', client_id: 'client_b', ad_account_id: 'acct_b', platform: 'p1',
        level: 'campaign', insight_date: '2026-10-05', entity_id: 'e3',
        spend: '20.00', leads: '1', messaging_conversations: '0',
      },
    ],
    clients: [
      { id: 'client_a', name: '甲客户', industry: null },
      { id: 'client_b', name: '乙客户', industry: null },
    ],
    ad_entity_snapshots: [
      { ad_account_id: 'acct_a', level: 'account', timezone_name: 'Pacific/Auckland', currency: 'NZD' },
      { ad_account_id: 'acct_b', level: 'account', timezone_name: 'Pacific/Auckland', currency: 'NZD' },
    ],
    me_sale_outcomes: [],
    contacts: [],
  }
}

beforeEach(() => {
  configProbe.mockReset()
  outcomeConfigProbe.mockReset()
  evaluationDateProbe.mockReset()
  configProbe.mockResolvedValue({ config: {}, source: 'row' })
  outcomeConfigProbe.mockResolvedValue({ config: { primary: 'lead' }, source: 'row' })
  evaluationDateProbe.mockResolvedValue('2026-10-09')
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('gatherReturnLadders', () => {
  it('happy path: two clients with spend, sorted by name, spends summed', async () => {
    const db = fakeDb(baseTables())
    const result = await gatherReturnLadders(db.client as never, NOW)

    expect('rows' in result).toBe(true)
    if (!('rows' in result)) throw new Error('expected rows')
    expect(result.rows).toHaveLength(2)
    expect(result.failed).toEqual([])
    expect(result.rows.map(r => r.name)).toEqual(['乙客户', '甲客户'])

    const a = result.rows.find(r => r.client_id === 'client_a')
    if (a === undefined) throw new Error('missing client_a')
    expect(a.ladder.spend.byCurrency).toEqual([{ currency: 'NZD', amount: 20 }])
  })

  it('a client whose rows all have spend 0 is not in rows', async () => {
    const tables = baseTables()
    tables.ad_daily_insights = [
      {
        id: 'ins_a1', client_id: 'client_a', ad_account_id: 'acct_a', platform: 'p1',
        level: 'campaign', insight_date: '2026-10-05', entity_id: 'e1',
        spend: '0', leads: '0', messaging_conversations: '0',
      },
      {
        id: 'ins_b1', client_id: 'client_b', ad_account_id: 'acct_b', platform: 'p1',
        level: 'campaign', insight_date: '2026-10-05', entity_id: 'e3',
        spend: '20.00', leads: '1', messaging_conversations: '0',
      },
    ]
    const db = fakeDb(tables)
    const result = await gatherReturnLadders(db.client as never, NOW)

    if (!('rows' in result)) throw new Error('expected rows')
    expect(result.rows.map(r => r.client_id)).toEqual(['client_b'])
  })

  it('is read-only: no WRITE call is ever recorded', async () => {
    const db = fakeDb(baseTables())
    await gatherReturnLadders(db.client as never, NOW)
    expect(db.calls.some(c => c.method === 'WRITE')).toBe(false)
  })

  it('never selects personal data from me_sale_outcomes', async () => {
    const db = fakeDb(baseTables())
    await gatherReturnLadders(db.client as never, NOW)
    const selects = db.calls.filter(c => c.table === 'me_sale_outcomes' && c.select !== undefined)
    expect(selects.length).toBeGreaterThan(0)
    for (const c of selects) {
      expect(c.select).toBe('id, contact_id, outcome_kind, amount_minor, currency, occurred_at, review_status')
    }
  })

  it('filters rejected outcomes in the query and in the count', async () => {
    const tables = baseTables()
    tables.me_sale_outcomes = [
      {
        id: 'o1', client_id: 'client_a', contact_id: 'c1', outcome_kind: 'lead',
        amount_minor: null, currency: null, occurred_at: '2026-10-05T00:00:00Z',
        review_status: 'approved', customer_email: 'secret@example.test',
      },
      {
        id: 'o2', client_id: 'client_a', contact_id: 'c2', outcome_kind: 'lead',
        amount_minor: null, currency: null, occurred_at: '2026-10-06T00:00:00Z',
        review_status: 'rejected', customer_email: 'secret@example.test',
      },
    ]
    tables.contacts = [
      { id: 'c1', first_seen_at: '2026-10-05T00:00:00Z', attr_platform: 'p1' },
      { id: 'c2', first_seen_at: '2026-10-06T00:00:00Z', attr_platform: 'p1' },
    ]
    const db = fakeDb(tables)
    const result = await gatherReturnLadders(db.client as never, NOW)

    const neqCall = db.calls.find(
      c => c.table === 'me_sale_outcomes' && (c.filters ?? []).some(f => f.op === 'neq' && f.col === 'review_status' && f.value === 'rejected'),
    )
    expect(neqCall).toBeDefined()

    if (!('rows' in result)) throw new Error('expected rows')
    const a = result.rows.find(r => r.client_id === 'client_a')
    if (a === undefined) throw new Error('missing client_a')
    expect(a.ladder.qualified.count).toBe(1)
  })

  it('never defaults the sales cycle: cycle_not_configured and reachedLevel 5', async () => {
    const tables = baseTables()
    const outcomes: Row[] = []
    const contacts: Row[] = []
    for (let i = 0; i < 5; i++) {
      const cid = `c${i}`
      contacts.push({ id: cid, first_seen_at: '2026-10-05T00:00:00Z', attr_platform: 'p1' })
      outcomes.push({
        id: `lead_${i}`, client_id: 'client_a', contact_id: cid, outcome_kind: 'lead',
        amount_minor: null, currency: null, occurred_at: '2026-10-05T00:00:00Z',
        review_status: 'approved', customer_email: 'secret@example.test',
      })
      outcomes.push({
        id: `purchase_${i}`, client_id: 'client_a', contact_id: cid, outcome_kind: 'purchase',
        amount_minor: 1000, currency: 'NZD', occurred_at: '2026-10-06T00:00:00Z',
        review_status: 'approved', customer_email: 'secret@example.test',
      })
    }
    tables.me_sale_outcomes = outcomes
    tables.contacts = contacts
    const db = fakeDb(tables)
    const result = await gatherReturnLadders(db.client as never, NOW)

    if (!('rows' in result)) throw new Error('expected rows')
    const a = result.rows.find(r => r.client_id === 'client_a')
    if (a === undefined) throw new Error('missing client_a')
    expect(a.ladder.returnOnSpend.blockers).toContain('cycle_not_configured')
    expect(a.ladder.reachedLevel).toBe(5)
  })

  it('config read failure surfaces as config_unreadable and null primary', async () => {
    configProbe.mockResolvedValue({ config: {}, source: 'fallback', error: 'x' })
    const db = fakeDb(baseTables())
    const result = await gatherReturnLadders(db.client as never, NOW)

    if (!('rows' in result)) throw new Error('expected rows')
    const a = result.rows.find(r => r.client_id === 'client_a')
    if (a === undefined) throw new Error('missing client_a')
    expect(a.ladder.notes).toContain('config_unreadable')
    expect(a.ladder.results.primary).toBeNull()
  })

  it('outcome config read_error also surfaces as config_unreadable', async () => {
    outcomeConfigProbe.mockResolvedValue({ config: { primary: null }, source: 'read_error' })
    const db = fakeDb(baseTables())
    const result = await gatherReturnLadders(db.client as never, NOW)

    if (!('rows' in result)) throw new Error('expected rows')
    const a = result.rows.find(r => r.client_id === 'client_a')
    if (a === undefined) throw new Error('missing client_a')
    expect(a.ladder.notes).toContain('config_unreadable')
  })

  it('unknown currency and timezone when no snapshots exist', async () => {
    const tables = baseTables()
    tables.ad_entity_snapshots = []
    const db = fakeDb(tables)
    const result = await gatherReturnLadders(db.client as never, NOW)

    if (!('rows' in result)) throw new Error('expected rows')
    const a = result.rows.find(r => r.client_id === 'client_a')
    if (a === undefined) throw new Error('missing client_a')
    expect(a.ladder.spend.byCurrency[0]?.currency).toBeNull()
    expect(a.ladder.notes).toContain('timezone_unknown')
  })

  it('one client failing does not take the others down', async () => {
    outcomeConfigProbe.mockImplementation((id: string) => {
      if (id === 'client_b') return Promise.reject(new Error('config boom'))
      return Promise.resolve({ config: { primary: 'lead' }, source: 'row' })
    })
    const db = fakeDb(baseTables())
    const result = await gatherReturnLadders(db.client as never, NOW)

    if (!('rows' in result)) throw new Error('expected rows')
    expect(result.rows.map(r => r.client_id)).toEqual(['client_a'])
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]?.client_id).toBe('client_b')
    expect(result.failed[0]?.error.length).toBeGreaterThan(0)
  })

  it('whole-section failure returns { error } without rejecting', async () => {
    const db = fakeDb(baseTables(), { failTables: ['ad_daily_insights'] })
    const result = await gatherReturnLadders(db.client as never, NOW)
    expect(result).toEqual({ error: 'boom' })
  })
})

describe('readPages', () => {
  it('marks incomplete when every page is full', async () => {
    const full = Array.from({ length: PAGE_SIZE }, (_, i) => ({ i }))
    const result = await readPages<{ i: number }>(() => Promise.resolve({ data: full, error: null }))
    expect(result.incomplete).toBe(true)
    expect(result.rows.length).toBe(PAGE_SIZE * MAX_PAGES)
  })

  it('marks complete when a short page is returned', async () => {
    const short = [{ i: 1 }, { i: 2 }]
    const result = await readPages<{ i: number }>(() => Promise.resolve({ data: short, error: null }))
    expect(result.incomplete).toBe(false)
    expect(result.rows.length).toBe(2)
  })

  it('rejects when the builder returns an error', async () => {
    await expect(
      readPages<{ i: number }>(() => Promise.resolve({ data: null, error: { message: 'boom' } })),
    ).rejects.toThrow('boom')
  })
})

describe('spend not fully read', () => {
  it('every ladder says cannot_judge and notes spend_incomplete', async () => {
    // 表里的行数正好填满翻页上限：每一页都是满页，读到上限也没读完。
    const fullPage: Row[] = Array.from({ length: PAGE_SIZE * MAX_PAGES }, (_, i) => ({
      id: `ins_${i}`, client_id: 'client_a', ad_account_id: 'acct_a', platform: 'p1',
      level: 'campaign', insight_date: '2026-10-05', entity_id: `e${i}`,
      spend: '1.00', leads: '0', messaging_conversations: '0',
    }))
    const tables: Record<string, Row[]> = {
      ad_daily_insights: fullPage,
      clients: [{ id: 'client_a', name: '甲客户', industry: null }],
      ad_entity_snapshots: [
        { ad_account_id: 'acct_a', level: 'account', timezone_name: 'Pacific/Auckland', currency: 'NZD' },
      ],
      me_sale_outcomes: [],
      contacts: [],
    }
    const db = fakeDb(tables)
    const result = await gatherReturnLadders(db.client as never, NOW)

    if (!('rows' in result)) throw new Error('expected rows')
    expect(result.rows).toHaveLength(1)
    const a = result.rows[0]
    if (a === undefined) throw new Error('missing row')
    expect(a.ladder.spend.status).toBe('cannot_judge')
    expect(a.ladder.notes).toContain('spend_incomplete')
  })
})
