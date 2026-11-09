/**
 * Table-modelled in-memory fake of the supabase-js query builder (select / insert /
 * update with eq, in, gte, lte, lt, is, order, range, limit, maybeSingle).
 * Models TABLES, not call order, so reads and writes see each other's effects.
 * Supports the `col->>key` JSON-path form used by `.is('steps_json->>loop', null)`.
 */

type Row = Record<string, unknown>

export class FakeDb {
  tables: Record<string, Row[]> = {}
  /** table → error message to return from every write */
  writeErrors: Record<string, string> = {}
  private seq = 0

  constructor(initial: Record<string, Row[]> = {}) {
    for (const [t, rows] of Object.entries(initial)) this.tables[t] = rows.map(r => ({ ...r }))
  }

  rows(table: string): Row[] {
    return (this.tables[table] ??= [])
  }

  client() {
    return { from: (table: string) => new Query(this, table) } as never
  }

  nextId(): string {
    this.seq += 1
    return `fake-${this.seq}`
  }
}

function pick(row: Row, col: string): unknown {
  if (col.includes('->>')) {
    const [base, key] = col.split('->>')
    const obj = row[base]
    return obj && typeof obj === 'object' ? (obj as Row)[key] ?? null : null
  }
  return row[col] ?? null
}

class Query implements PromiseLike<{ data: unknown; error: { message: string } | null }> {
  private filters: Array<(r: Row) => boolean> = []
  private orders: Array<{ col: string; asc: boolean }> = []
  private mode: 'select' | 'insert' | 'update' = 'select'
  private payload: Row | Row[] | null = null
  private range_: [number, number] | null = null
  private limit_: number | null = null
  private single_ = false
  private returning = false

  constructor(private db: FakeDb, private table: string) {}

  select() { this.returning = true; return this }
  insert(rows: Row | Row[]) { this.mode = 'insert'; this.payload = rows; return this }
  update(patch: Row) { this.mode = 'update'; this.payload = patch; return this }
  eq(col: string, v: unknown) { this.filters.push(r => pick(r, col) === v); return this }
  in(col: string, vs: unknown[]) { this.filters.push(r => vs.includes(pick(r, col))); return this }
  gte(col: string, v: string | number) { this.filters.push(r => { const x = pick(r, col); return x !== null && (x as string) >= v }); return this }
  lte(col: string, v: string | number) { this.filters.push(r => { const x = pick(r, col); return x !== null && (x as string) <= v }); return this }
  lt(col: string, v: string | number) { this.filters.push(r => { const x = pick(r, col); return x !== null && (x as string) < v }); return this }
  is(col: string, v: null) { this.filters.push(r => pick(r, col) === v); return this }
  order(col: string, o?: { ascending?: boolean }) { this.orders.push({ col, asc: o?.ascending !== false }); return this }
  range(a: number, b: number) { this.range_ = [a, b]; return this }
  limit(n: number) { this.limit_ = n; return this }
  maybeSingle() { this.single_ = true; return this }

  private run(): { data: unknown; error: { message: string } | null } {
    const t = this.db.rows(this.table)
    if (this.mode === 'insert') {
      const err = this.db.writeErrors[this.table]
      if (err) return { data: null, error: { message: err } }
      const arr = (Array.isArray(this.payload) ? this.payload : [this.payload as Row]).map(r => ({ id: this.db.nextId(), ...r }))
      t.push(...arr)
      return { data: this.returning ? arr.map(r => ({ id: r.id })) : null, error: null }
    }
    const matched = t.filter(r => this.filters.every(f => f(r)))
    if (this.mode === 'update') {
      const err = this.db.writeErrors[this.table]
      if (err) return { data: null, error: { message: err } }
      for (const r of matched) Object.assign(r, this.payload)
      return { data: this.returning ? matched.map(r => ({ id: r.id })) : null, error: null }
    }
    let out = [...matched]
    for (const o of [...this.orders].reverse()) {
      out.sort((a, b) => {
        const x = pick(a, o.col) as string | number | null
        const y = pick(b, o.col) as string | number | null
        if (x === y) return 0
        if (x === null) return 1
        if (y === null) return -1
        return (x < y ? -1 : 1) * (o.asc ? 1 : -1)
      })
    }
    if (this.range_) out = out.slice(this.range_[0], this.range_[1] + 1)
    if (this.limit_ !== null) out = out.slice(0, this.limit_)
    if (this.single_) return { data: out[0] ?? null, error: null }
    return { data: out, error: null }
  }

  then<R1 = unknown, R2 = never>(
    onfulfilled?: ((v: { data: unknown; error: { message: string } | null }) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((e: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected)
  }
}
