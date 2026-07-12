// P21.J A3 — review-apply DB 层测试(魏征点名:approve $50 花钱闸 + 三 apply 无测试)
// review-apply 收 supabase 参数,直接传 thenable mock(await 链每次消费队列里下一个响应)。

import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { applyApprove, applyBudgetUpdate, applyQualityReject } from './review-apply'

type Resp = { data: unknown; error: unknown }

/** 每个 await 的查询链消费队列里下一个响应(按调用顺序)。 */
function mockSupabase(queue: Resp[]): { db: SupabaseClient; inserts: unknown[] } {
  let i = 0
  const inserts: unknown[] = []
  const builder: Record<string, unknown> = {}
  const passthrough = ['select', 'eq', 'in', 'order', 'limit', 'update', 'maybeSingle', 'single']
  for (const m of passthrough) builder[m] = () => builder
  builder.insert = (rows: unknown) => { inserts.push(rows); return builder }
  ;(builder as { then: unknown }).then = (resolve: (r: Resp) => unknown) =>
    resolve(queue[i++] ?? { data: null, error: null })
  const db = { from: () => builder } as unknown as SupabaseClient
  return { db, inserts }
}

const IN_REVIEW_WO = {
  id: 'wo-1', client_id: 'c-1', status: 'in_review', review_ref: {},
  brief: { segments: [] }, signal_id: 's-1', goal_id: 'g-1', master_brief_id: 'mb-1',
  winner_structure_id: null, order_type: 'fresh_angle', angle: 'X',
  angle_source: {}, rationale_one_liner: 'why', budget_cap_usd: 2, source_ad_id: 'ad-1',
}

describe('applyApprove — 花钱闸(魏征红线③)', () => {
  it('in_review + 无 publish_budget → approved', async () => {
    const { db } = mockSupabase([{ data: IN_REVIEW_WO, error: null }, { data: [{ id: 'wo-1' }], error: null }])
    const r = await applyApprove(db, 'wo-1', 'me@x.com')
    expect(r.ok).toBe(true)
    expect(r.status).toBe(200)
  })

  it('🔴 publish_budget > $50 → 422 拦(服务端硬顶,前端绕不过)', async () => {
    const wo = { ...IN_REVIEW_WO, review_ref: { publish_budget_usd: 99 } }
    const { db } = mockSupabase([{ data: wo, error: null }])
    const r = await applyApprove(db, 'wo-1', 'me@x.com')
    expect(r.ok).toBe(false)
    expect(r.status).toBe(422)
  })

  it('publish_budget = $50 边界 → 放行', async () => {
    const wo = { ...IN_REVIEW_WO, review_ref: { publish_budget_usd: 50 } }
    const { db } = mockSupabase([{ data: wo, error: null }, { data: [{ id: 'wo-1' }], error: null }])
    expect((await applyApprove(db, 'wo-1', 'me@x.com')).ok).toBe(true)
  })

  it('非 in_review → 409', async () => {
    const { db } = mockSupabase([{ data: { ...IN_REVIEW_WO, status: 'approved' }, error: null }])
    const r = await applyApprove(db, 'wo-1', 'me@x.com')
    expect(r.ok).toBe(false)
    expect(r.status).toBe(409)
  })

  it('工单不存在 → 404', async () => {
    const { db } = mockSupabase([{ data: null, error: null }])
    expect((await applyApprove(db, 'wo-x', 'me@x.com')).status).toBe(404)
  })

  it('clientId 不匹配 → 403(跨客户越权)', async () => {
    const { db } = mockSupabase([{ data: IN_REVIEW_WO, error: null }])
    expect((await applyApprove(db, 'wo-1', 'me@x.com', 'other-client')).status).toBe(403)
  })

  it('update 0 行(被 sweeper 抢) → 409', async () => {
    const { db } = mockSupabase([{ data: IN_REVIEW_WO, error: null }, { data: [], error: null }])
    expect((await applyApprove(db, 'wo-1', 'me@x.com')).status).toBe(409)
  })
})

describe('applyQualityReject — 打回重开', () => {
  it('老单 review_rejected + 重开新单(意见进新 brief)', async () => {
    const { db, inserts } = mockSupabase([
      { data: IN_REVIEW_WO, error: null },       // load
      { data: [{ id: 'wo-1' }], error: null },   // update 老单
      { data: { id: 'wo-2' }, error: null },     // insert 新单
    ])
    const r = await applyQualityReject(db, 'wo-1', '画面太慢', 'me@x.com')
    expect(r.ok).toBe(true)
    expect(r.data?.reopened_work_order_id).toBe('wo-2')
    // 意见进了新单 brief.review_feedback
    const reopened = inserts[0] as { brief: { review_feedback: string } }
    expect(reopened.brief.review_feedback).toBe('画面太慢')
  })
})

describe('applyBudgetUpdate — 只改预算不重生产', () => {
  it('in_review → 回 in_review,预算入 review_ref', async () => {
    const { db } = mockSupabase([{ data: IN_REVIEW_WO, error: null }, { data: [{ id: 'wo-1' }], error: null }])
    const r = await applyBudgetUpdate(db, 'wo-1', 20, 'me@x.com')
    expect(r.ok).toBe(true)
    expect(r.data?.publish_budget_usd).toBe(20)
  })
})
