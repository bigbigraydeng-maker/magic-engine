// P21.J A3 — review-apply DB 层测试(魏征点名:approve $50 花钱闸 + 三 apply 无测试)
// review-apply 收 supabase 参数,直接传 thenable mock(await 链每次消费队列里下一个响应)。

import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { applyApprove, applyBudgetUpdate, applyQualityReject } from './review-apply'
import { ASSET_ONLY_NOT_PUBLISHABLE } from './deliverable'
import { REEL_AUTO_CHECK_KEYS, REEL_HUMAN_CHECK_KEYS_V2 } from '@/lib/social/content-review'

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
  output: { quality_checklist_auto: REEL_AUTO_CHECK_KEYS.map(key => ({ key, judge: 'AUTO', outcome: 'PASS', detail: 'measured', source_ref: null })) },
  brief: { segments: [] }, signal_id: 's-1', goal_id: 'g-1', master_brief_id: 'mb-1',
  winner_structure_id: null, order_type: 'fresh_angle', angle: 'X',
  angle_source: {}, rationale_one_liner: 'why', budget_cap_usd: 2, source_ad_id: 'ad-1',
}

const PASS_HUMAN = REEL_HUMAN_CHECK_KEYS_V2.map(key => ({
  key, judge: 'HUMAN' as const, outcome: 'PASS' as const, detail: null,
  source_ref: key.startsWith('factual_') ? 'https://example.test/source' : null,
}))
const FAIL_HUMAN = PASS_HUMAN.map(item => item.key === 'viral_recipe_hook_matched'
  ? { ...item, outcome: 'FAIL' as const, detail: 'Hook did not match recipe' }
  : { ...item, outcome: 'NOT_MEASURED' as const })
const approve = (db: SupabaseClient, id = 'wo-1', reviewer = 'me@x.com', clientId?: string) =>
  applyApprove(db, id, reviewer, clientId, PASS_HUMAN)
const reject = (db: SupabaseClient, id = 'wo-1', feedback = '画面太慢', reviewer = 'me@x.com', clientId?: string) =>
  applyQualityReject(db, id, feedback, reviewer, clientId, FAIL_HUMAN)

describe('applyApprove — 花钱闸(魏征红线③)', () => {
  it('in_review + 无 publish_budget → approved', async () => {
    const { db } = mockSupabase([{ data: IN_REVIEW_WO, error: null }, { data: [{ id: 'wo-1' }], error: null }])
    const r = await approve(db)
    expect(r.ok).toBe(true)
    expect(r.status).toBe(200)
  })

  it('🔴 publish_budget > $50 → 422 拦(服务端硬顶,前端绕不过)', async () => {
    const wo = { ...IN_REVIEW_WO, review_ref: { publish_budget_usd: 99 } }
    const { db } = mockSupabase([{ data: wo, error: null }])
    const r = await approve(db)
    expect(r.ok).toBe(false)
    expect(r.status).toBe(422)
  })

  it('publish_budget = $50 边界 → 放行', async () => {
    const wo = { ...IN_REVIEW_WO, review_ref: { publish_budget_usd: 50 } }
    const { db } = mockSupabase([{ data: wo, error: null }, { data: [{ id: 'wo-1' }], error: null }])
    expect((await approve(db)).ok).toBe(true)
  })

  it('缺失或未测自动媒体检查 → 直接调用 applyApprove 也会被拒', async () => {
    const missing = { ...IN_REVIEW_WO, output: {} }
    const missingDb = mockSupabase([{ data: missing, error: null }])
    expect((await approve(missingDb.db)).status).toBe(422)

    const unmeasured = {
      ...IN_REVIEW_WO,
      output: {
        quality_checklist_auto: IN_REVIEW_WO.output.quality_checklist_auto.map((item, index) =>
          index === 0 ? { ...item, outcome: 'NOT_MEASURED' } : item,
        ),
      },
    }
    const unmeasuredDb = mockSupabase([{ data: unmeasured, error: null }])
    expect((await approve(unmeasuredDb.db)).status).toBe(422)
  })

  it('非 in_review → 409', async () => {
    const { db } = mockSupabase([{ data: { ...IN_REVIEW_WO, status: 'approved' }, error: null }])
    const r = await approve(db)
    expect(r.ok).toBe(false)
    expect(r.status).toBe(409)
  })

  it('工单不存在 → 404', async () => {
    const { db } = mockSupabase([{ data: null, error: null }])
    expect((await approve(db, 'wo-x')).status).toBe(404)
  })

  it('clientId 不匹配 → 403(跨客户越权)', async () => {
    const { db } = mockSupabase([{ data: IN_REVIEW_WO, error: null }])
    expect((await approve(db, 'wo-1', 'me@x.com', 'other-client')).status).toBe(403)
  })

  it('update 0 行(被 sweeper 抢) → 409', async () => {
    const { db } = mockSupabase([{ data: IN_REVIEW_WO, error: null }, { data: [], error: null }])
    expect((await approve(db)).status).toBe(409)
  })

  it('asset_only 工单 → 409,不尝试 update', async () => {
    const assetOnly = { ...IN_REVIEW_WO, brief: { remotion: { deliverable: 'asset_only' } } }
    // Only the load response is queued: any further query would get the default
    // { data: null } and the happy path would fail, so a 409 proves no update ran.
    const { db } = mockSupabase([{ data: assetOnly, error: null }])
    const r = await approve(db)
    expect(r.ok).toBe(false)
    expect(r.status).toBe(409)
    // The guard's own message, not the generic "no longer in_review" a missing update would also give.
    expect(r.error).toBe(ASSET_ONLY_NOT_PUBLISHABLE)
  })

  it('deliverable 拼错(typo) → 走正常路径', async () => {
    const typo = { ...IN_REVIEW_WO, brief: { remotion: { deliverable: 'typo' } } }
    const { db } = mockSupabase([{ data: typo, error: null }, { data: [{ id: 'wo-1' }], error: null }])
    const r = await approve(db)
    expect(r.ok).toBe(true)
    expect(r.status).toBe(200)
  })
})

describe('applyQualityReject — 打回重开', () => {
  it('老单 review_rejected + 重开新单(意见进新 brief)', async () => {
    const { db, inserts } = mockSupabase([
      { data: IN_REVIEW_WO, error: null },       // load
      { data: [{ id: 'wo-1' }], error: null },   // update 老单
      { data: { id: 'wo-2' }, error: null },     // insert 新单
    ])
    const r = await reject(db)
    expect(r.ok).toBe(true)
    expect(r.data?.reopened_work_order_id).toBe('wo-2')
    // 意见进了新单 brief.review_feedback
    const reopened = inserts[0] as { brief: { review_feedback: string } }
    expect(reopened.brief.review_feedback).toBe('画面太慢')
  })

  it('🔴 R4 legacy 客户(无 recipe)打回 → 新单不带 recipe_replan_required / digest,legacy 路径继续', async () => {
    const legacyWo = { ...IN_REVIEW_WO, brief: { segments: [{ role: 'hook' }, { role: 'cta' }] } }
    const { db, inserts } = mockSupabase([
      { data: legacyWo, error: null },
      { data: [{ id: 'wo-1' }], error: null },
      { data: { id: 'wo-2' }, error: null },
    ])
    const r = await reject(db)
    expect(r.ok).toBe(true)
    expect(r.data?.recipe_replan_required).toBe(false)
    expect(r.data?.reopened_status).toBe('queued')
    expect(r.data?.parked_pending_replan).toBe(false)
    expect(r.data?.review_feedback_digest).toBeNull()
    const reopened = inserts[0] as {
      brief: {
        review_feedback: string
        recipe_replan_required?: boolean
        review_feedback_digest?: string
      }
    }
    expect(reopened.brief.review_feedback).toBe('画面太慢')
    // legacy 单里根本不应出现 recipe_replan_required / review_feedback_digest
    expect('recipe_replan_required' in reopened.brief).toBe(false)
    expect('review_feedback_digest' in reopened.brief).toBe(false)
  })

  it('🔴 R3/R4 recipe 客户打回 → 新单带 marker + digest,creative_recipe / segments / plan 全删', async () => {
    const recipeWo = {
      ...IN_REVIEW_WO,
      brief: {
        creative_recipe: { id: 'single_image_i2v_pullback_12s', version: 1 },
        segments: [{ role: 'hook' }, { role: 'cta' }],
        clip_generation_plan: [{ segment_role: 'hook', position: 0 }],
        max_new_clips: 2,
      },
    }
    const { db, inserts } = mockSupabase([
      { data: recipeWo, error: null },
      { data: [{ id: 'wo-1' }], error: null },
      { data: { id: 'wo-2' }, error: null },
    ])
    const r = await reject(db)
    expect(r.ok).toBe(true)
    expect(r.data?.recipe_replan_required).toBe(true)
    expect(r.data?.reopened_status).toBe('dead_letter')
    expect(r.data?.parked_pending_replan).toBe(true)
    expect(typeof r.data?.review_feedback_digest).toBe('string')
    expect((r.data?.review_feedback_digest as string)).toMatch(/^[0-9a-f]{64}$/)
    const reopened = inserts[0] as {
      brief: {
        recipe_replan_required?: boolean
        review_feedback_digest?: string
        creative_recipe?: unknown
        previous_creative_recipe?: unknown
        clip_generation_plan?: unknown
        segments?: unknown
        max_new_clips?: unknown
      }
    }
    expect(reopened.brief.recipe_replan_required).toBe(true)
    expect(reopened.brief.review_feedback_digest).toMatch(/^[0-9a-f]{64}$/)
    // 旧 recipe 存审计快照,但 top-level 已抹掉
    expect('creative_recipe' in reopened.brief).toBe(false)
    expect(reopened.brief.previous_creative_recipe).toEqual({ id: 'single_image_i2v_pullback_12s', version: 1 })
    // stale plan / segments / max_new_clips 一并删,防 assertRecipePlanShape 拿旧 plan 走通
    expect('clip_generation_plan' in reopened.brief).toBe(false)
    expect('segments' in reopened.brief).toBe(false)
    expect('max_new_clips' in reopened.brief).toBe(false)
    expect((inserts[0] as { status: string }).status).toBe('dead_letter')
  })

  it('R3 恰好非法 creative_recipe 的老单也当 recipe 单处理(强制 replan)', async () => {
    const badRecipeWo = {
      ...IN_REVIEW_WO,
      brief: { creative_recipe: { id: 'made_up', version: 42 } },
    }
    const { db, inserts } = mockSupabase([
      { data: badRecipeWo, error: null },
      { data: [{ id: 'wo-1' }], error: null },
      { data: { id: 'wo-2' }, error: null },
    ])
    const r = await reject(db, 'wo-1', '重来')
    expect(r.ok).toBe(true)
    expect(r.data?.recipe_replan_required).toBe(true)
    const reopened = inserts[0] as { brief: { recipe_replan_required?: boolean; review_feedback_digest?: string } }
    expect(reopened.brief.recipe_replan_required).toBe(true)
    expect(reopened.brief.review_feedback_digest).toMatch(/^[0-9a-f]{64}$/)
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
