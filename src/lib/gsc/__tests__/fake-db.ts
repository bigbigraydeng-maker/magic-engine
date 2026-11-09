/**
 * A table-modelled in-memory stand-in for Supabase, used by the GSC per-page
 * daily tests and the local trial run.
 *
 * It models TABLES — rows, primary keys, real filters, real ordering (including
 * Postgres NULL ordering) — not call order, so a wrong filter makes a test fail
 * instead of silently passing.
 *
 * Tests wire it in with:
 *
 *   vi.mock('@/lib/supabase', async () => ({
 *     supabaseAdmin: (await import('./fake-db')).fakeDb.client,
 *   }))
 *
 * so production code receives it as `supabaseAdmin` with no casts anywhere.
 * The column list passed to `.select()` is ignored: whole rows come back.
 */

export type Row = Record<string, unknown>

export interface DbError {
  message: string
  code?: string
}

export interface DbResult {
  data: Row[] | null
  error: DbError | null
}

export interface DbSingleResult {
  data: Row | null
  error: DbError | null
}

export type FakeOp = 'select' | 'insert' | 'upsert' | 'update'

export interface FakeFailure {
  table: string
  op: FakeOp
  message: string
  code?: string
  times?: number
}

export interface FakeQuery extends PromiseLike<DbResult> {
  select(columns?: string): FakeQuery
  insert(values: Row | Row[]): FakeQuery
  upsert(values: Row | Row[], options?: { onConflict?: string }): FakeQuery
  update(values: Row): FakeQuery
  eq(column: string, value: unknown): FakeQuery
  neq(column: string, value: unknown): FakeQuery
  in(column: string, values: readonly unknown[]): FakeQuery
  is(column: string, value: unknown): FakeQuery
  gte(column: string, value: unknown): FakeQuery
  lte(column: string, value: unknown): FakeQuery
  gt(column: string, value: unknown): FakeQuery
  lt(column: string, value: unknown): FakeQuery
  order(column: string, options?: { ascending?: boolean }): FakeQuery
  range(from: number, to: number): FakeQuery
  limit(n: number): FakeQuery
  single(): Promise<DbSingleResult>
  maybeSingle(): Promise<DbSingleResult>
}

export interface FakeDb {
  readonly tables: Record<string, Row[]>
  readonly client: { from(table: string): FakeQuery }
  /** One entry per executed query: `${op} ${table} ${n}` (n = rows written for writes, rows returned for selects). */
  readonly calls: string[]
  fail(failure: FakeFailure): void
  reset(): void
}

/** Composite primary keys; every other table uses ['id']. */
export const PRIMARY_KEYS: Readonly<Record<string, readonly string[]>> = {
  gsc_page_daily: ['client_id', 'day', 'page_url'],
  gsc_query_page_daily: ['client_id', 'day', 'query', 'page_url'],
}

/** Internal view: the failure queue is shared with the queries but not part of the public API. */
interface FakeDbState extends FakeDb {
  readonly failures: FakeFailure[]
  /** Upsert lookup indexes per `${table}|${conflict columns}`, kept like a real unique index. */
  readonly indexes: Map<string, { rows: Row[]; index: Map<string, Row> }>
}

type Filter = (row: Row) => boolean

interface OrderSpec {
  column: string
  ascending: boolean
}

function isNullish(value: unknown): boolean {
  return value === null || value === undefined
}

function compareStrings(a: unknown, b: unknown): number {
  const left = String(a)
  const right = String(b)
  return left < right ? -1 : left > right ? 1 : 0
}

function defaultsFor(table: string): Row {
  const base: Row = PRIMARY_KEYS[table] ? {} : { id: globalThis.crypto.randomUUID() }
  if (table === 'cron_run_logs') {
    base.started_at = new Date().toISOString()
  }
  if (table === 'gsc_page_fetch_receipts' || table === 'gsc_query_page_fetch_receipts') {
    base.status = 'running'
    base.row_count = 0
    base.request_count = 0
    base.skipped_long_urls = 0
    base.started_at = new Date().toISOString()
    base.finished_at = null
    base.failure_kind = null
    base.error = null
    base.data_from_day = null
    base.data_through_day = null
  }
  return base
}

function primaryKeyFor(table: string): readonly string[] {
  return PRIMARY_KEYS[table] ?? ['id']
}

function keyOf(row: Row, columns: readonly string[]): string {
  return columns.map((c) => JSON.stringify(row[c] ?? null)).join('\u0000')
}

class FakeQueryImpl implements FakeQuery {
  private op: FakeOp = 'select'
  private filters: Filter[] = []
  private orderSpec: OrderSpec | null = null
  private rangeSpec: { from: number; to: number } | null = null
  private limitSpec: number | null = null
  private writeValues: Row[] = []
  private onConflict: string | null = null
  private returnRows = false

  constructor(
    private readonly db: FakeDbState,
    private readonly table: string,
  ) {}

  select(_columns?: string): FakeQuery {
    if (this.op !== 'select') this.returnRows = true
    return this
  }

  insert(values: Row | Row[]): FakeQuery {
    this.op = 'insert'
    this.writeValues = Array.isArray(values) ? values : [values]
    return this
  }

  upsert(values: Row | Row[], options?: { onConflict?: string }): FakeQuery {
    this.op = 'upsert'
    this.writeValues = Array.isArray(values) ? values : [values]
    this.onConflict = options?.onConflict ?? null
    return this
  }

  update(values: Row): FakeQuery {
    this.op = 'update'
    this.writeValues = [values]
    return this
  }

  eq(column: string, value: unknown): FakeQuery {
    this.filters.push((row) => row[column] === value)
    return this
  }

  neq(column: string, value: unknown): FakeQuery {
    this.filters.push((row) => row[column] !== value)
    return this
  }

  in(column: string, values: readonly unknown[]): FakeQuery {
    this.filters.push((row) => values.includes(row[column]))
    return this
  }

  is(column: string, value: unknown): FakeQuery {
    this.filters.push((row) =>
      value === null ? isNullish(row[column]) : row[column] === value,
    )
    return this
  }

  gte(column: string, value: unknown): FakeQuery {
    this.filters.push((row) => !isNullish(row[column]) && compareStrings(row[column], value) >= 0)
    return this
  }

  lte(column: string, value: unknown): FakeQuery {
    this.filters.push((row) => !isNullish(row[column]) && compareStrings(row[column], value) <= 0)
    return this
  }

  gt(column: string, value: unknown): FakeQuery {
    this.filters.push((row) => !isNullish(row[column]) && compareStrings(row[column], value) > 0)
    return this
  }

  lt(column: string, value: unknown): FakeQuery {
    this.filters.push((row) => !isNullish(row[column]) && compareStrings(row[column], value) < 0)
    return this
  }

  order(column: string, options?: { ascending?: boolean }): FakeQuery {
    this.orderSpec = { column, ascending: options?.ascending ?? true }
    return this
  }

  range(from: number, to: number): FakeQuery {
    this.rangeSpec = { from, to }
    return this
  }

  limit(n: number): FakeQuery {
    this.limitSpec = n
    return this
  }

  then<TResult1 = DbResult, TResult2 = never>(
    onfulfilled?: ((value: DbResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected)
  }

  async single(): Promise<DbSingleResult> {
    const result = this.execute()
    if (result.error) return { data: null, error: result.error }
    const rows = result.data ?? []
    if (rows.length === 0) {
      return {
        data: null,
        error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' },
      }
    }
    return { data: rows[0], error: null }
  }

  async maybeSingle(): Promise<DbSingleResult> {
    const result = this.execute()
    if (result.error) return { data: null, error: result.error }
    const rows = result.data ?? []
    return { data: rows.length > 0 ? rows[0] : null, error: null }
  }

  private execute(): DbResult {
    const failure = this.takeFailure()
    if (failure) {
      this.db.calls.push(`${this.op} ${this.table} 0`)
      return { data: null, error: { message: failure.message, code: failure.code } }
    }
    if (this.op === 'select') return this.executeSelect()
    if (this.op === 'insert') return this.executeInsert()
    if (this.op === 'upsert') return this.executeUpsert()
    return this.executeUpdate()
  }

  private takeFailure(): FakeFailure | null {
    const found = this.db.failures.find(
      (f) => f.table === this.table && f.op === this.op && (f.times === undefined || f.times > 0),
    )
    if (!found) return null
    if (found.times !== undefined) found.times -= 1
    return found
  }

  private tableRows(): Row[] {
    const existing = this.db.tables[this.table]
    if (existing) return existing
    const created: Row[] = []
    this.db.tables[this.table] = created
    return created
  }

  private matching(): Row[] {
    return this.tableRows().filter((row) => this.filters.every((f) => f(row)))
  }

  private executeSelect(): DbResult {
    let rows = this.matching()
    if (this.orderSpec) rows = sortRows(rows, this.orderSpec)
    if (this.rangeSpec) rows = rows.slice(this.rangeSpec.from, this.rangeSpec.to + 1)
    if (this.limitSpec !== null) rows = rows.slice(0, this.limitSpec)
    const copies = rows.map((row) => ({ ...row }))
    this.db.calls.push(`select ${this.table} ${copies.length}`)
    return { data: copies, error: null }
  }

  private executeInsert(): DbResult {
    const rows = this.tableRows()
    const pk = primaryKeyFor(this.table)
    const prepared = this.writeValues.map((value) => ({ ...defaultsFor(this.table), ...value }))
    const seen = new Set(rows.map((row) => keyOf(row, pk)))
    for (const row of prepared) {
      const key = keyOf(row, pk)
      if (seen.has(key)) {
        this.db.calls.push(`insert ${this.table} 0`)
        return {
          data: null,
          error: {
            message: `duplicate key value violates unique constraint "${this.table}_pkey"`,
            code: '23505',
          },
        }
      }
      seen.add(key)
    }
    rows.push(...prepared)
    this.db.calls.push(`insert ${this.table} ${prepared.length}`)
    return { data: this.returnRows ? prepared.map((r) => ({ ...r })) : null, error: null }
  }

  private executeUpsert(): DbResult {
    const rows = this.tableRows()
    const conflict = this.onConflict
      ? this.onConflict.split(',').map((c) => c.trim())
      : primaryKeyFor(this.table)
    const prepared = this.writeValues.map((value) => ({ ...defaultsFor(this.table), ...value }))
    const seen = new Set<string>()
    for (const row of prepared) {
      const key = keyOf(row, conflict)
      if (seen.has(key)) {
        this.db.calls.push(`upsert ${this.table} 0`)
        return {
          data: null,
          error: {
            message: 'ON CONFLICT DO UPDATE command cannot affect row a second time',
            code: '21000',
          },
        }
      }
      seen.add(key)
    }
    const index = this.upsertIndex(rows, conflict)
    const affected: Row[] = []
    for (const [i, row] of prepared.entries()) {
      const key = keyOf(row, conflict)
      const existing = index.get(key)
      if (existing) {
        // ON CONFLICT DO UPDATE sets only the columns that were sent — no defaults.
        Object.assign(existing, this.writeValues[i])
        affected.push(existing)
      } else {
        rows.push(row)
        index.set(key, row)
        affected.push(row)
      }
    }
    this.db.calls.push(`upsert ${this.table} ${prepared.length}`)
    return { data: this.returnRows ? affected.map((r) => ({ ...r })) : null, error: null }
  }

  /** The persistent lookup index for this table + conflict columns (built on first use). */
  private upsertIndex(rows: Row[], conflict: readonly string[]): Map<string, Row> {
    const name = `${this.table}|${conflict.join(',')}`
    const cached = this.db.indexes.get(name)
    // Reuse only while it still describes this exact array (tests may replace a table wholesale).
    if (cached && cached.rows === rows && cached.index.size === rows.length) return cached.index
    const built = new Map(rows.map((r) => [keyOf(r, conflict), r] as const))
    this.db.indexes.set(name, { rows, index: built })
    return built
  }

  private executeUpdate(): DbResult {
    const values = this.writeValues[0] ?? {}
    const matched = this.matching()
    for (const row of matched) Object.assign(row, values)
    this.db.calls.push(`update ${this.table} ${matched.length}`)
    return { data: this.returnRows ? matched.map((r) => ({ ...r })) : null, error: null }
  }
}

function sortRows(rows: Row[], spec: OrderSpec): Row[] {
  const { column, ascending } = spec
  return [...rows].sort((a, b) => {
    const av = a[column]
    const bv = b[column]
    if (isNullish(av) && isNullish(bv)) return 0
    if (isNullish(av)) return ascending ? 1 : -1
    if (isNullish(bv)) return ascending ? -1 : 1
    const cmp = compareStrings(av, bv)
    return ascending ? cmp : -cmp
  })
}

export function createFakeDb(): FakeDb {
  const tables: Record<string, Row[]> = {}
  const calls: string[] = []
  const failures: FakeFailure[] = []
  const indexes = new Map<string, { rows: Row[]; index: Map<string, Row> }>()

  const db: FakeDbState = {
    tables,
    calls,
    failures,
    indexes,
    client: {
      from(table: string): FakeQuery {
        return new FakeQueryImpl(db, table)
      },
    },
    fail(failure: FakeFailure): void {
      failures.push(failure)
    },
    reset(): void {
      for (const key of Object.keys(tables)) delete tables[key]
      calls.length = 0
      failures.length = 0
      indexes.clear()
    },
  }

  return db
}

/** Shared instance for the vi.mock('@/lib/supabase') factories in this folder. */
export const fakeDb: FakeDb = createFakeDb()
