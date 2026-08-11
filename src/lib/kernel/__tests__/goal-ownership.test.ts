/**
 * C4 —— Goal 必须属于同一个客户，双层防护各自能咬人。
 *
 * 只验证「目标存在」拦不住「A 客户的 run 挂 B 客户的目标」——
 * 那会把 lineage（为什么做 → 产生了什么结果）串台到别的客户身上。
 *
 * 两层：
 *   A. 应用层（submitActionRun）：先拦，说人话（安全告警 + 说清后果）；
 *   B. 数据库层（复合外键 fk_action_runs_goal_same_client）：
 *      绕过应用直接 INSERT 也进不去。
 *
 * 🔴 两层必须**可区分**（上一轮的教训：闸被前一道挡住 = 看起来有测试其实没有）：
 *    应用层拒绝时抛的是带「安全告警」的 KernelError；
 *    数据库层拒绝时报的是外键约束名。断言各自的错误形状，缺一层都会红。
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
const GOAL_B = 'goal-bbbb'

function fixtureWithTwoClients() {
  return makeFixture({
    registry: ACTION_REGISTRY,
    capabilities: createCapabilities,
    options: {
      policy: AUTO_POLICY,
      goals: [
        { id: GOAL_A, client_id: CLIENT_A, title: 'A 客户的目标' },
        { id: GOAL_B, client_id: CLIENT_B, title: 'B 客户的目标' },
      ],
    },
  })
}

function submit(goalId: string) {
  return {
    clientId: CLIENT_A,
    actionKey: KEY,
    purpose: 'growth' as const,
    goalId,
    triggeredBy: 'schedule' as const,
    input: { blog_post_id: POST_A, content_hash: HASH },
  }
}

describe('C4 · Goal 必须属于同一个客户', () => {
  it('✅ A 客户 + A 客户的目标 → 正常跑', async () => {
    const f = fixtureWithTwoClients()
    const outcome = await runAction(f.kernel, submit(GOAL_A))
    expect(outcome.kind).toBe('succeeded')
    expect(f.tables.action_runs[0].goal_id).toBe(GOAL_A)
  })

  it('🔴 A 客户 + B 客户的目标 → 应用层拒绝（安全告警，不是外键约束名）', async () => {
    const f = fixtureWithTwoClients()

    await expect(runAction(f.kernel, submit(GOAL_B))).rejects.toThrow(/安全告警.*不属于这个客户/)
    // 拦在提交之前 —— 一行 run 都没写进去
    expect(f.tables.action_runs).toHaveLength(0)
    expect(f.tables.authorization_decisions).toHaveLength(0)
  })

  it('目标不存在（被删了）→ 应用层拒绝，说的是「目标不存在」不是「跨客户」', async () => {
    const f = fixtureWithTwoClients()
    await expect(runAction(f.kernel, submit('goal-deleted'))).rejects.toThrow(/目标不存在/)
    expect(f.tables.action_runs).toHaveLength(0)
  })

  it('🔴 绕过应用层直接 INSERT（A 客户 + B 客户的目标）→ 数据库层拒绝', async () => {
    const f = fixtureWithTwoClients()

    const { error } = await f.supabase
      .from('action_runs')
      .insert({
        client_id: CLIENT_A,
        purpose: 'growth',
        goal_id: GOAL_B,
        triggered_by: 'agent',
        action_key: KEY,
        action_version: 1,
        input: {},
        idempotency_key: 'bypass-attempt',
        status: 'queued',
      })
      .select('id')

    expect(error?.message).toMatch(/fk_action_runs_goal_same_client/)
    expect(f.tables.action_runs).toHaveLength(0)
  })

  it('绕过应用层直接 INSERT（同客户目标）→ 数据库层放行（约束不误伤正路）', async () => {
    const f = fixtureWithTwoClients()
    const { error } = await f.supabase
      .from('action_runs')
      .insert({
        client_id: CLIENT_A,
        purpose: 'growth',
        goal_id: GOAL_A,
        triggered_by: 'agent',
        action_key: KEY,
        action_version: 1,
        input: {},
        idempotency_key: 'direct-legit',
        status: 'queued',
      })
      .select('id')
    expect(error).toBeNull()
    expect(f.tables.action_runs).toHaveLength(1)
  })

  it('非 growth 任务 goal_id 为 NULL → 两层都不拦（MATCH SIMPLE 语义）', async () => {
    const f = fixtureWithTwoClients()
    const { run } = await submitActionRun(f.kernel, {
      clientId: CLIENT_A,
      actionKey: KEY,
      purpose: 'maintenance',
      goalId: null,
      triggeredBy: 'schedule',
      input: { blog_post_id: POST_A, content_hash: HASH },
    })
    expect(run.goal_id).toBeNull()
  })

  it('读 goals 炸了 → 抛错，不当成「目标不存在」', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: {
        policy: AUTO_POLICY,
        supabaseOptions: {
          failOn: [{ table: 'goals', op: 'select', message: 'connection reset' }],
        },
      },
    })
    // 「读不到目标」和「目标不存在」的处置完全不同：
    // 前者该重试，后者是提交错了 —— 混成一个会把数据库抖动变成错误的拒绝
    await expect(runAction(f.kernel, submit(GOAL_A))).rejects.toThrow(/校验目标归属失败/)
  })

  it('迁移里有复合外键 + goals 的复合唯一索引（真库的那一层不是口头承诺）', () => {
    const { readFileSync } = require('fs') as typeof import('fs')
    const sql = readFileSync('supabase/migrations/20260808000003_me2_execution_kernel_v1.sql', 'utf8')
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_goals_client_id_id')
    expect(sql).toMatch(
      /FOREIGN KEY \(client_id, goal_id\) REFERENCES public\.goals \(client_id, id\)/,
    )
  })
})
