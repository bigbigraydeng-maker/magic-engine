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

  function from(table: string) {
    let mode: 'select' | 'insert' | 'update' = 'select'
    let payload: Row = {}
    const filters: Filter[] = []
    let orderBy: { col: string; ascending: boolean } | null = null
    let limitN: number | null = null

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
          const av = String(a[col] ?? '')
          const bv = String(b[col] ?? '')
          return ascending ? (av < bv ? -1 : av > bv ? 1 : 0) : (av > bv ? -1 : av < bv ? 1 : 0)
        })
      }
      if (limitN != null) rows = rows.slice(0, limitN)
      return { data: rows, error: null }
    }

    const builder: Record<string, unknown> = {
      select() { return builder },
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
