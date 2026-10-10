/**
 * 广告账户绑定测试专用的「按表建模」假 Supabase。
 *
 * 为什么不用录制式 mock（魏征 2026-09-13 设计审）：重复登记检查里的
 * 「排除本客户」「统一格式后比对」、待处理请求里的「按客户取最新一行」，
 * 在录制式 mock 上删掉照样绿。这里存真行、按条件真过滤，删掉就会红。
 *
 * 在 src/lib/memory/__tests__/fake-supabase.ts 的基础上补了本功能要用的
 * upsert / range / not(col,'is',null)，以及按表注入写/读失败。
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type Row = Record<string, unknown>
export type FakeDb = Record<string, Row[]>

type Op = 'eq' | 'in' | 'gte' | 'notNull'
interface Filter { op: Op; col: string; val: unknown }

export interface FakeFailures {
  select?: Set<string>
  insert?: Set<string>
  update?: Set<string>
  upsert?: Set<string>
  delete?: Set<string>
}

interface Result { data: Row[] | null; error: { message: string } | null }

function matches(row: Row, f: Filter): boolean {
  const v = row[f.col]
  if (f.op === 'eq') return v === f.val
  if (f.op === 'in') return Array.isArray(f.val) && f.val.includes(v)
  if (f.op === 'gte') return String(v) >= String(f.val)
  return v !== null && v !== undefined
}

// Module-level so rows inserted through separate from() calls get strictly
// increasing ids/timestamps (newest-row-wins logic depends on it). Real wall
// clock, not a fixed date: the pending-request window is relative to now.
let seq = 0
let lastTs = 0

export function makeBindingFakeDb(db: FakeDb, failures: FakeFailures = {}) {
  const fail = (kind: keyof FakeFailures, table: string): Result | null =>
    failures[kind]?.has(table) ? { data: null, error: { message: `simulated ${kind} failure on ${table}` } } : null

  function from(table: string) {
    let mode: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select'
    let payload: Row = {}
    let conflictCols: string[] = []
    const filters: Filter[] = []
    const orders: { col: string; asc: boolean }[] = []
    let range: [number, number] | null = null
    let limitN: number | null = null
    const rows = (): Row[] => (db[table] ??= [])
    const hits = () => rows().filter(r => filters.every(f => matches(r, f)))

    function insertRow(p: Row): Row {
      seq++
      lastTs = Math.max(Date.now(), lastTs + 1)
      const row: Row = { id: `${table}-${seq}`, created_at: new Date(lastTs).toISOString(), ...p }
      rows().push(row)
      return row
    }

    function run(): Result {
      const injected = fail(mode, table)
      if (injected) return injected
      if (mode === 'insert') return { data: [{ ...insertRow(payload) }], error: null }
      if (mode === 'update') {
        const hit = hits()
        for (const r of hit) Object.assign(r, payload)
        return { data: hit.map(r => ({ ...r })), error: null }
      }
      if (mode === 'delete') {
        const hit = new Set(hits())
        db[table] = rows().filter(r => !hit.has(r))
        return { data: [...hit].map(r => ({ ...r })), error: null }
      }
      if (mode === 'upsert') {
        const existing = rows().find(r => conflictCols.every(c => r[c] === payload[c]))
        if (existing) Object.assign(existing, payload)
        return { data: [{ ...(existing ?? insertRow(payload)) }], error: null }
      }
      let out = hits().map(r => ({ ...r }))
      if (orders.length > 0) {
        out.sort((a, b) => {
          for (const { col, asc } of orders) {
            const c = String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0
            if (c !== 0) return asc ? c : -c
          }
          return 0
        })
      }
      if (range) out = out.slice(range[0], range[1] + 1)
      if (limitN != null) out = out.slice(0, limitN)
      return { data: out, error: null }
    }

    const b: Record<string, unknown> = {
      select() { return b },
      insert(p: Row) { mode = 'insert'; payload = p; return b },
      update(p: Row) { mode = 'update'; payload = p; return b },
      delete() { mode = 'delete'; return b },
      upsert(p: Row, opts?: { onConflict?: string }) {
        mode = 'upsert'; payload = p; conflictCols = (opts?.onConflict ?? 'id').split(','); return b
      },
      eq(col: string, val: unknown) { filters.push({ op: 'eq', col, val }); return b },
      in(col: string, val: unknown) { filters.push({ op: 'in', col, val }); return b },
      gte(col: string, val: unknown) { filters.push({ op: 'gte', col, val }); return b },
      not(col: string, operator: string, val: unknown) {
        if (operator !== 'is' || val !== null) throw new Error(`fake: unsupported not(${operator})`)
        filters.push({ op: 'notNull', col, val }); return b
      },
      order(col: string, opts?: { ascending?: boolean }) { orders.push({ col, asc: opts?.ascending ?? true }); return b },
      range(from: number, to: number) { range = [from, to]; return b },
      limit(n: number) { limitN = n; return b },
      single() { const r = run(); return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error }) },
      maybeSingle() { const r = run(); return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error }) },
      then(resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) {
        try { return Promise.resolve(resolve(run())) } catch (e) { return reject ? reject(e) : Promise.reject(e) }
      },
    }
    return b
  }

  return { from }
}

/**
 * 给「由调用方传入 SupabaseClient」的函数（binding-requests.ts）用。
 * 假件只实现了被测代码真正调用的查询子集，类型上必然对不上完整客户端 ——
 * 这不是掩盖接口错配：形状是否够用由行为测试证伪（少实现一个方法会直接抛
 * `is not a function`），过滤条件写对没有由变异验证锁住（见 PR 描述）。
 */
export function asSupabaseClient(fake: ReturnType<typeof makeBindingFakeDb>): SupabaseClient {
  return fake as unknown as SupabaseClient
}
