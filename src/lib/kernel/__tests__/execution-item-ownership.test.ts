/**
 * S2（P2-1）—— 执行看板卡片必须属于同一个客户，双层防护各自能咬人。
 *
 * 跟 Goal 是**完全同一个洞**：挂错客户的卡片 = 执行按 A 的内容和授权跑，
 * lineage / 看板关系却挂到 B —— 归因和「这件事为谁做的」当场串台。
 *
 * 两层可区分：应用层抛「安全告警」文案；数据库层报外键约束名。
 */

import { describe, it, expect } from 'vitest'
import { runAction, submitActionRun } from '../runner'
import { ACTION_REGISTRY } from '../registry'
import { createCapabilities, computeBlogContentHash } from '@/lib/capabilities'
import type { BlogDraftRow } from '@/lib/capabilities/seo/build-publish-package'
import { makeFixture, CLIENT_A, CLIENT_B, GOAL_A, POST_A, BLOG_DRAFT } from './fixtures'

const KEY = 'seo.build_publish_package'
const HASH = computeBlogContentHash(BLOG_DRAFT as unknown as BlogDraftRow)
const AUTO_POLICY = { action_key: KEY, mode: 'auto_approve', spend_cap_per_run_usd: 0 }
const ITEM_A = 'item-aaaa'
const ITEM_B = 'item-bbbb'

function fixtureWithTwoClients() {
  return makeFixture({
    registry: ACTION_REGISTRY,
    capabilities: createCapabilities,
    options: {
      policy: AUTO_POLICY,
      executionItems: [
        { id: ITEM_A, client_id: CLIENT_A, title: 'A 客户看板上的卡片' },
        { id: ITEM_B, client_id: CLIENT_B, title: 'B 客户看板上的卡片' },
      ],
    },
  })
}

function submit(executionItemId: string | null) {
  return {
    clientId: CLIENT_A,
    actionKey: KEY,
    purpose: 'growth' as const,
    goalId: GOAL_A,
    executionItemId,
    triggeredBy: 'schedule' as const,
    input: { blog_post_id: POST_A, content_hash: HASH },
  }
}

describe('S2 · 执行卡片必须属于同一个客户', () => {
  it('✅ A 客户 + A 客户的卡片 → 正常跑，lineage 挂对', async () => {
    const f = fixtureWithTwoClients()
    const outcome = await runAction(f.kernel, submit(ITEM_A))
    expect(outcome.kind).toBe('succeeded')
    expect(f.tables.action_runs[0].execution_item_id).toBe(ITEM_A)
  })

  it('🔴 A 客户 + B 客户的卡片 → 应用层拒绝（安全告警），一行 run 都不写', async () => {
    const f = fixtureWithTwoClients()

    await expect(runAction(f.kernel, submit(ITEM_B))).rejects.toThrow(
      /安全告警.*执行卡片不属于这个客户/,
    )
    expect(f.tables.action_runs).toHaveLength(0)
    expect(f.tables.authorization_decisions).toHaveLength(0)
    expect(f.tables.production_packages).toHaveLength(0)
  })

  it('卡片不存在（被删了）→ 说的是「卡片不存在」，不是「跨客户」', async () => {
    const f = fixtureWithTwoClients()
    await expect(runAction(f.kernel, submit('item-deleted'))).rejects.toThrow(/执行卡片不存在/)
    expect(f.tables.action_runs).toHaveLength(0)
  })

  it('🔴 绕过应用层直接 INSERT（A 客户 + B 客户的卡片）→ 数据库层拒绝', async () => {
    const f = fixtureWithTwoClients()

    const { error } = await f.supabase
      .from('action_runs')
      .insert({
        client_id: CLIENT_A,
        purpose: 'growth',
        goal_id: GOAL_A,
        execution_item_id: ITEM_B,
        triggered_by: 'agent',
        action_key: KEY,
        action_version: 1,
        input: {},
        idempotency_key: 'bypass-item',
        status: 'queued',
      })
      .select('id')

    expect(error?.message).toMatch(/fk_action_runs_execution_item_same_client/)
    expect(f.tables.action_runs).toHaveLength(0)
  })

  it('绕过应用层直接 INSERT（同客户卡片）→ 放行（约束不误伤正路）', async () => {
    const f = fixtureWithTwoClients()
    const { error } = await f.supabase
      .from('action_runs')
      .insert({
        client_id: CLIENT_A,
        purpose: 'growth',
        goal_id: GOAL_A,
        execution_item_id: ITEM_A,
        triggered_by: 'agent',
        action_key: KEY,
        action_version: 1,
        input: {},
        idempotency_key: 'direct-legit-item',
        status: 'queued',
      })
      .select('id')
    expect(error).toBeNull()
    expect(f.tables.action_runs).toHaveLength(1)
  })

  it('execution_item_id 为 NULL → 两层都不拦（MATCH SIMPLE 语义）', async () => {
    const f = fixtureWithTwoClients()
    const { run } = await submitActionRun(f.kernel, submit(null))
    expect(run.execution_item_id).toBeNull()
  })

  it('🔴 读 execution_items 炸了 → 抛错，不当成「卡片不存在」', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: {
        policy: AUTO_POLICY,
        executionItems: [{ id: ITEM_A, client_id: CLIENT_A }],
        supabaseOptions: {
          failOn: [{ table: 'execution_items', op: 'select', message: 'connection reset' }],
        },
      },
    })
    // 「读不到卡片」和「卡片不存在」的处置完全不同：
    // 前者该重试，后者是提交错了 —— 混成一个会把数据库抖动变成错误的拒绝
    await expect(runAction(f.kernel, submit(ITEM_A))).rejects.toThrow(/校验执行卡片归属失败/)
    expect(f.tables.action_runs).toHaveLength(0)
  })
})

describe('S2 · 删除侧的引用动作（SQL 和内存复刻必须同一套语义）', () => {
  it('🔴 删掉看板卡片 → 执行台账留下，只把指针置空（ON DELETE SET NULL）', async () => {
    const f = fixtureWithTwoClients()
    const outcome = await runAction(f.kernel, submit(ITEM_A))
    expect(outcome.kind).toBe('succeeded')

    // 撤回营销计划会批量删 pending 卡片 —— 这是常规操作，不该连累执行记录
    const { error } = await f.supabase.from('execution_items').delete().eq('id', ITEM_A)
    expect(error).toBeNull()

    expect(f.tables.action_runs).toHaveLength(1)
    expect(f.tables.action_runs[0].execution_item_id).toBeNull()
    expect(f.tables.action_runs[0].status).toBe('succeeded') // 台账本身一个字没动
  })

  it('🔴 删掉已经有执行台账的目标 → 直接报外键错（NO ACTION，删不掉）', async () => {
    const f = fixtureWithTwoClients()
    await runAction(f.kernel, submit(ITEM_A))

    const { error } = await f.supabase.from('goals').delete().eq('id', GOAL_A)
    // 不是 SET NULL：growth 的 run 置空 goal_id 会当场违反 goal_matches_purpose，
    // 所以这里诚实地报「删不掉」，而不是留一条半残的记录
    expect(error?.message).toContain('fk_action_runs_goal_same_client')
    expect(f.tables.goals.some((g) => g.id === GOAL_A)).toBe(true)
    expect(f.tables.action_runs[0].goal_id).toBe(GOAL_A)
  })

  it('删掉没有任何执行台账的目标 → 正常删掉（不是一刀切禁止删）', async () => {
    const f = fixtureWithTwoClients()
    const { error } = await f.supabase.from('goals').delete().eq('id', GOAL_A)
    expect(error).toBeNull()
    expect(f.tables.goals.some((g) => g.id === GOAL_A)).toBe(false)
  })
})
