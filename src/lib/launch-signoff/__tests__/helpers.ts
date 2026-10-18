/**
 * 测试替身：内存里的“生产库”，只实现 launch-signoff 用到的那几个 PostgREST 调用。
 * （有意不造完整 SupabaseClient；用 as unknown as 强转，并用行为断言兜底。）
 */
import type { SupabaseClient } from '@supabase/supabase-js'

type Row = Record<string, unknown>

export function fakeProd(tables: Record<string, Row[]> = {}) {
  const data: Record<string, Row[]> = { launch_signoff_events: [], ...tables }
  let nextId = 1

  class Query implements PromiseLike<{ data: unknown; error: { message: string } | null }> {
    private eqs: Array<[string, unknown]> = []
    private rng: [number, number] | null = null
    private lim: number | null = null
    private orderBy: { col: string; asc: boolean } | null = null
    private pending: Row | null = null
    private wantSingle = false
    constructor(private table: string) {}
    select(): this { return this }
    insert(row: Row): this { this.pending = row; return this }
    single(): this { this.wantSingle = true; return this }
    eq(c: string, v: unknown): this { this.eqs.push([c, v]); return this }
    order(c: string, o?: { ascending?: boolean }): this { this.orderBy = { col: c, asc: o?.ascending !== false }; return this }
    range(a: number, b: number): this { this.rng = [a, b]; return this }
    limit(n: number): this { this.lim = n; return this }
    then<R1, R2>(
      ok?: ((v: { data: unknown; error: { message: string } | null }) => R1 | PromiseLike<R1>) | null,
      bad?: ((e: unknown) => R2 | PromiseLike<R2>) | null,
    ): PromiseLike<R1 | R2> {
      if (this.pending) {
        const row = { ...this.pending, id: nextId++, created_at: new Date(2026, 9, 19, 12, 0, nextId).toISOString() }
        ;(data[this.table] ??= []).push(row)
        return Promise.resolve({ data: this.wantSingle ? row : [row], error: null }).then(ok, bad)
      }
      let rows = [...(data[this.table] ?? [])]
      for (const [c, v] of this.eqs) rows = rows.filter((r) => r[c] === v)
      if (this.orderBy) {
        const { col, asc } = this.orderBy
        rows.sort((a, b) => ((a[col] as number) < (b[col] as number) ? -1 : 1) * (asc ? 1 : -1))
      }
      if (this.rng) rows = rows.slice(this.rng[0], this.rng[1] + 1)
      if (this.lim !== null) rows = rows.slice(0, this.lim)
      return Promise.resolve({ data: rows, error: null }).then(ok, bad)
    }
  }
  const db = { from: (t: string) => new Query(t) } as unknown as SupabaseClient
  return { db, data }
}

export const RUN_ID = '11111111-1111-4111-8111-111111111111'
export const OTHER_RUN_ID = '22222222-2222-4222-8222-222222222222'
export const DECISION_ID = '33333333-3333-4333-8333-333333333333'
export const DECISION_ID_2 = '55555555-5555-4555-8555-555555555555'
export const ALLOW_DECISION_ID = '66666666-6666-4666-8666-666666666666'
export const NARRATIVE_ID = '44444444-4444-4444-8444-444444444444'
/** 清单指定的目标客户（NAL） */
export const CLIENT_ID = '4ae76381-cd45-43bd-85cd-98cfd7604007'
export const OTHER_CLIENT_ID = '99999999-9999-4999-8999-999999999999'
export const ROUND_OK = '2026-10-20T03:00:00Z' // 本轮开始（2026-10-19）之后
export const ROUND_OLD = '2026-09-01T03:00:00Z' // 本轮之前

/** 一份能通过 T1/T3/T4/T5 回读、并能给 T2/T6/T7 人工确认项做 recordRef 的“生产数据”。 */
export function healthyProdTables(): Record<string, Row[]> {
  return {
    ad_health_narratives: [
      { id: NARRATIVE_ID, client_id: CLIENT_ID, insight_date: '2026-10-20', overall_verdict: 'healthy', created_at: ROUND_OK },
    ],
    action_runs: [
      { id: RUN_ID, client_id: CLIENT_ID, action_key: 'ads.pause_campaign', status: 'succeeded', created_at: ROUND_OK, finished_at: ROUND_OK },
      { id: OTHER_RUN_ID, client_id: OTHER_CLIENT_ID, action_key: 'ads.pause_campaign', status: 'succeeded', created_at: ROUND_OK, finished_at: ROUND_OK },
    ],
    action_run_steps: [{ run_id: RUN_ID, step_key: 'readback_campaign', status: 'succeeded', verification: { passed: true, method: 'meta_readback', checks: [] } }],
    flywheel_actions: [{ id: 'f1', client_id: CLIENT_ID, action_run_id: RUN_ID, action_type: 'pause', executed_at: ROUND_OK }],
    authorization_decisions: [
      { id: DECISION_ID, client_id: CLIENT_ID, created_at: ROUND_OK, verdict: 'deny' },
      { id: DECISION_ID_2, client_id: CLIENT_ID, created_at: ROUND_OK, verdict: 'deny' },
      { id: ALLOW_DECISION_ID, client_id: CLIENT_ID, created_at: ROUND_OK, verdict: 'allow' },
    ],
  }
}
