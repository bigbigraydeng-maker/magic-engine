// 2026-07-23 — completeWorkOrder 落库编排测试(此前该文件零覆盖)。
//
// 存在理由:审核搬进 ME 驾驶舱后,交付必须直接落 in_review。此前落 rendered、靠
// factory-review-sweeper 推 Airtable 时才改 in_review;Airtable 退役 + 该 cron 停调度后,
// rendered 成了死胡同 —— 成片永远进不了 /dashboard/factory 的审片队列(ReviewInbox 只筛
// in_review),整条产线静默断掉。这组测试钉死这个落点,防止再退回 rendered。
//
// mock 说明:队列按「表名」取响应而不是按位置(魏征审查意见)。按位置取会让
// clients / master_briefs 两次查询对调后测试照样全绿,而且中间新增一次查询会让后面
// 整体错位、失败信息指向无关断言。带表名断言则调用顺序被钉死,失败信息直指现场。
// 同时记录 update/insert 的 payload 与 eq/in 过滤条件 —— 不记过滤条件的话,把
// `.eq('claimed_by')` / `.in('status', ACTIVE_STATUSES)` 这两道防抢占条件删掉,测试不会报警。

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { completeWorkOrder } from './complete-work-order'
import { resolveRecipe } from './recipe'

// 品控(content-quality-guard.ts)自己的逻辑在 content-quality-guard.test.ts 里已经覆盖;
// 这里只关心 completeWorkOrder 的落库编排(有没有把 brand_name/brand_voice 正确传下去、
// 有没有把结果写进 output.quality_flags),所以把 Jev 网络调用整个 mock 掉——
// 不然测试环境没有 TYPESAFE_API_KEY,每条测试都会静默产生一次"调用失败"的副作用。
const callJev = vi.fn()
vi.mock('@/lib/jev/client', () => ({
  callJev: (...a: unknown[]) => callJev(...a),
}))

beforeEach(() => {
  callJev.mockReset()
  callJev.mockResolvedValue({ answers: {} }) // 默认全不命中
})

type Resp = { table: string; data: unknown; error: unknown }
type Filter = { table: string; method: string; args: unknown[] }

function mockSupabase(queue: Resp[]) {
  let i = 0
  const updates: Array<{ table: string; payload: Record<string, unknown> }> = []
  const inserts: Array<{ table: string; rows: unknown }> = []
  const filters: Filter[] = []
  let table = ''
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'maybeSingle', 'single']) {
    builder[m] = (...args: unknown[]) => { filters.push({ table, method: m, args }); return builder }
  }
  builder.update = (payload: Record<string, unknown>) => { updates.push({ table, payload }); return builder }
  builder.insert = (rows: unknown) => { inserts.push({ table, rows }); return builder }
  ;(builder as { then: unknown }).then = (resolve: (r: { data: unknown; error: unknown }) => unknown) => {
    const next = queue[i++]
    if (!next) throw new Error(`第 ${i} 次查询(表 ${table})超出预设队列 —— 实际查询比预期多`)
    if (next.table !== table) {
      throw new Error(`第 ${i} 次查询顺序不符:预期查 ${next.table},实际查 ${table}`)
    }
    return resolve({ data: next.data, error: next.error })
  }
  const db = { from: (t: string) => { table = t; return builder } } as unknown as SupabaseClient
  return { db, updates, inserts, filters, consumed: () => i }
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
  // route 层已校验过路径前缀,这里沿用真实形状,避免 fixture 误导后来人
  videoPath: 'renders/c-1/wo-1/final.mp4',
  segmentsPath: 'renders/c-1/wo-1/segments.json',
  srtPath: 'renders/c-1/wo-1/captions.srt',
  caption: 'A perfectly compliant caption.',
  actualCost: 0,
  newClips: [],
}

const RECIPE = resolveRecipe('single_image_i2v_pullback_12s')!
const SOURCE = 'https://cdn.example.com/client-source.jpg'
const RECIPE_WO = {
  ...WO,
  brief: {
    creative_recipe: { id: RECIPE.id, version: RECIPE.version },
    clip_generation_plan: RECIPE.segments.map((s, i) => ({
      segment_role: s.role,
      position: i,
      source_image_url: SOURCE,
    })),
  },
}
const RECIPE_CLIPS = RECIPE.segments.map((s, i) => ({
  storage_url: `clips/b-generated/c-1/wo-1_${s.role}_${i}.mp4`,
  track: 'b_generated',
  scene_tag: 'client_source_derived',
  duration_seconds: s.duration_hint_s,
  idempotency_key: `sig-1:${s.role}:${i}`,
  motion_type: s.motion_type,
  source_meta: { recipe: RECIPE.id, request_id: `req-${i}` },
}))
const RECIPE_RECEIPT = {
  recipe: { id: RECIPE.id, version: RECIPE.version },
  motion: false,
  tts: false,
  segments: RECIPE.segments.map((s, i) => ({
    role: s.role,
    planned_duration_s: s.duration_hint_s,
    actual_duration_s: s.duration_hint_s,
    motion_type: s.motion_type,
    camera_action: s.camera_action,
    transition_out: s.transition,
    clip_source: 'ai_i2v',
    source_image_url: SOURCE,
    provider: { name: 'muapi', request_id: `req-${i}` },
    caption: i === 0 ? 'Discover China' : '',
  })),
  endcard: {
    planned_duration_s: RECIPE.endcard_dur,
    cta: 'Learn more',
    transition_in: RECIPE.endcard_transition,
  },
  music: { id: 'epic-a', source: 'library', loudness_lufs: -18 },
  xfade: RECIPE.xfade,
  final: { duration_s: 12, loudness_lufs: -20 },
}

const okClient = (o: Record<string, unknown> = {}): Resp =>
  ({ table: 'clients', data: { brand_redline_phrases: [], factory_config: {}, ...o }, error: null })
const okBrief: Resp = { table: 'master_briefs', data: { excluded_topics: [] }, error: null }
const okUpdate: Resp = { table: 'content_work_orders', data: [{ id: 'wo-1' }], error: null }

/** 无 clip、无花费时的最短查询序列 */
const happyQueue = (clientOverrides: Record<string, unknown> = {}): Resp[] =>
  [okClient(clientOverrides), okBrief, okUpdate]

describe('completeWorkOrder — 多画幅清单', () => {
  it('把额外画幅写进现有 output，不改工单状态', async () => {
    const { db, updates } = mockSupabase(happyQueue())
    const r = await completeWorkOrder(db, {
      ...PARAMS,
      aspectOutputs: [{
        aspect: '4:5',
        width: 1080,
        height: 1350,
        path: 'renders/c-1/wo-1/final-4x5.mp4',
        channels: ['facebook_feed'],
        placement: 'feed',
        role: 'variant',
      }],
    })
    expect(r.ok).toBe(true)
    const wo = updates.find((u) => u.table === 'content_work_orders')
    const outputs = (wo!.payload.output as { aspect_outputs: Array<{ path: string }> }).aspect_outputs
    expect(outputs[0]?.path).toBe('renders/c-1/wo-1/final-4x5.mp4')
    expect(wo!.payload.status).toBe('in_review')
  })

  it('没要求额外画幅时不写入 aspect_outputs', async () => {
    const { db, updates } = mockSupabase(happyQueue())
    await completeWorkOrder(db, PARAMS)
    const wo = updates.find((u) => u.table === 'content_work_orders')
    expect(wo!.payload.output).not.toHaveProperty('aspect_outputs')
  })
})

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

  it('🔴 返回值同样是 in_review(worker 日志 / route 响应都读它)', async () => {
    const { db } = mockSupabase(happyQueue())
    const r = await completeWorkOrder(db, PARAMS)
    expect(r.ok && r.status).toBe('in_review')
  })

  it('渲染 worker 的媒体探测结果成为服务端 AUTO 清单；缺测继续 fail-closed', async () => {
    const evidence = {
      audio_stream_present: true,
      audio_loudness_lufs: -18,
      width: 1080,
      height: 1920,
      duration_seconds: 12,
      subtitle_cues: [{ start_seconds: 0, end_seconds: 1, text: 'Discover China' }],
      cover_mean_luma: 100,
      cover_luma_range: 180,
      cover_placeholder_detected: false,
    }
    const measured = mockSupabase(happyQueue())
    await completeWorkOrder(measured.db, { ...PARAMS, mediaEvidence: evidence })
    const checks = (measured.updates.find(u => u.table === 'content_work_orders')!.payload.output as Record<string, unknown>)
      .quality_checklist_auto as Array<{ key: string; outcome: string }>
    expect(checks.slice(0, 5).map(item => item.outcome)).toEqual(['PASS', 'PASS', 'PASS', 'PASS', 'PASS'])

    const missing = mockSupabase(happyQueue())
    await completeWorkOrder(missing.db, PARAMS)
    const missingChecks = (missing.updates.find(u => u.table === 'content_work_orders')!.payload.output as Record<string, unknown>)
      .quality_checklist_auto as Array<{ outcome: string }>
    expect(missingChecks.slice(0, 5).every(item => item.outcome === 'NOT_MEASURED')).toBe(true)
  })

  it('🔴 update 必须带防抢占条件:限本 worker + 限活跃状态', async () => {
    const { db, filters } = mockSupabase(happyQueue())
    await completeWorkOrder(db, PARAMS)

    const woFilters = filters.filter((f) => f.table === 'content_work_orders')
    // 没有这两条,任何 worker 都能覆盖任意状态的工单(包括已 approved 的)
    expect(woFilters).toContainEqual({ table: 'content_work_orders', method: 'eq', args: ['claimed_by', 'worker-1'] })
    expect(woFilters).toContainEqual({ table: 'content_work_orders', method: 'in', args: ['status', ['claimed', 'producing']] })
  })
})

describe('completeWorkOrder — recipe receipt 服务端边界', () => {
  it('replan marker 壳单即使没有 creative_recipe 也无条件 422，数据库零查询', async () => {
    const { db, consumed } = mockSupabase([])
    const r = await completeWorkOrder(db, {
      ...PARAMS,
      wo: {
        ...WO,
        brief: {
          recipe_replan_required: true,
          review_feedback: '声音和节奏需要重做',
        },
      },
    })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.status).toBe(422)
    expect(!r.ok && r.error).toMatch(/recipe replan required/)
    expect(consumed()).toBe(0)
  })

  it('recipe 单缺 receipt → 422，数据库零查询', async () => {
    const { db, consumed } = mockSupabase([])
    const r = await completeWorkOrder(db, {
      ...PARAMS,
      wo: RECIPE_WO,
      newClips: RECIPE_CLIPS,
    })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.status).toBe(422)
    expect(!r.ok && r.error).toMatch(/recipe_receipt required/)
    expect(consumed()).toBe(0)
  })

  it('receipt provider request_id 与 new_clips 不一致 → 422', async () => {
    const { db, consumed } = mockSupabase([])
    const badClips = RECIPE_CLIPS.map((c, i) =>
      i === 0 ? { ...c, source_meta: { ...c.source_meta, request_id: 'forged' } } : c,
    )
    const r = await completeWorkOrder(db, {
      ...PARAMS,
      wo: RECIPE_WO,
      newClips: badClips,
      recipeReceipt: RECIPE_RECEIPT,
    })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.status).toBe(422)
    expect(!r.ok && r.error).toMatch(/request_id/)
    expect(consumed()).toBe(0)
  })

  it('完整 receipt + 两段真实 I2V metadata → 才允许进入 in_review', async () => {
    const { db, updates } = mockSupabase([
      okClient(),
      okBrief,
      { table: 'video_clips', data: [], error: null },
      { table: 'video_clips', data: [{ id: 'clip-1' }, { id: 'clip-2' }], error: null },
      okUpdate,
    ])
    const r = await completeWorkOrder(db, {
      ...PARAMS,
      wo: RECIPE_WO,
      newClips: RECIPE_CLIPS,
      recipeReceipt: RECIPE_RECEIPT,
    })
    expect(r.ok).toBe(true)
    expect(r.ok && r.status).toBe('in_review')
    expect(updates.find((u) => u.table === 'content_work_orders')?.payload.status).toBe('in_review')
  })

  it('多图 recipe 按段核对各自源图，三张不同图片可进入 in_review', async () => {
    const recipe = resolveRecipe('multi_image_i2v_multicut_9s')!
    const sources = recipe.segments.map((_, i) => `https://cdn.example.com/client-source-${i}.jpg`)
    const wo = {
      ...WO,
      brief: {
        creative_recipe: { id: recipe.id, version: recipe.version },
        clip_generation_plan: recipe.segments.map((s, i) => ({
          segment_role: s.role,
          position: i,
          source_image_url: sources[i],
        })),
      },
    }
    const clips = recipe.segments.map((s, i) => ({
      storage_url: `clips/b-generated/c-1/wo-1_${s.role}_${i}.mp4`,
      track: 'b_generated',
      scene_tag: 'client_source_derived',
      duration_seconds: s.duration_hint_s,
      idempotency_key: `sig-multi:${s.role}:${i}`,
      motion_type: s.motion_type,
      source_meta: { recipe: recipe.id, request_id: `req-multi-${i}` },
    }))
    const receipt = {
      recipe: { id: recipe.id, version: recipe.version },
      motion: false,
      tts: false,
      segments: recipe.segments.map((s, i) => ({
        role: s.role,
        planned_duration_s: s.duration_hint_s,
        actual_duration_s: s.gen_duration_s ?? s.duration_hint_s,
        gen_duration_s: s.gen_duration_s,
        motion_type: s.motion_type,
        camera_action: s.camera_action,
        transition_out: s.transition,
        clip_source: 'ai_i2v',
        source_image_url: sources[i],
        provider: { name: 'muapi', request_id: `req-multi-${i}` },
        caption: i === 0 ? 'China, closer than ever' : i === 1 ? 'Beyond the postcard' : '',
      })),
      endcard: {
        planned_duration_s: recipe.endcard_dur,
        cta: 'Book your China journey',
        transition_in: recipe.endcard_transition,
        facts: {
          phone: '0800 287 888',
          url: 'https://www.ctstours.co.nz/tours/china/discovery/beijing-xian',
          departure: '15 Oct 2026',
          price: 'From NZD $3,480',
        },
      },
      music: { id: 'Jade River Journey.mp3', source: 'library', loudness_lufs: -18 },
      xfade: recipe.xfade,
      final: { duration_s: 9.1, loudness_lufs: -20 },
    }
    const { db, updates } = mockSupabase([
      okClient({ factory_config: { allow_b_track_landmark_ads: true } }),
      okBrief,
      { table: 'video_clips', data: [], error: null },
      { table: 'video_clips', data: clips.map((_, i) => ({ id: `clip-${i + 1}` })) , error: null },
      okUpdate,
    ])

    const r = await completeWorkOrder(db, {
      ...PARAMS,
      wo,
      newClips: clips,
      recipeReceipt: receipt,
    })

    expect(r.ok).toBe(true)
    expect(r.ok && r.status).toBe('in_review')
    expect(updates.find((u) => u.table === 'content_work_orders')?.payload.status).toBe('in_review')
  })
})

describe('completeWorkOrder — 红线复扫', () => {
  it('命中红线不阻断交付,写进 output.redline_hits(命中不打回,标红给人看)', async () => {
    const { db, updates } = mockSupabase(happyQueue({ brand_redline_phrases: ['affordable'] }))
    const r = await completeWorkOrder(db, { ...PARAMS, caption: 'Affordable floors today' })

    expect(r.ok).toBe(true)
    expect(r.ok && r.redlineHits).toEqual(['affordable'])
    const wo = updates.find((u) => u.table === 'content_work_orders')!
    expect(wo.payload.status).toBe('in_review')
    expect((wo.payload.output as Record<string, unknown>).redline_hits).toEqual(['affordable'])
  })

  it('红线查询失败 → 500 拒绝(fail-closed:查不到 ≠ 没有红线)', async () => {
    const { db, updates } = mockSupabase([{ table: 'clients', data: null, error: { message: 'boom' } }])
    const r = await completeWorkOrder(db, PARAMS)

    expect(r.ok).toBe(false)
    expect(!r.ok && r.status).toBe(500)
    expect(updates.find((u) => u.table === 'content_work_orders')).toBeUndefined()
  })
})

describe('completeWorkOrder — B 轨 scene_tag 白名单(护栏 6)', () => {
  const landmarkClip = {
    storage_url: 'clips/c-1/b_generated/x.mp4',
    track: 'b_generated',
    scene_tag: 'great_wall_sunrise', // 具体地标,不在抽象白名单里
    duration_seconds: 3,
    idempotency_key: 'k1',
  }

  it('🔴 生成式具体地标 → 422 拒绝,工单不落库', async () => {
    const { db, updates, consumed } = mockSupabase([okClient()])
    const r = await completeWorkOrder(db, { ...PARAMS, newClips: [landmarkClip] })

    expect(r.ok).toBe(false)
    expect(!r.ok && r.status).toBe(422)
    expect(updates).toHaveLength(0)
    expect(consumed()).toBe(1) // 白名单在 brief 查询之前就拦下,不该再查下去
  })

  it('allow_b_track_landmark_ads = true → 放行(客户级豁免)', async () => {
    const { db, updates } = mockSupabase([
      okClient({ factory_config: { allow_b_track_landmark_ads: true } }),
      okBrief,
      { table: 'video_clips', data: [], error: null },        // 幂等查重:无已有
      { table: 'video_clips', data: [{ id: 'clip-1' }], error: null }, // 插入
      okUpdate,
    ])
    const r = await completeWorkOrder(db, { ...PARAMS, newClips: [landmarkClip] })

    expect(r.ok).toBe(true)
    expect(r.ok && r.newClipIds).toEqual(['clip-1'])
    expect(updates.find((u) => u.table === 'content_work_orders')!.payload.status).toBe('in_review')
  })

  it('豁免开关必须严格等于 true,truthy 值不算(防误开)', async () => {
    const { db } = mockSupabase([okClient({ factory_config: { allow_b_track_landmark_ads: 'yes' } })])
    const r = await completeWorkOrder(db, { ...PARAMS, newClips: [landmarkClip] })
    expect(!r.ok && r.status).toBe(422)
  })
})

describe('completeWorkOrder — 台账幂等(护栏 10 事实源)', () => {
  const withCost = { ...PARAMS, actualCost: 3.5 }

  it('首次交付 → 记一笔负数 spend', async () => {
    const { db, inserts, updates } = mockSupabase([
      okClient(),
      okBrief,
      { table: 'factory_balance_ledger', data: null, error: null }, // 无已有 spend
      { table: 'factory_balance_ledger', data: null, error: null }, // insert
      okUpdate,
    ])
    const r = await completeWorkOrder(db, withCost)

    expect(r.ok).toBe(true)
    const ledger = inserts.find((x) => x.table === 'factory_balance_ledger')
    expect(ledger).toBeDefined()
    expect((ledger!.rows as Record<string, unknown>).amount_usd).toBe(-3.5)
    expect(updates[0].payload.actual_cost_usd).toBe(3.5)
  })

  it('🔴 同工单已有 spend → 不重复记账(complete 重试不重扣)', async () => {
    const { db, inserts } = mockSupabase([
      okClient(),
      okBrief,
      { table: 'factory_balance_ledger', data: { id: 'ledger-1' }, error: null }, // 已有
      okUpdate,
    ])
    const r = await completeWorkOrder(db, withCost)

    expect(r.ok).toBe(true)
    expect(inserts.find((x) => x.table === 'factory_balance_ledger')).toBeUndefined()
  })

  it('已记成本更高时取较大值,不被低价重试冲掉', async () => {
    const { db, updates } = mockSupabase([
      okClient(),
      okBrief,
      { table: 'factory_balance_ledger', data: { id: 'ledger-1' }, error: null },
      okUpdate,
    ])
    await completeWorkOrder(db, { ...PARAMS, wo: { ...WO, actual_cost_usd: 9 }, actualCost: 1 })
    expect(updates[0].payload.actual_cost_usd).toBe(9)
  })
})

describe('completeWorkOrder — 成片文案品控(2026-09-20 Jev 评估)', () => {
  it('🔴 Jev 命中竞品品牌 → 写进 output.quality_flags,不阻断交付', async () => {
    callJev.mockResolvedValue({ answers: { competitor_angle: { noul: 0.9 }, placeholder_leak: { noul: 0.05 } } })
    const { db, updates } = mockSupabase(happyQueue())
    const r = await completeWorkOrder(db, {
      ...PARAMS,
      wo: { ...WO, angle: 'mapei brisbane' },
      caption: '$35.50/m²',
    })

    expect(r.ok).toBe(true)
    expect(r.ok && r.status).toBe('in_review') // 命中不打回
    expect(r.ok && r.qualityFlags.some((f) => f.category === 'competitor_brand')).toBe(true)
    const wo = updates.find((u) => u.table === 'content_work_orders')!
    const flags = (wo.payload.output as Record<string, unknown>).quality_flags as Array<{ category: string }>
    expect(flags.some((f) => f.category === 'competitor_brand')).toBe(true)
  })

  it('🔴 legacy 单的逐段字幕存在 brief.copy.segments,不是 brief.segments[].text_overlay —— 必须收进去才能测出跨段重复(2026-09-20 codex review round 2)', async () => {
    const { db } = mockSupabase(happyQueue())
    const r = await completeWorkOrder(db, {
      ...PARAMS,
      wo: {
        ...WO,
        brief: {
          segments: [{ role: 'hook' }, { role: 'middle' }], // text_overlay 字段从未被写入过(真实数据形状)
          copy: {
            segments: [
              { role: 'hook', title_sub: 'Customer Stories & Community' },
              { role: 'middle', title_sub: 'Customer Stories & Community' },
            ],
          },
        },
      },
      // worker.mjs 实际提交的就是这种拼接过的单条聚合串,内部重复不会被逐段检测器看到
      caption: 'Customer Stories & Community · Customer Stories & Community',
    })

    expect(r.ok).toBe(true)
    expect(r.ok && r.qualityFlags.some((f) => f.category === 'placeholder_caption')).toBe(true)
  })

  it('🔴 title_sub 是空字符串时按 worker.mjs 同样的优先级跳到 caption,不能停在空串上(2026-09-20 codex review round 3)', async () => {
    const { db } = mockSupabase(happyQueue())
    const r = await completeWorkOrder(db, {
      ...PARAMS,
      wo: {
        ...WO,
        brief: {
          segments: [{ role: 'hook' }, { role: 'middle' }],
          copy: {
            segments: [
              { role: 'hook', title_sub: '', caption: 'Customer Stories & Community' },
              { role: 'middle', title_sub: '', caption: 'Customer Stories & Community' },
            ],
          },
        },
      },
      caption: 'Customer Stories & Community · Customer Stories & Community',
    })

    expect(r.ok).toBe(true)
    // 用 `??` 会把空的 title_sub 当作"有值",读不到 caption,这条重复就会被漏掉
    expect(r.ok && r.qualityFlags.some((f) => f.category === 'placeholder_caption')).toBe(true)
  })

  it('brand_name 从 master_briefs 传给品控;persona 不再触发人称检测(2026-10-16 取消)', async () => {
    const { db } = mockSupabase([
      okClient(),
      { table: 'master_briefs', data: { excluded_topics: [], brand_name: 'CTS Tours', brand_voice: { persona: { name: 'Baker Gu', role: 'tour guide' } } }, error: null },
      okUpdate,
    ])
    await completeWorkOrder(db, {
      ...PARAMS,
      wo: { ...WO, angle: 'discover china' },
      caption: 'Our own offices. Our own guides.',
    })

    const [state, questions] = callJev.mock.calls[0]
    expect(state.brand).toBe('CTS Tours')
    expect(state.intended_voice).toBeUndefined()
    expect(questions.wrong_voice).toBeUndefined()
  })

  it('Jev 调用失败 → quality_check_unavailable 进 output,交付仍然成功(fail-closed 转人工,不阻断)', async () => {
    callJev.mockRejectedValue(new Error('network down'))
    const { db, updates } = mockSupabase(happyQueue())
    const r = await completeWorkOrder(db, PARAMS)

    expect(r.ok).toBe(true)
    const wo = updates.find((u) => u.table === 'content_work_orders')!
    const flags = (wo.payload.output as Record<string, unknown>).quality_flags as Array<{ category: string }>
    expect(flags.some((f) => f.category === 'quality_check_unavailable')).toBe(true)
  })
})

describe('completeWorkOrder — 并发', () => {
  it('update 命中 0 行(工单被 sweeper 收回) → 409,不伪装成功', async () => {
    const { db } = mockSupabase([okClient(), okBrief, { table: 'content_work_orders', data: [], error: null }])
    const r = await completeWorkOrder(db, PARAMS)

    expect(r.ok).toBe(false)
    expect(!r.ok && r.status).toBe(409)
  })
})

describe('completeWorkOrder — 内容实质闸（服务端重算）', () => {
  const ATMOS_PASS = { durationSec: 15, fadeInSec: 1, fadeOutSec: 1.5, line: { text: 'The skyline at dusk', sourceUrl: 'https://example.test/a', sourceQuote: 'The skyline at dusk.' } }
  const ATMOS_EMPTY = { durationSec: 15, line: null }
  const woWith = (props: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    ...WO,
    brief: { segments: [], remotion: { template: 'atmosphere', props, ...extra } },
  }) as Record<string, unknown>
  const CAP = { capabilities: ['content_substance_v1'] }

  const run = (wo: Record<string, unknown>, evidence: Record<string, unknown> | null = null) => {
    const m = mockSupabase(happyQueue())
    return completeWorkOrder(m.db, { ...PARAMS, wo, mediaEvidence: evidence as never }).then((r) => ({ r, m }))
  }
  const savedOutput = (m: ReturnType<typeof mockSupabase>) =>
    m.updates.find((u) => u.table === 'content_work_orders')!.payload.output as Record<string, unknown>

  const savedEnforce = process.env.FACTORY_CONTENT_SUBSTANCE_ENFORCE
  beforeEach(() => { delete process.env.FACTORY_CONTENT_SUBSTANCE_ENFORCE })
  afterEach(() => {
    if (savedEnforce === undefined) delete process.env.FACTORY_CONTENT_SUBSTANCE_ENFORCE
    else process.env.FACTORY_CONTENT_SUBSTANCE_ENFORCE = savedEnforce
  })

  it('non-remotion orders are untouched by the gate', async () => {
    const { r, m } = await run(WO as Record<string, unknown>)
    expect(r.ok).toBe(true)
    expect(savedOutput(m).content_substance).toBeUndefined()
    expect(savedOutput(m).machine_reviewed).toBeUndefined()
  })

  it('template delivery enters the human queue marked not machine-reviewed', async () => {
    const { r, m } = await run(woWith(ATMOS_PASS))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.status).toBe('in_review')
    expect(savedOutput(m).machine_reviewed).toBe(false)
  })

  it('warn mode (default): a text-less reel still completes, with the server verdict kept for audit', async () => {
    const { r, m } = await run(woWith(ATMOS_EMPTY))
    expect(r.ok).toBe(true)
    expect(savedOutput(m).content_substance).toMatchObject({ server: { verdict: 'fail' }, enforced: false, capable: false })
  })

  it('enforce: a text-less reel is refused with 422 before any database write', async () => {
    process.env.FACTORY_CONTENT_SUBSTANCE_ENFORCE = '1'
    const m = mockSupabase([])
    const r = await completeWorkOrder(m.db, { ...PARAMS, wo: woWith(ATMOS_EMPTY), mediaEvidence: CAP as never })
    expect(r).toMatchObject({ ok: false, status: 422 })
    expect((r as { error: string }).error).toMatch(/^content_substance_failed: .+/)
    expect(m.consumed()).toBe(0)
    expect(m.updates).toHaveLength(0)
  })

  it('enforce: a passing reel from a worker without the capability is refused (old worker)', async () => {
    process.env.FACTORY_CONTENT_SUBSTANCE_ENFORCE = '1'
    const m = mockSupabase([])
    const r = await completeWorkOrder(m.db, { ...PARAMS, wo: woWith(ATMOS_PASS), mediaEvidence: null })
    expect(r).toMatchObject({ ok: false, status: 422, error: 'content_substance_missing' })
    expect(m.consumed()).toBe(0)
  })

  it('enforce: a passing reel with the capability completes and records enforced=true', async () => {
    process.env.FACTORY_CONTENT_SUBSTANCE_ENFORCE = '1'
    const { r, m } = await run(woWith(ATMOS_PASS), CAP)
    expect(r.ok).toBe(true)
    expect(savedOutput(m).content_substance).toMatchObject({ server: { verdict: 'pass' }, enforced: true, capable: true })
  })

  it('enforce: asset_only material passes the gate and is marked output.deliverable', async () => {
    process.env.FACTORY_CONTENT_SUBSTANCE_ENFORCE = '1'
    const { r, m } = await run(woWith(ATMOS_EMPTY, { deliverable: 'asset_only' }), CAP)
    expect(r.ok).toBe(true)
    expect(savedOutput(m).deliverable).toBe('asset_only')
  })

  it('enforce: a mistyped deliverable is not material (still refused)', async () => {
    process.env.FACTORY_CONTENT_SUBSTANCE_ENFORCE = '1'
    const m = mockSupabase([])
    const r = await completeWorkOrder(m.db, { ...PARAMS, wo: woWith(ATMOS_EMPTY, { deliverable: 'Asset_Only' }), mediaEvidence: CAP as never })
    expect(r).toMatchObject({ ok: false, status: 422 })
    expect((r as { error: string }).error).toMatch(/^content_substance_failed/)
  })

  it('enforce: a worker self-report of pass cannot override the server verdict', async () => {
    process.env.FACTORY_CONTENT_SUBSTANCE_ENFORCE = '1'
    const m = mockSupabase([])
    const lying = { content_substance: { verdict: 'pass', kinds: ['selling_line'], textSeconds: 9, reason: 'x' }, ...CAP }
    const r = await completeWorkOrder(m.db, { ...PARAMS, wo: woWith(ATMOS_EMPTY), mediaEvidence: lying as never })
    expect(r).toMatchObject({ ok: false, status: 422 })
    expect(m.consumed()).toBe(0)
  })

  it('enforce: engine=remotion with a missing or malformed brief.remotion is refused, never skipped', async () => {
    process.env.FACTORY_CONTENT_SUBSTANCE_ENFORCE = '1'
    for (const brief of [{ engine: 'remotion' }, { engine: 'remotion', remotion: [] }, { engine: 'remotion', remotion: { template: 5, props: {} } }, { remotion: 'x' }]) {
      const m = mockSupabase([])
      const r = await completeWorkOrder(m.db, { ...PARAMS, wo: { ...WO, brief } as Record<string, unknown>, mediaEvidence: CAP as never })
      expect(r).toMatchObject({ ok: false, status: 422 })
      expect((r as { error: string }).error).toMatch(/^content_substance_failed/)
    }
  })

  it('a worker that reports pass while the server computes fail is flagged as a mismatch', async () => {
    const { r, m } = await run(woWith(ATMOS_EMPTY), { content_substance: { verdict: 'pass', kinds: ['selling_line'], textSeconds: 5, reason: 'x' }, ...CAP })
    expect(r.ok).toBe(true)
    expect(savedOutput(m).content_substance).toMatchObject({ mismatch: true })
  })
})
