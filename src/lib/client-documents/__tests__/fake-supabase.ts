/**
 * A small in-memory stand-in for the parts of supabaseAdmin the document library uses, so the
 * tests prove what a request can actually see or change (filters, scoping, unique rules) instead
 * of only checking which methods were called. It re-implements the database rules that matter:
 * the path-shape CHECK, the unique path, the "one current file per client and content" index and
 * the archived/archived_at consistency CHECK.
 */

export type Row = Record<string, unknown>
interface DbError { message: string; code?: string }
interface Failure { table: string; op: string; error: DbError; afterCommit: boolean; skip: number }
interface Outcome { data: Row[] | null; error: DbError | null }

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
/** Same pattern as the CHECK in supabase/migrations/20261110140000_client_documents.sql. */
export const PATH_SHAPE = new RegExp(`^${UUID}/${UUID}/[A-Za-z0-9_-][A-Za-z0-9._-]{0,119}$`)

export interface StorageCalls {
  uploads: Array<{ path: string; contentType?: string; upsert?: boolean; cacheControl?: string; bucket: string }>
  removed: string[]
  signed: Array<{ path: string; ttl: number; download?: unknown; bucket: string }>
}

class FakeDb {
  tables: Record<string, Row[]> = { clients: [], client_documents: [], client_portal_users: [] }
  objects = new Set<string>()
  storage: StorageCalls = { uploads: [], removed: [], signed: [] }
  queries: string[] = []
  failures: Failure[] = []
  storageFailures: { upload?: string; sign?: string; remove?: string } = {}

  reset(seed: { clients?: Row[]; client_documents?: Row[]; client_portal_users?: Row[] } = {}): void {
    this.tables = {
      clients: [...(seed.clients ?? [])],
      client_documents: (seed.client_documents ?? []).map(row => ({ ...row })),
      client_portal_users: [...(seed.client_portal_users ?? [])],
    }
    this.objects = new Set()
    this.storage = { uploads: [], removed: [], signed: [] }
    this.queries = []
    this.failures = []
    this.storageFailures = {}
  }

  /** One-shot failure. `afterCommit` = the statement is applied and THEN reports an error (a lost answer). */
  failNext(table: string, op: string, error: DbError, opts: { afterCommit?: boolean; skip?: number } = {}): void {
    this.failures.push({ table, op, error, afterCommit: opts.afterCommit === true, skip: opts.skip ?? 0 })
  }

  /** `skip` = how many matching operations succeed first (to aim a failure at a later call). */
  takeFailure(table: string, op: string): Failure | null {
    const index = this.failures.findIndex(f => f.table === table && f.op === op)
    if (index < 0) return null
    const failure = this.failures[index]
    if (failure.skip > 0) {
      failure.skip -= 1
      return null
    }
    return this.failures.splice(index, 1)[0]
  }
}

export const fakeDb = new FakeDb()

const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Postgres compares uuid columns by value, so upper- and lower-case spellings are equal. */
function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string' && UUID_TEXT.test(a) && UUID_TEXT.test(b)) {
    return a.toLowerCase() === b.toLowerCase()
  }
  return a === b
}

function project(row: Row, cols: string): Row {
  if (cols.trim() === '*') return { ...row }
  const out: Row = {}
  for (const col of cols.split(',').map(c => c.trim()).filter(Boolean)) out[col] = row[col]
  return out
}

function violatesChecks(table: string, row: Row, others: Row[]): DbError | null {
  if (table !== 'client_documents') return null
  const path = String(row.storage_path)
  if (!PATH_SHAPE.test(path) || path.split('/')[0] !== row.client_id || path.split('/')[1] !== row.id) {
    return { message: 'violates check constraint "client_documents_path_shape"', code: '23514' }
  }
  if ((row.status === 'archived') !== (row.archived_at !== null && row.archived_at !== undefined)) {
    return { message: 'violates check constraint "client_documents_archive_consistent"', code: '23514' }
  }
  const clash = others.some(o =>
    o !== row && (o.storage_path === row.storage_path
      || (row.status === 'current' && o.status === 'current' && o.client_id === row.client_id && o.sha256 === row.sha256)))
  return clash ? { message: 'duplicate key value violates unique constraint', code: '23505' } : null
}

class Query implements PromiseLike<Outcome> {
  private op: 'select' | 'insert' | 'update' = 'select'
  private cols: string | null = null
  private payload: Row = {}
  private filters: Array<(row: Row) => boolean> = []
  private sort: { col: string; asc: boolean } | null = null
  private max: number | null = null

  constructor(private readonly table: string) {}

  select(cols = '*'): this { this.cols = cols; return this }
  insert(row: Row): this { this.op = 'insert'; this.payload = row; return this }
  update(patch: Row): this { this.op = 'update'; this.payload = patch; return this }
  eq(col: string, value: unknown): this { this.filters.push(row => sameValue(row[col], value)); return this }
  in(col: string, values: unknown[]): this { this.filters.push(row => values.some(value => sameValue(row[col], value))); return this }
  order(col: string, opts?: { ascending?: boolean }): this { this.sort = { col, asc: opts?.ascending !== false }; return this }
  limit(n: number): this { this.max = n; return this }

  maybeSingle(): Promise<{ data: Row | null; error: DbError | null }> {
    return this.run().then(r => ({ data: r.data?.[0] ?? null, error: r.error }))
  }

  single(): Promise<{ data: Row | null; error: DbError | null }> {
    return this.run().then(r => (r.error || r.data?.[0]
      ? { data: r.data?.[0] ?? null, error: r.error }
      : { data: null, error: { message: 'no rows' } }))
  }

  then<R1 = Outcome, R2 = never>(
    onFulfilled?: ((value: Outcome) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.run().then(onFulfilled, onRejected)
  }

  private async run(): Promise<Outcome> {
    fakeDb.queries.push(`${this.op} ${this.table}`)
    const injected = fakeDb.takeFailure(this.table, this.op)
    if (injected && !injected.afterCommit) return { data: null, error: injected.error }
    const rows = fakeDb.tables[this.table] ?? []
    if (injected && this.op === 'insert') {
      this.runInsert(rows)
      return { data: null, error: injected.error }
    }
    if (this.op === 'insert') return this.runInsert(rows)
    const matched = rows.filter(row => this.filters.every(f => f(row)))
    if (this.op === 'update') return this.runUpdate(rows, matched)
    return { data: this.shape(matched), error: null }
  }

  private shape(matched: Row[]): Row[] {
    let out = [...matched]
    if (this.sort) {
      const { col, asc } = this.sort
      out.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1))
    }
    if (this.max !== null) out = out.slice(0, this.max)
    return out.map(row => project(row, this.cols ?? '*'))
  }

  private runInsert(rows: Row[]): Outcome {
    const row: Row = {
      description: null, version_label: null, replaces_id: null, archived_at: null, archived_by: null,
      status: 'current', visibility: 'internal', created_at: new Date('2026-11-10T00:00:00Z').toISOString(),
      ...this.payload,
    }
    const error = violatesChecks(this.table, row, rows)
    if (error) return { data: null, error }
    rows.push(row)
    return { data: this.cols === null ? null : [project(row, this.cols)], error: null }
  }

  private runUpdate(rows: Row[], matched: Row[]): Outcome {
    const updated: Row[] = []
    for (const row of matched) {
      const next = { ...row, ...this.payload }
      const error = violatesChecks(this.table, next, rows.filter(r => r !== row))
      if (error) return { data: null, error }
      Object.assign(row, this.payload)
      updated.push(row)
    }
    return { data: this.cols === null ? null : updated.map(row => project(row, this.cols ?? '*')), error: null }
  }
}

function bucketApi(bucket: string) {
  return {
    async upload(path: string, _bytes: unknown, opts?: { contentType?: string; upsert?: boolean; cacheControl?: string }) {
      fakeDb.storage.uploads.push({ path, contentType: opts?.contentType, upsert: opts?.upsert, cacheControl: opts?.cacheControl, bucket })
      if (fakeDb.storageFailures.upload) return { data: null, error: { message: fakeDb.storageFailures.upload } }
      fakeDb.objects.add(path)
      return { data: { path }, error: null }
    },
    async remove(paths: string[]) {
      fakeDb.storage.removed.push(...paths)
      if (fakeDb.storageFailures.remove) return { data: null, error: { message: fakeDb.storageFailures.remove } }
      for (const path of paths) fakeDb.objects.delete(path)
      return { data: [], error: null }
    },
    async createSignedUrl(path: string, ttl: number, opts?: { download?: unknown }) {
      fakeDb.storage.signed.push({ path, ttl, download: opts?.download, bucket })
      if (fakeDb.storageFailures.sign) return { data: null, error: { message: fakeDb.storageFailures.sign } }
      return { data: { signedUrl: `https://storage.example.test/sign/${bucket}/${path}?token=t` }, error: null }
    },
  }
}

export const supabaseAdmin = {
  from: (table: string) => new Query(table),
  storage: { from: (bucket: string) => bucketApi(bucket) },
}
