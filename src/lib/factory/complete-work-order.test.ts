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

import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { completeWorkOrder } from './complete-work-order'

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

const okClient = (o: Record<string, unknown> = {}): Resp =>
  ({ table: 'clients', data: { brand_redline_phrases: [], factory_config: {}, ...o }, error: null })
const okBrief: Resp = { table: 'master_briefs', data: { excluded_topics: [] }, error: null }
const okUpdate: Resp = { table: 'content_work_orders', data: [{ id: 'wo-1' }], error: null }

/** 无 clip、无花费时的最短查询序列 */
const happyQueue = (clientOverrides: Record<string, unknown> = {}): Resp[] =>
  [okClient(clientOverrides), okBrief, okUpdate]

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

  it('🔴 update 必须带防抢占条件:限本 worker + 限活跃状态', async () => {
    const { db, filters } = mockSupabase(happyQueue())
    await completeWorkOrder(db, PARAMS)

    const woFilters = filters.filter((f) => f.table === 'content_work_orders')
    // 没有这两条,任何 worker 都能覆盖任意状态的工单(包括已 approved 的)
    expect(woFilters).toContainEqual({ table: 'content_work_orders', method: 'eq', args: ['claimed_by', 'worker-1'] })
    expect(woFilters).toContainEqual({ table: 'content_work_orders', method: 'in', args: ['status', ['claimed', 'producing']] })
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

describe('completeWorkOrder — 并发', () => {
  it('update 命中 0 行(工单被 sweeper 收回) → 409,不伪装成功', async () => {
    const { db } = mockSupabase([okClient(), okBrief, { table: 'content_work_orders', data: [], error: null }])
    const r = await completeWorkOrder(db, PARAMS)

    expect(r.ok).toBe(false)
    expect(!r.ok && r.status).toBe(409)
  })
})
