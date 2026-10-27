// P21.J A3 — review-apply DB 层测试(魏征点名:approve $50 花钱闸 + 三 apply 无测试)
// review-apply 收 supabase 参数,直接传 thenable mock(await 链每次消费队列里下一个响应)。

import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { applyApprove, applyAssetAccept, applyBudgetUpdate, applyQualityReject } from './review-apply'
import { ASSET_ONLY_NOT_PUBLISHABLE } from './deliverable'
import { REEL_AUTO_CHECK_KEYS, REEL_HUMAN_CHECK_KEYS_V3 } from '@/lib/social/content-review'

type Resp = { data: unknown; error: unknown }

/** 每个 await 的查询链消费队列里下一个响应(按调用顺序)。 */
function mockSupabase(queue: Resp[]): { db: SupabaseClient; inserts: unknown[]; updates: unknown[] } {
  let i = 0
  const inserts: unknown[] = []
  const updates: unknown[] = []
  const builder: Record<string, unknown> = {}
  const passthrough = ['select', 'eq', 'in', 'order', 'limit', 'maybeSingle', 'single']
  for (const m of passthrough) builder[m] = () => builder
  builder.update = (row: unknown) => { updates.push(row); return builder }
  builder.insert = (rows: unknown) => { inserts.push(rows); return builder }
  ;(builder as { then: unknown }).then = (resolve: (r: Resp) => unknown) =>
    resolve(queue[i++] ?? { data: null, error: null })
  const db = { from: () => builder } as unknown as SupabaseClient
  return { db, inserts, updates }
}

const IN_REVIEW_WO = {
  id: 'wo-1', client_id: 'c-1', status: 'in_review', review_ref: {},
  output: { quality_checklist_auto: REEL_AUTO_CHECK_KEYS.map(key => ({ key, judge: 'AUTO', outcome: 'PASS', detail: 'measured', source_ref: null })) },
  brief: { segments: [] }, signal_id: 's-1', goal_id: 'g-1', master_brief_id: 'mb-1',
  winner_structure_id: null, order_type: 'fresh_angle', angle: 'X',
  angle_source: {}, rationale_one_liner: 'why', budget_cap_usd: 2, source_ad_id: 'ad-1',
}

const PASS_HUMAN = REEL_HUMAN_CHECK_KEYS_V3.map(key => ({
  key, judge: 'HUMAN' as const, outcome: 'PASS' as const, detail: null,
  source_ref: key.startsWith('factual_') ? 'https://example.test/source' : null,
}))
const FAIL_HUMAN = PASS_HUMAN.map(item => item.key === 'viral_recipe_hook_matched'
  ? { ...item, outcome: 'FAIL' as const, detail: 'Hook did not match recipe' }
  : { ...item, outcome: 'NOT_MEASURED' as const })
const approve = (db: SupabaseClient, id = 'wo-1', reviewer = 'me@x.com', clientId?: string) =>
  applyApprove(db, id, reviewer, clientId, PASS_HUMAN, null)
const reject = (db: SupabaseClient, id = 'wo-1', feedback = '画面太慢', reviewer = 'me@x.com', clientId?: string) =>
  applyQualityReject(db, id, feedback, reviewer, clientId, FAIL_HUMAN)

const musicBrief = {
  remotion: {
    template: 'postcard',
    props: {
      brandColor: '#123456', logoFile: 'cts-logo.png', musicFile: 'founders-at-dawn.mp3', musicStartSec: 5,
      cardOpacity: 0.7, cardSide: 'center', hook: { clip: 'hook.mp4', lines: ['China at dawn'] },
      scenes: [
        { clip: 'scene-one.mp4', place: 'Shanghai', line: 'Walk beside the old waterfront.', sourceUrl: 'https://example.com/one', sourceQuote: 'Walk beside the old waterfront in Shanghai.', placeSourceQuote: 'Shanghai waterfront.' },
        { clip: 'scene-two.mp4', place: 'Hangzhou', line: 'Follow the lake into the hills.', sourceUrl: 'https://example.com/two', sourceQuote: 'Follow the lake into the hills.', placeSourceQuote: 'Hangzhou lake.' },
      ],
      price: null, end: { backdropClip: 'end.mp4', title: 'Explore China' }, timing: { hookSec: 3, sceneSec: 3, priceSec: 3 },
    },
  },
}

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

  it('clientId 不匹配 → 403(跨客户越权),且没有写库', async () => {
    const { db, updates, inserts } = mockSupabase([{ data: IN_REVIEW_WO, error: null }])
    expect((await approve(db, 'wo-1', 'me@x.com', 'other-client')).status).toBe(403)
    expect(updates).toEqual([])
    expect(inserts).toEqual([])
  })

  it('别家客户 + 状态不是 in_review → 403（先核客户再核状态，不泄露别家工单的状态）', async () => {
    const { db, updates } = mockSupabase([{ data: { ...IN_REVIEW_WO, status: 'approved' }, error: null }])
    const r = await approve(db, 'wo-1', 'me@x.com', 'other-client')
    expect(r.status).toBe(403)
    expect(String(r.error)).not.toContain('status=')
    expect(updates).toEqual([])
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

describe('applyApprove — V3 清单与版本号', () => {
  it('V2 形状（缺「单独看得懂」）→ 400，不写库', async () => {
    const v2 = PASS_HUMAN.filter(i => i.key !== 'standalone_understandable')
    const { db, updates } = mockSupabase([{ data: IN_REVIEW_WO, error: null }])
    const r = await applyApprove(db, 'wo-1', 'me@x.com', undefined, v2, null)
    expect(r.status).toBe(400)
    expect(updates).toHaveLength(0)
  })

  it('批准时把 checklist_version=v3 写进 review_ref', async () => {
    const { db, updates } = mockSupabase([{ data: IN_REVIEW_WO, error: null }, { data: [{ id: 'wo-1' }], error: null }])
    const r = await approve(db)
    expect(r.ok).toBe(true)
    expect(((updates[0] as Record<string, unknown>).review_ref as Record<string, unknown>).checklist_version).toBe('v3')
  })
})

describe('applyAssetAccept — 素材验收入库（不是发布授权）', () => {
  const ASSET_WO = { ...IN_REVIEW_WO, brief: { remotion: { template: 'atmosphere', props: {}, deliverable: 'asset_only' } } }

  it('asset_only + in_review → archived，记 asset_accepted_by/at', async () => {
    const { db, updates } = mockSupabase([{ data: ASSET_WO, error: null }, { data: [{ id: 'wo-1' }], error: null }])
    const r = await applyAssetAccept(db, 'wo-1', 'me@x.com')
    expect(r).toMatchObject({ ok: true, status: 200 })
    expect(updates[0]).toMatchObject({ status: 'archived' })
    expect((updates[0] as Record<string, unknown>).review_ref as Record<string, unknown>).toMatchObject({ asset_accepted_by: 'me@x.com' })
  })

  it('普通成片 → 409，不写库', async () => {
    const { db, updates } = mockSupabase([{ data: IN_REVIEW_WO, error: null }])
    const r = await applyAssetAccept(db, 'wo-1', 'me@x.com')
    expect(r.status).toBe(409)
    expect(updates).toHaveLength(0)
  })

  it('拼错的 deliverable 不当素材（409）', async () => {
    const wo = { ...IN_REVIEW_WO, brief: { remotion: { deliverable: 'Asset_Only' } } }
    const { db } = mockSupabase([{ data: wo, error: null }])
    expect((await applyAssetAccept(db, 'wo-1', 'me@x.com')).status).toBe(409)
  })

  it('非 in_review → 409；别家客户 → 403', async () => {
    const a = mockSupabase([{ data: { ...ASSET_WO, status: 'approved' }, error: null }])
    expect((await applyAssetAccept(a.db, 'wo-1', 'me@x.com')).status).toBe(409)
    const b = mockSupabase([{ data: ASSET_WO, error: null }])
    expect((await applyAssetAccept(b.db, 'wo-1', 'me@x.com', 'other-client')).status).toBe(403)
  })
})

describe('applyQualityReject — remotion 单不重开新单', () => {
  it('remotion 单打回：只标 review_rejected，不 insert 重开单', async () => {
    const wo = { ...IN_REVIEW_WO, brief: { engine: 'remotion', remotion: { template: 'list', props: {} } } }
    const { db, inserts } = mockSupabase([{ data: wo, error: null }, { data: [{ id: 'wo-1' }], error: null }])
    const r = await reject(db)
    expect(r.ok).toBe(true)
    expect(r.data).toMatchObject({ status: 'review_rejected', reopened_work_order_id: null })
    expect(inserts).toHaveLength(0)
  })
})

describe('applyQualityReject — 打回重开', () => {
  it('a reopened postcard drops a pinned card height and a full-time logo', async () => {
    const wo = {
      ...IN_REVIEW_WO,
      brief: {
        ...musicBrief,
        remotion: {
          ...musicBrief.remotion,
          props: { ...musicBrief.remotion.props, cardTop: 870, logoMode: 'always' },
        },
      },
    }
    const { db, inserts } = mockSupabase([
      { data: wo, error: null },
      { data: [{ id: 'wo-1' }], error: null },
      { data: { id: 'wo-2' }, error: null },
    ])
    const r = await applyQualityReject(db, 'wo-1', '画面太慢', 'me@x.com', undefined, FAIL_HUMAN, 'horizons-call')
    expect(r.ok).toBe(true)
    const props = (inserts[0] as { brief: { remotion: { props: Record<string, unknown> } } }).brief.remotion.props
    expect(props.cardTop).toBeUndefined()
    expect(props.logoMode).toBeUndefined()
    expect(props.musicFile).toBe('horizons-call.mp3')
  })

  it('把人工选曲写进重开的 Remotion brief 并留审计信息', async () => {
    const wo = { ...IN_REVIEW_WO, brief: musicBrief }
    const { db, inserts } = mockSupabase([
      { data: wo, error: null },
      { data: [{ id: 'wo-1' }], error: null },
      { data: { id: 'wo-2' }, error: null },
    ])
    const r = await applyQualityReject(db, 'wo-1', '画面太慢', 'me@x.com', undefined, FAIL_HUMAN, 'horizons-call')
    expect(r.ok).toBe(true)
    const reopened = inserts[0] as { brief: Record<string, any> }
    expect(reopened.brief.remotion.props).toMatchObject({ musicFile: 'horizons-call.mp3', musicStartSec: 0 })
    expect(reopened.brief.review_overrides.music).toMatchObject({
      track_id: 'horizons-call', staged_file: 'horizons-call.mp3', catalog_file: "Horizon's Call.mp3", selected_by: 'me@x.com',
    })
    expect(reopened.brief.review_overrides.music.selected_at).toEqual(expect.any(String))
  })

  it('rejects an unapproved or incompatible music id before touching either work order', async () => {
    const wo = { ...IN_REVIEW_WO, brief: musicBrief }
    const { db, updates, inserts } = mockSupabase([{ data: wo, error: null }])
    const r = await applyQualityReject(db, 'wo-1', '画面太慢', 'me@x.com', undefined, FAIL_HUMAN, 'pipa-trap')
    expect(r.status).toBe(422)
    expect(updates).toEqual([])
    expect(inserts).toEqual([])
  })

  it('clientId 不匹配 → 403(跨客户越权),老单不动、不重开新单', async () => {
    const { db, updates, inserts } = mockSupabase([{ data: IN_REVIEW_WO, error: null }])
    const r = await reject(db, 'wo-1', '画面太慢', 'me@x.com', 'other-client')
    expect(r.ok).toBe(false)
    expect(r.status).toBe(403)
    expect(updates).toEqual([])
    expect(inserts).toEqual([])
  })

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

  it('clientId 不匹配 → 403(跨客户越权),预算不动、没有写库', async () => {
    const { db, updates, inserts } = mockSupabase([{ data: IN_REVIEW_WO, error: null }])
    const r = await applyBudgetUpdate(db, 'wo-1', 20, 'me@x.com', 'other-client')
    expect(r.ok).toBe(false)
    expect(r.status).toBe(403)
    expect(updates).toEqual([])
    expect(inserts).toEqual([])
  })
})
