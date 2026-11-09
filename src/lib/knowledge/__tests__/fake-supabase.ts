/**
 * Minimal in-memory Supabase-like query builder for `src/lib/knowledge` tests.
 *
 * Scoped intentionally narrow — it only supports the exact operator chain
 * `read.ts` / `entitlement.ts` actually call (`select → eq* → lte? → or? →
 * order? → limit?`), not general PostgREST semantics. For a query against a
 * table this fake was never told about, it throws rather than returning an
 * empty result — an unmodelled table must look like a bug, not like "this
 * table is empty" (same reasoning as the kernel's own fake-supabase.ts).
 */

import type {
  KnowledgeFilterBuilder,
  KnowledgeQueryResult,
  KnowledgeSupabaseClient,
  KnowledgeTableHandle,
} from '../db-client'

export type Row = Record<string, unknown>

export interface FakeSupabaseOptions {
  /** Tables that should resolve with a Postgres-shaped error instead of data — for read-failure tests. */
  errorTables?: ReadonlySet<string>
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0
  if (a === null || a === undefined) return -1
  if (b === null || b === undefined) return 1
  return a < b ? -1 : 1
}

class FakeTableHandle implements KnowledgeTableHandle {
  constructor(
    private readonly rows: Row[],
    private readonly forceError: boolean,
  ) {}

  select(_columns: string): FakeQueryBuilder {
    return new FakeQueryBuilder(this.rows, this.forceError)
  }
}

class FakeQueryBuilder implements KnowledgeFilterBuilder {
  private filters: Array<(row: Row) => boolean> = []
  private orderCol: string | null = null
  private orderAscending = true
  private limitN: number | null = null

  constructor(
    private readonly rows: Row[],
    private readonly forceError: boolean,
  ) {}

  eq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value)
    return this
  }

  is(column: string, value: null): this {
    this.filters.push((row) => (row[column] ?? null) === value)
    return this
  }

  lte(column: string, value: string): this {
    this.filters.push((row) => {
      const v = row[column]
      return typeof v === 'string' && v <= value
    })
    return this
  }

  /** Only supports the one shape this codebase actually uses: `col.is.null,col.gt.<iso>`. */
  or(expr: string): this {
    const clauses = expr.split(',')
    this.filters.push((row) =>
      clauses.some((clause) => {
        const [column, op, rawValue] = clause.split('.')
        const value = row[column]
        if (op === 'is' && rawValue === 'null') return value === null || value === undefined
        if (op === 'gt') return typeof value === 'string' && value > rawValue
        throw new Error(`fake supabase: unsupported or() clause "${clause}"`)
      }),
    )
    return this
  }

  order(column: string, opts?: { ascending?: boolean }): this {
    this.orderCol = column
    this.orderAscending = opts?.ascending !== false
    return this
  }

  limit(n: number): this {
    this.limitN = n
    return this
  }

  then<TResult1 = KnowledgeQueryResult, TResult2 = never>(
    onfulfilled?: ((value: KnowledgeQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const result = this.forceError
      ? { data: null, error: { message: 'simulated read failure' } }
      : { data: this.resolveRows(), error: null }
    return Promise.resolve(result).then(onfulfilled, onrejected)
  }

  private resolveRows(): Row[] {
    let result = this.rows.filter((row) => this.filters.every((f) => f(row)))
    if (this.orderCol) {
      const col = this.orderCol
      const dir = this.orderAscending ? 1 : -1
      result = [...result].sort((a, b) => dir * compare(a[col], b[col]))
    }
    if (this.limitN !== null) result = result.slice(0, this.limitN)
    // Deep-clone so callers mutating a returned row can never corrupt the fixture.
    return result.map((row) => ({ ...row }))
  }
}

export class FakeSupabaseClient implements KnowledgeSupabaseClient {
  constructor(
    private readonly tables: Record<string, Row[]>,
    private readonly options: FakeSupabaseOptions = {},
  ) {}

  from(table: string): FakeTableHandle {
    const rows = this.tables[table]
    if (!rows) throw new Error(`fake supabase: unmodelled table "${table}"`)
    return new FakeTableHandle(rows, this.options.errorTables?.has(table) ?? false)
  }
}

export function createFakeSupabase(
  tables: Record<string, Row[]>,
  options?: FakeSupabaseOptions,
): KnowledgeSupabaseClient {
  return new FakeSupabaseClient(tables, options)
}
