/**
 * P1-2 —— 同一件事并发提交，只能真正做一次。
 *
 * 顺序调两次 `runAction()` 证明不了幂等：那只是「第二次查到了第一次的结果」。
 * 真正要防的是两个调用**同时**发生：
 *   · 两边同时查到「还没有」→ 同时 INSERT（靠唯一约束分胜负，输的那个不能抛 500）
 *   · 两边同时拿到同一个 run → 同时授权 → 各签一份 allow → 两个 capability 一起跑
 *
 * 所以这里全部用 `Promise.all`，并且断言的是**副作用次数**（capability 调了几次、
 * 库里多了几行），不是返回值好不好看。
 */

import { describe, it, expect, vi } from 'vitest'
import { runAction, submitActionRun } from '../runner'
import { authorizeRun } from '../authorize'
import { executeAuthorizedRun } from '../gateway'
import { ACTION_REGISTRY } from '../registry'
import { createCapabilities, computeBlogContentHash } from '@/lib/capabilities'
import type { BlogDraftRow } from '@/lib/capabilities/seo/build-publish-package'
import { makeFixture, CLIENT_A, GOAL_A, POST_A, BLOG_DRAFT, liveFence } from './fixtures'

const KEY = 'seo.build_publish_package'
const HASH = computeBlogContentHash(BLOG_DRAFT as unknown as BlogDraftRow)
const AUTO_POLICY = { action_key: KEY, mode: 'auto_approve', spend_cap_per_run_usd: 0 }

function submit() {
  return {
    clientId: CLIENT_A,
    actionKey: KEY,
    purpose: 'growth' as const,
    goalId: GOAL_A,
    triggeredBy: 'schedule' as const,
    input: { blog_post_id: POST_A, content_hash: HASH },
  }
}

/** 装一层计数：`build` 被调几次 = capability 真正开跑了几次。 */
function countingCapabilities(counter: () => void) {
  return (sb: Parameters<typeof createCapabilities>[0]) => {
    const real = createCapabilities(sb)
    const impl = real[KEY]
    return {
      [KEY]: {
        ...impl,
        steps: {
          ...impl.steps,
          build: async (s: Parameters<(typeof impl.steps)['build']>[0]) => {
            counter()
            return impl.steps.build(s)
          },
        },
      },
    }
  }
}

describe('P1-2 · 并发提交同一件事', () => {
  it('🔴 两个调用同时提交 → 一个 run、一个执行者、一个包，两边都不抛异常', async () => {
    const builds = vi.fn()
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: countingCapabilities(builds),
      options: { policy: AUTO_POLICY },
    })

    const results = await Promise.all([
      runAction(f.kernel, submit()),
      runAction(f.kernel, submit()),
    ])

    // ① 只有一条 run
    expect(f.tables.action_runs).toHaveLength(1)
    // ② capability 只真正跑了一次
    expect(builds).toHaveBeenCalledTimes(1)
    // ③ 只产出一个包
    expect(f.tables.production_packages).toHaveLength(1)
    // ④ 只有一条 allow 决策，也就是只有一个「谁批的」的答案
    expect(f.tables.authorization_decisions.filter((d) => d.verdict === 'allow')).toHaveLength(1)
    // ⑤ 两边都拿到了明确结果，没有一个是异常
    const kinds = results.map((r) => r.kind).sort()
    expect(kinds).toEqual(['in_progress', 'succeeded'])
    // ⑥ 输的那个拿到的是同一个 run，不是 500
    expect(results[0].run.id).toBe(results[1].run.id)
  })

  it('四个调用同时提交也一样（不是碰巧两个能过）', async () => {
    const builds = vi.fn()
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: countingCapabilities(builds),
      options: { policy: AUTO_POLICY },
    })

    const results = await Promise.all([
      runAction(f.kernel, submit()),
      runAction(f.kernel, submit()),
      runAction(f.kernel, submit()),
      runAction(f.kernel, submit()),
    ])

    expect(f.tables.action_runs).toHaveLength(1)
    expect(builds).toHaveBeenCalledTimes(1)
    expect(f.tables.production_packages).toHaveLength(1)
    expect(results.filter((r) => r.kind === 'succeeded')).toHaveLength(1)
    expect(results.filter((r) => r.kind === 'in_progress')).toHaveLength(3)
  })

  it('🔴 同一个 run 签出了两份 allow 决策时，也只有一个能开跑', async () => {
    // 这是 GPT review 里点名的那条路：如果有两个调用方各签一份授权，
    // 「各自原子地兑换各自那一条」并不能阻止两个 capability 同时跑 ——
    // 兑换的是决策，不是执行权。所以这里直接构造两份 allow 决策。
    const builds = vi.fn()
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: countingCapabilities(builds),
      options: { policy: AUTO_POLICY },
    })

    const { run } = await submitActionRun(f.kernel, submit())
    const first = await authorizeRun(f.kernel, run)
    // 手工再签一份（模拟并发下的双重授权）
    const reset = await f.supabase
      .from('action_runs')
      .update({ status: 'queued' })
      .eq('id', run.id)
      .select('id')
    expect(reset.error).toBeNull()
    const second = await authorizeRun(f.kernel, await f.kernel.requireRun(run.id))

    expect(first.ctx).toBeTruthy()
    expect(second.ctx).toBeTruthy()
    expect(f.tables.authorization_decisions.filter((d) => d.verdict === 'allow')).toHaveLength(2)

    const settled = await Promise.allSettled([
      executeAuthorizedRun(f.kernel, first.ctx!, liveFence(f)),
      executeAuthorizedRun(f.kernel, second.ctx!, liveFence(f)),
    ])

    // 只有 run 当前指着的那份（second）能领到执行权
    const ok = settled.filter((s) => s.status === 'fulfilled')
    const rejected = settled.filter((s) => s.status === 'rejected')
    expect(ok).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(String((rejected[0] as PromiseRejectedResult).reason)).toMatch(
      /已经不是这件事当前那一份|不在「等着跑」的状态/,
    )

    expect(builds).toHaveBeenCalledTimes(1)
    expect(f.tables.production_packages).toHaveLength(1)
  })

  it('已经跑完之后再并发提交 → 全是幂等命中，capability 一次都不再调', async () => {
    const builds = vi.fn()
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: countingCapabilities(builds),
      options: { policy: AUTO_POLICY },
    })

    await runAction(f.kernel, submit())
    expect(builds).toHaveBeenCalledTimes(1)

    const again = await Promise.all([
      runAction(f.kernel, submit()),
      runAction(f.kernel, submit()),
    ])

    expect(again.every((r) => r.kind === 'idempotent_hit')).toBe(true)
    expect(builds).toHaveBeenCalledTimes(1)
    expect(f.tables.production_packages).toHaveLength(1)
  })
})
