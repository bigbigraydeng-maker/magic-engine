/**
 * 按**表**建模的假 Supabase —— 不是按调用次序建模。
 *
 * 按次序录制的假客户端只能证明「代码调了这些方法」，证明不了「查询条件写对了」：
 * 把 `.eq('is_active', true)` 删掉，录制式假客户端照样绿。这里存真行、真过滤，
 * 所以过滤条件写错时测试会红。
 *
 * 刻意**不**实现 20260812100000 里那两个跨表互斥触发器。触发器是兜底，
 * 应用层自己就必须把正反经验对账对。在这个假客户端上绿，说明的是应用层单独
 * 也站得住 —— 而不是「靠触发器兜住了」。
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type Row = Record<string, unknown>
export type FakeDb = Record<string, Row[]>

interface Filter {
  op: 'eq' | 'neq' | 'in' | 'is' | 'gte' | 'lte' | 'lt' | 'gt'
  col: string
  val: unknown
}

export interface FakeOptions {
  /** 让这些表的 SELECT 报错，用来测「读不到存量时的行为」。 */
  failSelectOn?: string[]
  /** UPDATEs on these tables return an error result and change nothing. */
  failUpdateOn?: string[]
  /** UPDATEs on these tables throw (the awaited query rejects) and change nothing. */
  throwUpdateOn?: string[]
  /**
   * Per-table column lists. For a table listed here, `select(cols)` projects each row to
   * exactly those columns (supporting `alias:col`, `col->>key` and `alias:col->>key`) and
   * rejects any column not in the list — like PostgREST does. Tables not listed keep the
   * old behaviour of returning whole rows.
   */
  schema?: Record<string, readonly string[]>
}

function matches(row: Row, f: Filter): boolean {
  const v = row[f.col]
  switch (f.op) {
    case 'eq':  return v === f.val
    case 'neq': return v !== f.val
    case 'is':  return v === f.val || (f.val === null && v === undefined)
    case 'in':  return Array.isArray(f.val) && f.val.includes(v)
    case 'gte': return String(v) >= String(f.val)
    case 'lte': return String(v) <= String(f.val)
    case 'lt':  return String(v) <  String(f.val)
    case 'gt':  return String(v) >  String(f.val)
  }
}

export function makeFakeSupabase(db: FakeDb, options: FakeOptions = {}): SupabaseClient {
  let seq = 0
  const failSelect = new Set(options.failSelectOn ?? [])
  const failUpdate = new Set(options.failUpdateOn ?? [])
  const throwUpdate = new Set(options.throwUpdateOn ?? [])

  function from(table: string) {
    let mode: 'select' | 'insert' | 'update' = 'select'
    let payload: Row = {}
    const filters: Filter[] = []
    let orderBy: { col: string; ascending: boolean } | null = null
    let limitN: number | null = null
    let projection: string | null = null
    let rangeFrom: number | null = null
    let rangeTo: number | null = null

    const rowsOf = (): Row[] => (db[table] ??= [])
    const hits = (): Row[] => rowsOf().filter(r => filters.every(f => matches(r, f)))

    function run(): { data: Row[] | null; error: { message: string } | null } {
      if (mode === 'insert') {
        seq++
        // id / created_at / is_active 的默认值模拟建表 DDL：写入方不传时由 DB 给。
        const row: Row = {
          id: `row-${seq}`,
          created_at: `2026-01-${String(seq).padStart(2, '0')}T00:00:00Z`,
          is_active: true,
          ...payload,
        }
        rowsOf().push(row)
        return { data: [{ ...row }], error: null }
      }

      if (mode === 'update') {
        if (throwUpdate.has(table)) throw new Error(`simulated update exception on ${table}`)
        if (failUpdate.has(table)) return { data: null, error: { message: `simulated update failure on ${table}` } }
        const hit = hits()
        for (const r of hit) Object.assign(r, payload)
        return { data: hit.map(r => ({ ...r })), error: null }
      }

      if (failSelect.has(table)) {
        return { data: null, error: { message: `simulated read failure on ${table}` } }
      }

      let rows = hits().map(r => ({ ...r }))
      if (orderBy) {
        const { col, ascending } = orderBy
        rows.sort((a, b) => {
          // Postgres default: NULLS LAST when ascending, NULLS FIRST when descending.
          const aNull = a[col] === null || a[col] === undefined
          const bNull = b[col] === null || b[col] === undefined
          if (aNull || bNull) {
            if (aNull && bNull) return 0
            return (aNull ? 1 : -1) * (ascending ? 1 : -1)
          }
          const av = String(a[col])
          const bv = String(b[col])
          return ascending ? (av < bv ? -1 : av > bv ? 1 : 0) : (av > bv ? -1 : av < bv ? 1 : 0)
        })
      }
      if (limitN != null) rows = rows.slice(0, limitN)
      if (rangeFrom != null && rangeTo != null) rows = rows.slice(rangeFrom, rangeTo + 1)

      const columns = options.schema?.[table]
      if (columns && projection && projection !== '*') {
        const items = projection
          .split(',')
          .map(s => s.trim())
          .filter(s => s.length > 0)

        // Like PostgREST, an unknown column is an error even when no row matches.
        for (const item of items) {
          const source = item.includes(':') ? item.slice(item.indexOf(':') + 1).trim() : item
          const col = source.includes('->>') ? source.slice(0, source.indexOf('->>')).trim() : source
          if (!columns.includes(col)) {
            return { data: null, error: { message: `column ${table}.${col} does not exist` } }
          }
        }

        const projected: Row[] = []
        for (const row of rows) {
          const out: Row = {}
          for (const item of items) {
            const colon = item.indexOf(':')
            const alias = colon === -1 ? null : item.slice(0, colon).trim()
            const source = colon === -1 ? item : item.slice(colon + 1).trim()

            const arrow = source.indexOf('->>')
            if (arrow !== -1) {
              const col = source.slice(0, arrow).trim()
              const key = source.slice(arrow + 3).trim()
              if (!columns.includes(col)) {
                return { data: null, error: { message: `column ${table}.${col} does not exist` } }
              }
              const raw = (row[col] as Record<string, unknown> | null | undefined)?.[key]
              out[alias ?? key] = raw === null || raw === undefined ? null : String(raw)
            } else {
              const col = source
              if (!columns.includes(col)) {
                return { data: null, error: { message: `column ${table}.${col} does not exist` } }
              }
              out[alias ?? col] = row[col] ?? null
            }
          }
          projected.push(out)
        }
        return { data: projected, error: null }
      }

      return { data: rows, error: null }
    }

    const builder: Record<string, unknown> = {
      select(cols?: string) {
        if (mode === 'select' && typeof cols === 'string') projection = cols
        return builder
      },
      insert(p: Row) { mode = 'insert'; payload = p; return builder },
      update(p: Row) { mode = 'update'; payload = p; return builder },
      eq(col: string, val: unknown)  { filters.push({ op: 'eq', col, val });  return builder },
      neq(col: string, val: unknown) { filters.push({ op: 'neq', col, val }); return builder },
      in(col: string, val: unknown)  { filters.push({ op: 'in', col, val });  return builder },
      is(col: string, val: unknown)  { filters.push({ op: 'is', col, val });  return builder },
      gte(col: string, val: unknown) { filters.push({ op: 'gte', col, val }); return builder },
      lte(col: string, val: unknown) { filters.push({ op: 'lte', col, val }); return builder },
      lt(col: string, val: unknown)  { filters.push({ op: 'lt', col, val });  return builder },
      gt(col: string, val: unknown)  { filters.push({ op: 'gt', col, val });  return builder },
      not() { return builder },
      or()  { return builder },
      order(col: string, opts?: { ascending?: boolean }) {
        orderBy = { col, ascending: opts?.ascending ?? true }
        return builder
      },
      limit(n: number) { limitN = n; return builder },
      range(from: number, to: number) { rangeFrom = from; rangeTo = to; return builder },
      // Type-only helper on the real builder (returns itself at runtime).
      overrideTypes() { return builder },
      single() {
        const { data, error } = run()
        return Promise.resolve({ data: data?.[0] ?? null, error })
      },
      maybeSingle() {
        const { data, error } = run()
        return Promise.resolve({ data: data?.[0] ?? null, error })
      },
      then(resolve: (r: { data: Row[] | null; error: { message: string } | null }) => void) {
        resolve(run())
      },
    }
    return builder
  }

  return { from } as unknown as SupabaseClient
}

/** A completed attribution run one hour before `now`, with no GSC errors. */
export function healthyAttributionRun(now: Date): Row {
  const finished = new Date(now.getTime() - 3_600_000).toISOString()
  return {
    id: 'attribution-run-1',
    job_name: 'attribution-cron',
    status: 'completed',
    started_at: finished,
    finished_at: finished,
    summary: { gsc: { errors: [] } },
  }
}
