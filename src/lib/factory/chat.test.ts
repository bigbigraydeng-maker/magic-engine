// 对话框工具 handler 测试:模板出片(remotion)单不能被打回重做,必须如实拒绝,
// 不作废旧单、不重开新单;list_pending_reviews 标明出片方式。
// 用假 supabase(按调用顺序消费响应队列),不碰生产库、不调 Claude。

import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { REEL_HUMAN_CHECK_KEYS_V3 } from '@/lib/social/content-review'

vi.mock('@/lib/anthropic/client', () => ({ callClaudeWithTools: vi.fn() }))

import { buildFactoryChatTools } from './chat'

type Resp = { data: unknown; error: unknown }

// SupabaseClient is a subtype of { from }, so this single downcast needs no double cast.
const asClient = (fake: { from: (t: string) => unknown }): SupabaseClient => fake as SupabaseClient

function fakeSupabase(queue: Resp[]) {
  let i = 0
  const tables: string[] = []
  const updates: unknown[] = []
  const inserts: unknown[] = []
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'maybeSingle', 'single']) builder[m] = () => builder
  builder.update = (row: unknown) => { updates.push(row); return builder }
  builder.insert = (row: unknown) => { inserts.push(row); return builder }
  ;(builder as { then: unknown }).then = (resolve: (r: Resp) => unknown) =>
    resolve(queue[i++] ?? { data: null, error: null })
  const db = asClient({ from: (t: string) => { tables.push(t); return builder } })
  return { db, tables, updates, inserts }
}

const handlersFor = (db: SupabaseClient) =>
  buildFactoryChatTools({ supabase: db, clientId: 'c-1', reviewer: 'me@x.com' }).handlers

const CHECKLIST = REEL_HUMAN_CHECK_KEYS_V3.map((key, idx) => ({
  key, judge: 'HUMAN' as const, outcome: idx === 0 ? ('FAIL' as const) : ('NOT_MEASURED' as const),
  detail: idx === 0 ? '画面太慢' : null, source_ref: null,
}))
const REMOTION_BRIEF = { remotion: { template: 't', props: {} } }
const rejectInput = { work_order_id: 'wo-1', feedback: '画面太慢', checklist_human: CHECKLIST }

describe('reject_work_order — 模板出片单', () => {
  it('remotion 单:如实拒绝,不作废旧单、不重开新单', async () => {
    const { db, tables, updates, inserts } = fakeSupabase([{ data: { id: 'wo-1', brief: REMOTION_BRIEF }, error: null }])
    const out = await handlersFor(db).reject_work_order(rejectInput)
    expect(out).toContain('模板出片')
    expect(out).toContain('没有作废旧单')
    expect(updates).toEqual([])
    expect(inserts).toEqual([])
    expect(tables).toEqual(['content_work_orders'])
  })

  it('查工单失败:报失败且没有任何写入', async () => {
    const { db, updates, inserts } = fakeSupabase([{ data: null, error: { message: 'boom' } }])
    const out = await handlersFor(db).reject_work_order(rejectInput)
    expect(out).toContain('查询工单失败')
    expect(out).toContain('没有打回')
    expect(updates).toEqual([])
    expect(inserts).toEqual([])
  })

  it('非 remotion 单:照旧打回并重开', async () => {
    const wo = {
      id: 'wo-1', client_id: 'c-1', status: 'in_review', brief: { segments: [] }, signal_id: 's',
      goal_id: 'g', master_brief_id: 'm', winner_structure_id: null, order_type: 'fresh_angle',
      angle: 'X', angle_source: {}, rationale_one_liner: 'why', budget_cap_usd: 2, source_ad_id: 'a',
    }
    const { db, inserts } = fakeSupabase([
      { data: { id: 'wo-1', brief: { segments: [] } }, error: null },
      { data: wo, error: null },
      { data: [{ id: 'wo-1' }], error: null },
      { data: { id: 'wo-2' }, error: null },
    ])
    const out = await handlersFor(db).reject_work_order(rejectInput)
    expect(out.startsWith('已打回并重开一条工单')).toBe(true)
    expect(inserts).toHaveLength(1)
  })

  it('缺参数:提示缺少,且不查库', async () => {
    const { db, tables } = fakeSupabase([])
    const out = await handlersFor(db).reject_work_order({ feedback: '画面太慢' })
    expect(out).toContain('缺少')
    expect(tables).toEqual([])
  })
})

describe('list_pending_reviews — 出片方式', () => {
  it('每条标明模板出片/配方出片', async () => {
    const row = { angle: 'A', rationale_one_liner: 'r', created_at: 't', output: null }
    const { db } = fakeSupabase([{
      data: [{ ...row, id: 'a', brief: REMOTION_BRIEF }, { ...row, id: 'b', brief: { segments: [] } }],
      error: null,
    }])
    const parsed = JSON.parse(await handlersFor(db).list_pending_reviews({})) as Array<Record<string, unknown>>
    expect(parsed[0].出片方式).toBe('模板出片(remotion)')
    expect(parsed[1].出片方式).toBe('配方出片')
  })
})
