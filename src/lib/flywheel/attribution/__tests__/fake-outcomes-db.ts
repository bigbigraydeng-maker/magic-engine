/**
 * Table-modelled Supabase stand-in for the attribution writers.
 *
 * Deliberately NOT a call-order mock. The bug this Work Package fixes lived for
 * months behind a fake that returned a half-built object for every call, so any
 * assertion on "did we end up with the right rows" was vacuous. This fake models
 * the four tables the two writers touch, enforces the real
 * `flywheel_outcomes_natural_key` UNIQUE constraint, and throws loudly on any
 * table nobody has modelled — so a writer that starts reading a new table fails
 * the suite instead of silently getting `[]`.
 */

type Row = Record<string, unknown>

type FilterOp = 'eq' | 'neq' | 'in' | 'notLike' | 'lt' | 'lte' | 'gt' | 'gte' | 'notNull' | 'isNull'

interface Filter {
  column: string
  op: FilterOp
  value: unknown
}

export interface DbError {
  message: string
}

export interface OpLogEntry {
  table: string
  op: 'select' | 'upsert' | 'insert' | 'delete' | 'update'
  filters: Filter[]
  rowCount?: number
}

/** PostgREST returns at most this many rows per request, without saying so. */
const POSTGREST_MAX_ROWS = 1000

/** Columns of the UNIQUE constraint added by the expand migration. */
export const NATURAL_KEY_COLUMNS = ['action_id', 'metric_key', 'window_days'] as const

export const EVALUATOR_VOCABULARY = ['flywheel_metrics', 'gsc_snapshots'] as const

/**
 * Where `flywheel_outcomes` sits in the expand → deploy → contract rollout.
 *
 *   pre_expand    — today's main: no UNIQUE, no evaluator_key
 *   post_expand   — after 20260808000001: UNIQUE exists, evaluator_key nullable
 *   post_contract — after the follow-up contract PR (deliberately NOT in this
 *                   branch, see rollout-order.test.ts): evaluator_key NOT NULL
 *                   + narrowed CHECK
 *
 * Modelling the three states is what lets the suite prove the ordering claim
 * rather than assert it in prose.
 */
export type OutcomeSchemaState = 'pre_expand' | 'post_expand' | 'post_contract'

const MODELLED_TABLES = [
  'flywheel_actions',
  'flywheel_metrics',
  'flywheel_outcomes',
  'gsc_performance_snapshots',
] as const

type ModelledTable = (typeof MODELLED_TABLES)[number]

export class FakeOutcomesDb {
  private tables = new Map<string, Row[]>()
  private idCounter = 0
  private pendingFailures: Array<{ table: string; op: string; message: string; skip: number }> = []

  readonly ops: OpLogEntry[] = []
  readonly schema: OutcomeSchemaState

  constructor(options: { schema?: OutcomeSchemaState } = {}) {
    this.schema = options.schema ?? 'post_expand'
    for (const t of MODELLED_TABLES) this.tables.set(t, [])
  }

  hasNaturalKeyConstraint(): boolean {
    return this.schema !== 'pre_expand'
  }

  evaluatorKeyIsRequired(): boolean {
    return this.schema === 'post_contract'
  }

  // ── Seeding / inspection ──────────────────────────────────────────────────

  /**
   * Insert rows without touching the unique constraint. Used to reproduce
   * historical states that the constraint would now reject (e.g. pre-migration
   * duplicate rows).
   */
  seed(table: ModelledTable, rows: Row[]): void {
    const target = this.rowsOf(table)
    for (const row of rows) {
      const stored: Row = { id: row.id ?? this.nextId(), ...row }
      if (table === 'flywheel_outcomes' && this.schema !== 'pre_expand') {
        stored.outcome_key = `${stored.action_id}:${stored.metric_key}:${stored.window_days}`
      }
      target.push(stored)
    }
  }

  rowsOf(table: ModelledTable): Row[] {
    const rows = this.tables.get(table)
    if (!rows) throw new Error(`FakeOutcomesDb: table "${table}" is not modelled`)
    return rows
  }

  outcomes(): Row[] {
    return this.rowsOf('flywheel_outcomes')
  }

  /**
   * Make a matching operation return a DB error, once. `afterMatches` skips
   * that many matching operations first — `{ afterMatches: 1 }` fails the
   * SECOND matching op, which is how a handoff-window write is made to fail
   * after the cadence-window write succeeded.
   */
  failNext(
    table: ModelledTable,
    op: 'upsert' | 'insert' | 'delete' | 'select' | 'update',
    message: string,
    opts: { afterMatches?: number } = {},
  ): void {
    this.pendingFailures.push({ table, op, message, skip: opts.afterMatches ?? 0 })
  }

  didDeleteFrom(table: ModelledTable): boolean {
    return this.ops.some(o => o.table === table && o.op === 'delete')
  }

  // ── Supabase surface ──────────────────────────────────────────────────────

  from(table: string): QueryBuilder {
    if (!this.tables.has(table)) {
      // Fail loudly: an unmodelled table is a hole in the test, not an empty result.
      throw new Error(
        `FakeOutcomesDb: unmodelled table "${table}". Model it before asserting on behaviour.`,
      )
    }
    return new QueryBuilder(this, table)
  }

  // ── Internals used by QueryBuilder ────────────────────────────────────────

  nextId(): string {
    this.idCounter += 1
    return `row-${this.idCounter}`
  }

  takeFailure(table: string, op: string): string | null {
    const idx = this.pendingFailures.findIndex(f => f.table === table && f.op === op)
    if (idx === -1) return null
    const failure = this.pendingFailures[idx]
    if (failure.skip > 0) {
      failure.skip--
      return null
    }
    return this.pendingFailures.splice(idx, 1)[0].message
  }

  log(entry: OpLogEntry): void {
    this.ops.push(entry)
  }
}

/**
 * The `flywheel_outcomes_evaluator_owns_metric` CHECK, transcribed from the
 * migration SQL rather than imported from `outcome-identity.ts`. Reading the
 * rule from the module it is meant to police would make the two agree by
 * construction and prove nothing; a separate test ties this back to the SQL.
 */
function sqlMetricFamilyOwner(metricKey: string): string {
  return metricKey.startsWith('seo.gsc.') ? 'gsc_snapshots' : 'flywheel_metrics'
}

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every(f => {
    const actual = row[f.column]
    switch (f.op) {
      case 'eq':
        return actual === f.value
      case 'neq':
        return actual !== f.value
      case 'in':
        return (f.value as unknown[]).includes(actual)
      case 'notNull':
        return actual !== null && actual !== undefined
      case 'notLike': {
        // Only the `prefix%` form the writers use.
        const pattern = String(f.value)
        if (!pattern.endsWith('%')) {
          throw new Error(`FakeOutcomesDb: unmodelled LIKE pattern "${pattern}"`)
        }
        return !String(actual).startsWith(pattern.slice(0, -1))
      }
      case 'isNull':
        // PostgREST `.is('col', null)` — and an absent column is NULL, which is
        // exactly the shape a row written before the expand migration has.
        return actual === null || actual === undefined
      case 'lt':
        return compare(actual, f.value) < 0
      case 'lte':
        return compare(actual, f.value) <= 0
      case 'gt':
        return compare(actual, f.value) > 0
      case 'gte':
        return compare(actual, f.value) >= 0
    }
  })
}

function compare(a: unknown, b: unknown): number {
  const av = typeof a === 'string' ? Date.parse(a) || a : a
  const bv = typeof b === 'string' ? Date.parse(b) || b : b
  if (typeof av === 'number' && typeof bv === 'number') return av - bv
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
}

class QueryBuilder implements PromiseLike<{ data: Row[] | null; error: DbError | null }> {
  private filters: Filter[] = []
  private orderBy: { column: string; ascending: boolean } | null = null
  private limitCount: number | null = null
  private rangeFrom: number | null = null
  private rangeTo: number | null = null
  private mode: 'select' | 'delete' | 'update' = 'select'
  private patch: Row | null = null

  constructor(
    private db: FakeOutcomesDb,
    private table: string,
  ) {}

  select(): this {
    return this
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ column, op: 'eq', value })
    return this
  }

  neq(column: string, value: unknown): this {
    this.filters.push({ column, op: 'neq', value })
    return this
  }

  in(column: string, value: unknown[]): this {
    this.filters.push({ column, op: 'in', value })
    return this
  }

  /**
   * PostgREST's `not(column, op, value)`.
   *
   * The op used to be ignored: every `.not()` became `IS NOT NULL`. That is not
   * a shortcut, it is a wrong table — a writer excluding a metric namespace
   * would have every row match in tests and only the intended ones match in
   * production, so the exclusion could ship broken with a green suite. The two
   * forms the writers actually use are modelled; anything else throws rather
   * than being silently approximated.
   */
  not(column: string, op: string, value: unknown): this {
    if (op === 'is' && value === null) {
      this.filters.push({ column, op: 'notNull', value: null })
      return this
    }
    if (op === 'like') {
      this.filters.push({ column, op: 'notLike', value })
      return this
    }
    throw new Error(`FakeOutcomesDb: unmodelled .not(${column}, ${op}, …)`)
  }

  lt(column: string, value: unknown): this {
    this.filters.push({ column, op: 'lt', value })
    return this
  }

  lte(column: string, value: unknown): this {
    this.filters.push({ column, op: 'lte', value })
    return this
  }

  gte(column: string, value: unknown): this {
    this.filters.push({ column, op: 'gte', value })
    return this
  }

  order(column: string, opts?: { ascending?: boolean }): this {
    this.orderBy = { column, ascending: opts?.ascending ?? true }
    return this
  }

  limit(n: number): this {
    this.limitCount = n
    return this
  }

  /**
   * PostgREST's paging. Modelled because the writers use `fetchAll`, and a fake
   * that ignored `.range()` would make every pagination fix invisible.
   */
  range(from: number, to: number): this {
    this.rangeFrom = from
    this.rangeTo = to
    return this
  }

  is(column: string, value: unknown): this {
    if (value !== null) throw new Error('FakeOutcomesDb: .is() only models IS NULL')
    this.filters.push({ column, op: 'isNull', value: null })
    return this
  }

  delete(): this {
    this.mode = 'delete'
    return this
  }

  /**
   * UPDATE ... WHERE. Modelled because the writers claim rows an older
   * deployment left with a NULL `evaluator_key`, and a fake without it would
   * make that claim untestable. The CHECK constraints run against the MERGED
   * row, not the patch: setting an evaluator that does not own the row's
   * existing metric_key must fail here exactly as Postgres fails it.
   */
  update(patch: Row): this {
    this.mode = 'update'
    this.patch = patch
    return this
  }

  async maybeSingle(): Promise<{ data: Row | null; error: DbError | null }> {
    const { data, error } = await this.run()
    if (error) return { data: null, error }
    return { data: data?.[0] ?? null, error: null }
  }

  async insert(rows: Row | Row[]): Promise<{ data: null; error: DbError | null }> {
    const failure = this.db.takeFailure(this.table, 'insert')
    if (failure) return { data: null, error: { message: failure } }

    const list = Array.isArray(rows) ? rows : [rows]
    const target = this.db.rowsOf(this.table as ModelledTable)

    for (const row of list) {
      const violation = this.checkColumnConstraints(row)
      if (violation) return { data: null, error: violation }

      if (this.db.hasNaturalKeyConstraint() && this.findByNaturalKey(target, row)) {
        return {
          data: null,
          error: {
            message:
              'duplicate key value violates unique constraint "flywheel_outcomes_natural_key"',
          },
        }
      }
      target.push(this.materialise(row))
    }

    this.db.log({ table: this.table, op: 'insert', filters: [], rowCount: list.length })
    return { data: null, error: null }
  }

  async upsert(
    rows: Row | Row[],
    opts?: { onConflict?: string },
  ): Promise<{ data: null; error: DbError | null }> {
    const failure = this.db.takeFailure(this.table, 'upsert')
    if (failure) return { data: null, error: { message: failure } }

    const conflictCols = (opts?.onConflict ?? '')
      .split(',')
      .map(c => c.trim())
      .filter(Boolean)

    if (this.table === 'flywheel_outcomes') {
      if (conflictCols.length === 0) {
        // Without a conflict target PostgREST plain-inserts, which the unique
        // index then rejects on the second run.
        return {
          data: null,
          error: { message: 'upsert without onConflict target on flywheel_outcomes' },
        }
      }
      if (!this.db.hasNaturalKeyConstraint()) {
        // The blocker this rollout order exists to avoid: shipping the writers
        // before the constraint means Postgres has nothing to conflict on.
        return {
          data: null,
          error: {
            message:
              'there is no unique or exclusion constraint matching the ON CONFLICT specification',
          },
        }
      }
      // Postgres also rejects a conflict target that names the wrong columns
      // (42P10) — without this, a drifted target would silently merge across
      // windows here while erroring in production.
      const matchesNaturalKey =
        conflictCols.length === NATURAL_KEY_COLUMNS.length &&
        NATURAL_KEY_COLUMNS.every(c => conflictCols.includes(c))
      if (!matchesNaturalKey) {
        return {
          data: null,
          error: {
            message:
              'there is no unique or exclusion constraint matching the ON CONFLICT specification',
          },
        }
      }
    }

    const list = Array.isArray(rows) ? rows : [rows]
    const target = this.db.rowsOf(this.table as ModelledTable)

    for (const row of list) {
      const violation = this.checkColumnConstraints(row)
      if (violation) return { data: null, error: violation }

      const existing = target.find(r => conflictCols.every(c => r[c] === row[c]))
      if (existing) {
        // UPDATE in place: id and created_at survive — that is the whole point.
        Object.assign(existing, row)
        this.applyGenerated(existing)
      } else {
        target.push(this.materialise(row))
      }
    }

    this.db.log({ table: this.table, op: 'upsert', filters: [], rowCount: list.length })
    return { data: null, error: null }
  }

  /** NOT NULL / CHECK constraints as they exist in the current schema state. */
  private checkColumnConstraints(row: Row): DbError | null {
    if (this.table !== 'flywheel_outcomes') return null
    if (this.db.schema === 'pre_expand') return null

    const value = row.evaluator_key

    if (value === undefined || value === null) {
      if (this.db.evaluatorKeyIsRequired()) {
        return {
          message:
            'null value in column "evaluator_key" of relation "flywheel_outcomes" violates not-null constraint',
        }
      }
      return null // expand-phase CHECK admits NULL
    }

    if (!(EVALUATOR_VOCABULARY as readonly unknown[]).includes(value)) {
      return {
        message:
          'new row for relation "flywheel_outcomes" violates check constraint "flywheel_outcomes_evaluator_key_check"',
      }
    }

    if (value !== sqlMetricFamilyOwner(String(row.metric_key))) {
      return {
        message:
          'new row for relation "flywheel_outcomes" violates check constraint "flywheel_outcomes_evaluator_owns_metric"',
      }
    }
    return null
  }

  private materialise(row: Row): Row {
    const stored: Row = { id: this.db.nextId(), created_at: new Date().toISOString(), ...row }
    this.applyGenerated(stored)
    return stored
  }

  /** outcome_key is GENERATED ALWAYS — writers never supply it. */
  private applyGenerated(row: Row): void {
    if (this.table !== 'flywheel_outcomes') return
    if (this.db.schema === 'pre_expand') return
    row.outcome_key = `${row.action_id}:${row.metric_key}:${row.window_days}`
  }

  then<TResult1 = { data: Row[] | null; error: DbError | null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: Row[] | null; error: DbError | null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected)
  }

  // ── Execution ─────────────────────────────────────────────────────────────

  private findByNaturalKey(target: Row[], row: Row): Row | undefined {
    if (this.table !== 'flywheel_outcomes') return undefined
    return target.find(r => NATURAL_KEY_COLUMNS.every(c => r[c] === row[c]))
  }

  private async run(): Promise<{ data: Row[] | null; error: DbError | null }> {
    const target = this.db.rowsOf(this.table as ModelledTable)

    if (this.mode === 'delete') {
      const failure = this.db.takeFailure(this.table, 'delete')
      if (failure) return { data: null, error: { message: failure } }

      const kept = target.filter(r => !matches(r, this.filters))
      const removed = target.length - kept.length
      target.length = 0
      target.push(...kept)
      this.db.log({ table: this.table, op: 'delete', filters: this.filters, rowCount: removed })
      return { data: null, error: null }
    }

    if (this.mode === 'update') {
      const failure = this.db.takeFailure(this.table, 'update')
      if (failure) return { data: null, error: { message: failure } }

      const hit = target.filter(r => matches(r, this.filters))
      for (const row of hit) {
        const merged = { ...row, ...(this.patch ?? {}) }
        const violation = this.checkColumnConstraints(merged)
        if (violation) return { data: null, error: violation }
      }
      for (const row of hit) {
        Object.assign(row, this.patch ?? {})
        this.applyGenerated(row)
      }
      this.db.log({ table: this.table, op: 'update', filters: this.filters, rowCount: hit.length })
      return { data: null, error: null }
    }

    const selectFailure = this.db.takeFailure(this.table, 'select')
    if (selectFailure) return { data: null, error: { message: selectFailure } }

    let rows = target.filter(r => matches(r, this.filters))

    if (this.orderBy) {
      const { column, ascending } = this.orderBy
      rows = [...rows].sort((a, b) => {
        const c = compare(a[column], b[column])
        return ascending ? c : -c
      })
    }

    if (this.limitCount !== null) rows = rows.slice(0, this.limitCount)

    if (this.rangeFrom !== null) {
      rows = rows.slice(this.rangeFrom, (this.rangeTo ?? this.rangeFrom) + 1)
    } else if (rows.length > POSTGREST_MAX_ROWS) {
      // PostgREST's silent cap. Modelled so that a reader which forgets to
      // paginate gets a truncated result with no error — exactly what it gets
      // in production, and the only way a pagination fix is testable at all.
      rows = rows.slice(0, POSTGREST_MAX_ROWS)
    }

    this.db.log({ table: this.table, op: 'select', filters: this.filters, rowCount: rows.length })
    return { data: rows, error: null }
  }
}
