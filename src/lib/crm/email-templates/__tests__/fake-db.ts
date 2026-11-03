import type { SupabaseClient } from '@supabase/supabase-js'

export type FakeRow = Record<string, unknown>

export interface FakeDbOptions {
  seed?: Record<string, FakeRow[]>
  // per table: list of unique keys; each key is a list of column names
  unique?: Record<string, string[][]>
  // per table: columns whose null is treated as '' when checking unique keys (models coalesce(col, ''))
  coalesceNull?: Record<string, string[]>
  // every operation touching this table resolves to { data: null, error: { code: 'XX000', message: 'boom' } }
  failTable?: string
  // the error code carried by failTable errors (default XX000)
  failCode?: string
}

export interface FakeCall {
  table: string
  op: 'select' | 'insert'
  filters: Array<{ kind: 'eq' | 'gte' | 'in' | 'not'; col: string; value: unknown }>
}

export interface FakeDb {
  db: SupabaseClient
  tables: Record<string, FakeRow[]>
  calls: FakeCall[]
}

interface FakeError {
  code: string
  message: string
}

interface FakeResult {
  data: unknown
  error: FakeError | null
}

type Filter = FakeCall['filters'][number]

const FAIL_ERROR: FakeError = { code: 'XX000', message: 'boom' }
const DUPLICATE_ERROR: FakeError = {
  code: '23505',
  message: 'duplicate key value violates unique constraint',
}
const NO_ROWS_ERROR: FakeError = { code: 'PGRST116', message: 'no rows' }
const MULTIPLE_ROWS_ERROR: FakeError = { code: 'PGRST116', message: 'multiple rows' }

function shallowCopy(row: FakeRow): FakeRow {
  return { ...row }
}

function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : 1
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : 1
  return String(a) < String(b) ? -1 : 1
}

function matchesFilter(row: FakeRow, filter: Filter): boolean {
  const value = row[filter.col]
  if (filter.kind === 'eq') return value === filter.value
  if (filter.kind === 'gte') return compareValues(value, filter.value) >= 0
  if (filter.kind === 'in') {
    const list = Array.isArray(filter.value) ? filter.value : []
    return list.includes(value)
  }
  // 'not' is only used as not(col, 'is', null): keep rows whose column is neither null nor undefined
  return value !== null && value !== undefined
}

function applyOrder(rows: FakeRow[], col: string, ascending: boolean): FakeRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const cmp = compareValues(a.row[col], b.row[col])
      if (cmp !== 0) return ascending ? cmp : -cmp
      return a.index - b.index
    })
    .map((entry) => entry.row)
}

function uniqueValue(value: unknown, coalesce: boolean): unknown {
  return coalesce && (value === null || value === undefined) ? '' : value
}

function violatesUnique(
  table: string,
  candidate: FakeRow,
  existing: FakeRow[],
  options: FakeDbOptions,
): boolean {
  const keys = options.unique?.[table] ?? []
  const coalesceCols = options.coalesceNull?.[table] ?? []
  return keys.some((key) =>
    existing.some((row) =>
      key.every((col) => {
        const coalesce = coalesceCols.includes(col)
        return uniqueValue(row[col], coalesce) === uniqueValue(candidate[col], coalesce)
      }),
    ),
  )
}

function prepareInsertRow(row: FakeRow): FakeRow {
  const copy = shallowCopy(row)
  if (copy.id === undefined) copy.id = crypto.randomUUID()
  if (copy.created_at === undefined) copy.created_at = new Date().toISOString()
  return copy
}

interface BuilderState {
  table: string
  op: 'select' | 'insert'
  filters: Filter[]
  orderCol: string | null
  orderAscending: boolean
  limitCount: number | null
  pendingInsert: FakeRow[]
  wantsSelect: boolean
}

function resolveSelect(state: BuilderState, tables: Record<string, FakeRow[]>): FakeResult {
  let rows = (tables[state.table] ?? []).filter((row) =>
    state.filters.every((f) => matchesFilter(row, f)),
  )
  if (state.orderCol !== null) rows = applyOrder(rows, state.orderCol, state.orderAscending)
  if (state.limitCount !== null) rows = rows.slice(0, state.limitCount)
  return { data: rows.map(shallowCopy), error: null }
}

// The insert happens at execution time (await / single / maybeSingle), never when .insert() is called.
function resolveInsert(
  state: BuilderState,
  tables: Record<string, FakeRow[]>,
  options: FakeDbOptions,
): FakeResult {
  const existing = tables[state.table] ?? []
  const accepted: FakeRow[] = []
  for (const row of state.pendingInsert) {
    if (violatesUnique(state.table, row, [...existing, ...accepted], options)) {
      return { data: null, error: DUPLICATE_ERROR }
    }
    accepted.push(row)
  }
  tables[state.table] = [...existing, ...accepted]
  return state.wantsSelect
    ? { data: accepted.map(shallowCopy), error: null }
    : { data: null, error: null }
}

function singleResult(result: FakeResult, allowEmpty: boolean): FakeResult {
  if (result.error !== null) return result
  const rows = Array.isArray(result.data) ? (result.data as FakeRow[]) : []
  if (rows.length === 0) {
    return allowEmpty ? { data: null, error: null } : { data: null, error: NO_ROWS_ERROR }
  }
  if (rows.length > 1) return { data: null, error: MULTIPLE_ROWS_ERROR }
  return { data: rows[0], error: null }
}

function makeBuilder(
  table: string,
  tables: Record<string, FakeRow[]>,
  calls: FakeCall[],
  options: FakeDbOptions,
): unknown {
  const state: BuilderState = {
    table,
    op: 'select',
    filters: [],
    orderCol: null,
    orderAscending: true,
    limitCount: null,
    pendingInsert: [],
    wantsSelect: false,
  }

  const run = (): FakeResult => {
    calls.push({ table, op: state.op, filters: state.filters.map((f) => ({ ...f })) })
    if (options.failTable === table) return { data: null, error: options.failCode ? { ...FAIL_ERROR, code: options.failCode } : FAIL_ERROR }
    return state.op === 'insert' ? resolveInsert(state, tables, options) : resolveSelect(state, tables)
  }

  const builder: Record<string, unknown> = {}
  builder.select = (_columns?: string): unknown => {
    state.wantsSelect = true
    return builder
  }
  builder.insert = (rowOrRows: FakeRow | FakeRow[]): unknown => {
    state.op = 'insert'
    state.pendingInsert = (Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]).map(prepareInsertRow)
    return builder
  }
  builder.eq = (col: string, value: unknown): unknown => {
    state.filters.push({ kind: 'eq', col, value })
    return builder
  }
  builder.gte = (col: string, value: unknown): unknown => {
    state.filters.push({ kind: 'gte', col, value })
    return builder
  }
  builder.in = (col: string, values: unknown[]): unknown => {
    state.filters.push({ kind: 'in', col, value: values })
    return builder
  }
  builder.not = (col: string, operator: string, value: unknown): unknown => {
    if (operator === 'is' && value === null) state.filters.push({ kind: 'not', col, value: null })
    return builder
  }
  builder.order = (col: string, opts?: { ascending?: boolean }): unknown => {
    if (state.orderCol === null) {
      state.orderCol = col
      state.orderAscending = opts?.ascending ?? true
    }
    return builder
  }
  builder.limit = (n: number): unknown => {
    state.limitCount = n
    return builder
  }
  builder.maybeSingle = (): Promise<FakeResult> => Promise.resolve(singleResult(run(), true))
  builder.single = (): Promise<FakeResult> => Promise.resolve(singleResult(run(), false))
  builder.then = (
    onFulfilled: (value: FakeResult) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ): Promise<unknown> => Promise.resolve(run()).then(onFulfilled, onRejected)

  return builder
}

export function createFakeDb(options: FakeDbOptions = {}): FakeDb {
  const tables: Record<string, FakeRow[]> = {}
  for (const [table, rows] of Object.entries(options.seed ?? {})) {
    tables[table] = rows.map(shallowCopy)
  }
  const calls: FakeCall[] = []
  const loose: unknown = { from: (table: string): unknown => makeBuilder(table, tables, calls, options) }
  return { db: loose as SupabaseClient, tables, calls }
}
