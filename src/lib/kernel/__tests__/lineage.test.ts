/**
 * Lineage —— 「为什么做 / 谁授权 / 做到哪 / 是否做成 / 产生了什么结果」
 * 五个问题必须有一条链能一口气回答。
 *
 * 现状是这条链一条都串不起来（全仓只有一条跨表 lineage 边）。
 * 这一组测的就是新链**真的接上了**，而不是字段建好了没人连。
 */

import { describe, it, expect } from 'vitest'
import { runAction } from '../runner'
import { loadActionLineage } from '../lineage'
import { ACTION_REGISTRY } from '../registry'
import { createCapabilities, computeBlogContentHash } from '@/lib/capabilities'
import type { BlogDraftRow } from '@/lib/capabilities/seo/build-publish-package'
import { makeFixture, CLIENT_A, GOAL_A, POST_A, BLOG_DRAFT } from './fixtures'
import type { FakeSupabaseOptions } from './fake-supabase'

const HASH = computeBlogContentHash(BLOG_DRAFT as unknown as BlogDraftRow)
const AUTO_POLICY = {
  action_key: 'seo.build_publish_package',
  mode: 'auto_approve',
  spend_cap_per_run_usd: 0,
}

function submit() {
  return {
    clientId: CLIENT_A,
    actionKey: 'seo.build_publish_package',
    purpose: 'growth' as const,
    goalId: GOAL_A,
    triggeredBy: 'signal' as const,
    triggeredByRef: 'seo-patrol:finding-42',
    rationale: '学区这一簇覆盖太薄',
    input: { blog_post_id: POST_A, content_hash: HASH },
  }
}

describe('Lineage：goal → run → 授权 → 步骤 → 验证 → 业务结果', () => {
  it('接上归因之后，整条链一次查得全', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: AUTO_POLICY },
    })

    const outcome = await runAction(f.kernel, submit())
    expect(outcome.kind).toBe('succeeded')

    // 模拟 V 段回流：一条飞轮动作挂到这个 run 上，再挂两条归因结果
    f.tables.flywheel_actions.push({
      id: 'fa-1',
      client_id: CLIENT_A,
      action_run_id: outcome.run.id,
      flywheel: 'seo',
      action_type: 'seo.build_publish_package',
    })
    f.tables.flywheel_outcomes.push(
      { id: 'fo-1', action_id: 'fa-1', client_id: CLIENT_A, metric_key: 'seo.domain.organic_traffic', verdict: 'confirmed', window_days: 14 },
      { id: 'fo-2', action_id: 'fa-1', client_id: CLIENT_A, metric_key: 'seo.gsc.clicks', verdict: 'inconclusive', window_days: 28 },
    )

    const lineage = await loadActionLineage(f.supabase, outcome.run.id)

    expect(lineage!.goal?.id).toBe(GOAL_A)
    expect(lineage!.run.triggered_by).toBe('signal')
    expect(lineage!.run.triggered_by_ref).toBe('seo-patrol:finding-42')
    expect(lineage!.authorization?.id).toBe(outcome.run.authorization_decision_id)
    expect(lineage!.steps.map((s) => s.step_key)).toEqual(['build', 'persist', 'verify'])
    expect(lineage!.verification?.passed).toBe(true)
    expect(lineage!.flywheelActionIds).toEqual(['fa-1'])
    expect(lineage!.outcomes.map((o) => o.metric_key).sort()).toEqual([
      'seo.domain.organic_traffic',
      'seo.gsc.clicks',
    ])
    expect(lineage!.humanSummary).toContain('已回流 2 条业务结果')
  })

  it('还没回流业务结果时，说的是「还没有」，不是假装有', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: AUTO_POLICY },
    })
    const outcome = await runAction(f.kernel, submit())
    const lineage = await loadActionLineage(f.supabase, outcome.run.id)

    expect(lineage!.outcomes).toEqual([])
    expect(lineage!.humanSummary).toContain('还没有业务结果回流')
  })

  it('被拒绝的动作也查得到链 —— 包括「谁拒的、为什么」', async () => {
    const f = makeFixture({ registry: ACTION_REGISTRY, capabilities: createCapabilities })

    const outcome = await runAction(f.kernel, submit())
    expect(outcome.kind).toBe('denied')

    const lineage = await loadActionLineage(f.supabase, outcome.run.id)
    expect(lineage!.authorization?.verdict).toBe('deny')
    expect(lineage!.authorization?.deny_code).toBe('no_policy')
    expect(lineage!.steps).toEqual([])
    expect(lineage!.humanSummary).toContain('0 步')
  })

  it('🔴 读目标时数据库炸了 → 抛错，不悄悄说成「这条动作没挂目标」', async () => {
    // failOn 的数组是活引用：先让 run 正常跑完（提交时 C4 的 goal 归属检查
    // 也要读 goals，不能一开始就炸），**之后**才把 goals 的读故障装上。
    const failures: NonNullable<FakeSupabaseOptions['failOn']> = []
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: AUTO_POLICY, supabaseOptions: { failOn: failures } },
    })
    const outcome = await runAction(f.kernel, submit())
    expect(outcome.kind).toBe('succeeded')

    failures.push({ table: 'goals', op: 'select', message: 'timeout' })

    await expect(loadActionLineage(f.supabase, outcome.run.id)).rejects.toThrow(/读取目标失败/)
  })
})
