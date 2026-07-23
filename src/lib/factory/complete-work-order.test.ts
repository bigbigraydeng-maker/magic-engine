// 2026-07-23 — completeWorkOrder 交付落点测试。
//
// 存在理由:审核搬进 ME 驾驶舱后,交付必须直接落 in_review。此前落 rendered、靠
// factory-review-sweeper 推 Airtable 时才改 in_review;Airtable 退役 + 该 cron 停调度后,
// rendered 成了死胡同 —— 成片永远进不了 /dashboard/factory 的审片队列(ReviewInbox 只筛
// in_review),整条产线静默断掉。这组测试就是钉死这个落点,防止再退回 rendered。
//
// mock 沿用 review-apply.test.ts 的 thenable 队列写法,额外捕获 update payload。

import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { completeWorkOrder } from './complete-work-order'

type Resp = { data: unknown; error: unknown }

/** 每个 await 的查询链消费队列里下一个响应;同时记录 update/insert 的 payload 和表名。 */
function mockSupabase(queue: Resp[]) {
  let i = 0
  const updates: Array<{ table: string; payload: Record<string, unknown> }> = []
  const inserts: Array<{ table: string; rows: unknown }> = []
  let table = ''
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'maybeSingle', 'single']) {
    builder[m] = () => builder
  }
  builder.update = (payload: Record<string, unknown>) => { updates.push({ table, payload }); return builder }
  builder.insert = (rows: unknown) => { inserts.push({ table, rows }); return builder }
  ;(builder as { then: unknown }).then = (resolve: (r: Resp) => unknown) =>
    resolve(queue[i++] ?? { data: null, error: null })
  const db = { from: (t: string) => { table = t; return builder } } as unknown as SupabaseClient
  return { db, updates, inserts }
}

const WO = {
  id: 'wo-1',
  client_id: 'c-1',
  master_brief_id: 'mb-1',
  status: 'producing',
  actual_cost_usd: 0,
  output: {},
  brief: { segments: [] },
}

const PARAMS = {
  wo: WO as Record<string, unknown>,
  workerId: 'worker-1',
  videoPath: 'c-1/final.mp4',
  segmentsPath: 'c-1/segments.json',
  srtPath: 'c-1/captions.srt',
  caption: 'A perfectly compliant caption.',
  actualCost: 0,
  newClips: [],
}

/** 无 clip、无花费时的最短查询序列:clients → master_briefs → content_work_orders.update */
function happyQueue(clientOverrides: Record<string, unknown> = {}): Resp[] {
  return [
    { data: { brand_redline_phrases: [], factory_config: {}, ...clientOverrides }, error: null },
    { data: { excluded_topics: [] }, error: null },
    { data: [{ id: 'wo-1' }], error: null },
  ]
}

describe('completeWorkOrder — 交付落点(防管道断裂)', () => {
  it('🔴 交付成功 → 工单写 in_review,不是 rendered', async () => {
    const { db, updates } = mockSupabase(happyQueue())
    const r = await completeWorkOrder(db, PARAMS)

    expect(r.ok).toBe(true)
    const wo = updates.find((u) => u.table === 'content_work_orders')
    expect(wo).toBeDefined()
    expect(wo!.payload.status).toBe('in_review')
    expect(wo!.payload.status).not.toBe('rendered')
  })

  it('🔴 返回值同样是 in_review(worker 日志/route 响应都读它)', async () => {
    const { db } = mockSupabase(happyQueue())
    const r = await completeWorkOrder(db, PARAMS)
    expect(r.ok && r.status).toBe('in_review')
  })

  it('命中红线不阻断交付,只写进 output.redline_hits(命中不打回,标红给人看)', async () => {
    const { db, updates } = mockSupabase(happyQueue({ brand_redline_phrases: ['affordable'] }))
    const r = await completeWorkOrder(db, { ...PARAMS, caption: 'Affordable floors today' })

    expect(r.ok).toBe(true)
    expect(r.ok && r.redlineHits).toEqual(['affordable'])
    const wo = updates.find((u) => u.table === 'content_work_orders')!
    expect(wo.payload.status).toBe('in_review')
    expect((wo.payload.output as Record<string, unknown>).redline_hits).toEqual(['affordable'])
  })

  it('红线查询失败 → 500 拒绝(fail-closed:查不到 ≠ 没有红线)', async () => {
    const { db, updates } = mockSupabase([{ data: null, error: { message: 'boom' } }])
    const r = await completeWorkOrder(db, PARAMS)

    expect(r.ok).toBe(false)
    expect(!r.ok && r.status).toBe(500)
    expect(updates.find((u) => u.table === 'content_work_orders')).toBeUndefined()
  })

  it('update 命中 0 行(工单被 sweeper 收回) → 409,不伪装成功', async () => {
    const q = happyQueue()
    q[2] = { data: [], error: null }
    const { db } = mockSupabase(q)
    const r = await completeWorkOrder(db, PARAMS)

    expect(r.ok).toBe(false)
    expect(!r.ok && r.status).toBe(409)
  })
})
