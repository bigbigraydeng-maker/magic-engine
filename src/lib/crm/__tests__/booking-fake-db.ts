/**
 * Test-only fake of the Supabase client, modelled per table.
 *
 * This is NOT a test file (vitest only runs *.test.ts). It is a shared
 * support module for the CRM booking tracker tests. The fake records every
 * query so tests can assert on the shape of the access pattern rather than
 * on call order.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type Row = Record<string, unknown>

export interface RecordedQuery {
  table: string
  op: 'select' | 'upsert' | 'delete'
  columns: string | null
  eqs: Array<[string, unknown]>
  ins: Array<[string, unknown[]]>
  limit: number | null
}

export interface FakeState {
  tables: Record<string, Row[]>
  queries: RecordedQuery[]
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>
  rpcErrors: Record<string, string>
  rpcData: Record<string, unknown>
  failTables: Set<string>
  failAfter: Record<string, number>
}

interface QueryResult {
  data: Row[] | Row | null
  error: { message: string } | null
}

interface RpcResult {
  data: unknown
  error: { message: string } | null
}

/** Project a row down to exactly the comma-separated column names given. */
function project(row: Row, columns: string | null): Row {
  if (columns === null || columns.trim() === '' || columns.trim() === '*') return { ...row }
  const out: Row = {}
  for (const raw of columns.split(',')) {
    const name = raw.trim()
    if (name !== '' && name in row) out[name] = row[name]
  }
  return out
}

/** Stable sort by a column, ascending or descending, with nulls last. */
function sortRows(rows: Row[], col: string, ascending: boolean): Row[] {
  const copy = rows.slice()
  copy.sort((a, b) => {
    const av = a[col]
    const bv = b[col]
    if (av === null || av === undefined) return 1
    if (bv === null || bv === undefined) return -1
    if (av === bv) return 0
    const cmp = av < bv ? -1 : 1
    return ascending ? cmp : -cmp
  })
  return copy
}

class FakeQuery implements PromiseLike<QueryResult> {
  private readonly state: FakeState
  private readonly table: string
  private op: 'select' | 'upsert' | 'delete' = 'select'
  private columns: string | null = null
  private readonly eqs: Array<[string, unknown]> = []
  private readonly ins: Array<[string, unknown[]]> = []
  private limitValue: number | null = null
  private single = false
  private upsertRow: Row | null = null
  private upsertIgnoreDuplicates = false

  constructor(state: FakeState, table: string) {
    this.state = state
    this.table = table
  }

  select(columns?: string): this {
    this.op = 'select'
    this.columns = columns ?? null
    return this
  }

  eq(col: string, val: unknown): this {
    this.eqs.push([col, val])
    return this
  }

  in(col: string, values: unknown[]): this {
    this.ins.push([col, values])
    return this
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderCol = col
    this.orderAscending = opts?.ascending ?? true
    return this
  }

  limit(n: number): this {
    this.limitValue = n
    return this
  }

  range(from: number, to: number): this {
    this.rangeFrom = from
    this.rangeTo = to
    return this
  }

  maybeSingle(): this {
    this.single = true
    return this
  }

  upsert(row: Row, opts?: { ignoreDuplicates?: boolean }): this {
    this.op = 'upsert'
    this.upsertRow = row
    this.upsertIgnoreDuplicates = opts?.ignoreDuplicates ?? false
    return this
  }

  delete(): this {
    this.op = 'delete'
    return this
  }

  private orderCol: string | null = null
  private orderAscending = true
  private rangeFrom: number | null = null
  private rangeTo: number | null = null

  private matches(row: Row): boolean {
    for (const [col, val] of this.eqs) {
      if (row[col] !== val) return false
    }
    for (const [col, values] of this.ins) {
      if (!values.includes(row[col])) return false
    }
    return true
  }

  private rows(): Row[] {
    return this.state.tables[this.table] ?? []
  }

  private record(): void {
    this.state.queries.push({
      table: this.table,
      op: this.op,
      columns: this.columns,
      eqs: this.eqs.map(([c, v]) => [c, v] as [string, unknown]),
      ins: this.ins.map(([c, v]) => [c, v] as [string, unknown[]]),
      limit: this.limitValue,
    })
  }

  private run(): QueryResult {
    const priorCount = this.state.queries.filter((q) => q.table === this.table).length
    this.record()
    if (this.state.failTables.has(this.table)) {
      return { data: null, error: { message: 'boom' } }
    }
    const limit = this.state.failAfter[this.table]
    if (limit !== undefined && priorCount >= limit) {
      return { data: null, error: { message: 'boom' } }
    }
    if (this.op === 'upsert') return this.runUpsert()
    if (this.op === 'delete') return this.runDelete()
    return this.runSelect()
  }

  private runUpsert(): QueryResult {
    const row = this.upsertRow ?? {}
    const existing = this.rows()
    if (this.upsertIgnoreDuplicates) {
      const dup = existing.some(
        (r) => r.client_id === row.client_id && r.email === row.email,
      )
      if (dup) return { data: null, error: null }
    }
    existing.push({ ...row })
    return { data: null, error: null }
  }

  private runDelete(): QueryResult {
    const existing = this.rows()
    const kept = existing.filter((r) => !this.matches(r))
    this.state.tables[this.table] = kept
    return { data: null, error: null }
  }

  private runSelect(): QueryResult {
    let rows = this.rows().filter((r) => this.matches(r))
    if (this.orderCol !== null) rows = sortRows(rows, this.orderCol, this.orderAscending)
    if (this.rangeFrom !== null && this.rangeTo !== null) {
      rows = rows.slice(this.rangeFrom, this.rangeTo + 1)
    }
    if (this.limitValue !== null) rows = rows.slice(0, this.limitValue)
    const projected = rows.map((r) => project(r, this.columns))
    if (this.single) return { data: projected[0] ?? null, error: null }
    return { data: projected, error: null }
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected)
  }
}

export function createFakeDb(): { db: SupabaseClient; state: FakeState; reset: () => void } {
  const state: FakeState = {
    tables: {},
    queries: [],
    rpcCalls: [],
    rpcErrors: {},
    rpcData: {},
    failTables: new Set<string>(),
    failAfter: {},
  }

  const fake = {
    from(table: string): FakeQuery {
      return new FakeQuery(state, table)
    },
    rpc(name: string, args?: Record<string, unknown>): Promise<RpcResult> {
      state.rpcCalls.push({ name, args: args ?? {} })
      const message = state.rpcErrors[name]
      if (message !== undefined) return Promise.resolve({ data: null, error: { message } })
      return Promise.resolve({ data: state.rpcData[name] ?? {}, error: null })
    },
  }

  const reset = (): void => {
    state.tables = {}
    state.queries.length = 0
    state.rpcCalls.length = 0
    state.rpcErrors = {}
    state.rpcData = {}
    state.failTables.clear()
    state.failAfter = {}
  }

  // Test-only cast: the fake implements just the surface the booking code uses.
  const db = fake as unknown as SupabaseClient
  return { db, state, reset }
}
