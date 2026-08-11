/**
 * S3（P2-2）—— **已经发生的事实必须先落库，再决定这次算不算成功。**
 *
 * handler 返回的那一刻，钱已经花了、验证结论也已经有了。
 * 如果先判定「超预算 / 没验过」再抛错，这些事实就永远进不了库：
 *   · 数据库以为钱没花 → 死信重跑时 spent 从低估的数字起算 →
 *     再调一次 handler → **真正突破预算上限**；
 *   · 失败的验证结论丢失 → lineage 里查不到「它到底是怎么没做成的」。
 *
 * 另一半：`cost_actual_usd` 是**累计**语义。重试 / 死信重跑都不许让
 * 历史已花的钱变小 —— 变小 = 同一笔预算可以被反复消费。
 *
 * 🔴 第七轮之后这里的契约都是**诚实**的：`stepCeilingUsd` 是硬上限
 *    （这一步含全部重试最多花多少），实际花超了就是契约违约。
 *    早先这些用例声明「不花钱」却真花 1.5，靠事后闸兜 —— 那正是
 *    「先执行、再发现超预算」的形状，现在被开跑前那道硬闸取代了。
 */

import { describe, it, expect, vi } from 'vitest'
import type { ActionDefinition, CapabilityImplementation, CapabilityStepResult } from '../types'
import { runAction, resumeDeadLetterRun } from '../runner'
import { loadActionLineage } from '../lineage'
import { KernelError, RetryableCapabilityError } from '../errors'
import { makeFixture, makeRegistry, CLIENT_A, GOAL_A } from './fixtures'

const KEY = 'seo.build_publish_package'

/** 合成动作：两步、可声明验证、不许重试（把变量收到最少）。 */
function definition(over: Partial<ActionDefinition> = {}): ActionDefinition {
  return {
    actionKey: KEY,
    version: 1,
    title: '花钱的测试动作',
    inputSchema: { type: 'object', required: ['n'], properties: { n: { type: 'string' } }, additionalProperties: false },
    outputSchema: { type: 'object', required: ['done'], properties: { done: { type: 'boolean' } }, additionalProperties: true },
    capability: 'test',
    risk: 'low',
    sideEffect: 'internal_write',
    reversible: true,
    idempotency: { keyFields: ['n'], scope: 'client' },
    costModel: { kind: 'fixed', estimate: () => 0.01, stepCeilingUsd: { a: 2, b: 2 } },
    // 这些用例测的是「重试之内成本怎么累计」，前提就是重试被允许 ——
    // 而收费步骤能不能自动重试，取决于 provider 认不认幂等键（见 P1-4）。
    providerIdempotency: 'supported',
    retryPolicy: { maxAttempts: 1, backoff: 'fixed', baseMs: 1 },
    verification: null,
    requiredCapabilityTier: 'paid_client',
    steps: ['a', 'b'],
    allowedPurposes: ['growth'],
    ...over,
  } as ActionDefinition
}

function capabilityOf(
  steps: Record<string, (s: { attempt: number }) => Promise<CapabilityStepResult>>,
): CapabilityImplementation {
  return { actionKey: KEY as never, version: 1, steps: steps as never }
}

function submit() {
  return {
    clientId: CLIENT_A,
    actionKey: KEY,
    purpose: 'growth' as const,
    goalId: GOAL_A,
    triggeredBy: 'agent' as const,
    input: { n: 'one' },
  }
}

const policyWithCap = (cap: number) => ({
  action_key: KEY,
  mode: 'auto_approve',
  spend_cap_per_run_usd: cap,
})

const stepCost = (f: ReturnType<typeof makeFixture>, key: string) =>
  Number(f.tables.action_run_steps.find((s) => s.step_key === key)!.cost_actual_usd)
const totalCost = (f: ReturnType<typeof makeFixture>) =>
  f.tables.action_run_steps.reduce((sum, s) => sum + Number(s.cost_actual_usd ?? 0), 0)

describe('S3 · 判定失败之前，本次已经花掉的钱先落库', () => {
  it('🔴 声明最多花 0.5、实际花了 1 → 契约违约停手，但库里如实记着 1', async () => {
    const f = makeFixture({
      registry: makeRegistry([
        definition({
          steps: ['a'],
          costModel: { kind: 'fixed', estimate: () => 0.5, stepCeilingUsd: { a: 0.5 } },
        }),
      ]),
      capabilities: () => ({
        [KEY]: capabilityOf({ a: async () => ({ output: { done: true }, costActualUsd: 1 }) }),
      }),
      options: { policy: policyWithCap(0.5) },
    })

    const outcome = await runAction(f.kernel, submit())

    expect(outcome.kind).toBe('dead_letter')
    expect(outcome.execution?.failure?.code).toBe('COST_CONTRACT_VIOLATION')
    // 🔴 关键：钱进了库。不记账才是危险方向 —— 重跑会从低估的数字起算。
    expect(stepCost(f, 'a')).toBe(1)
    // 而且产物也留下了（东西可能真的已经写出去了，lineage 得看得见）
    expect(f.tables.action_run_steps.find((s) => s.step_key === 'a')!.output).toEqual({ done: true })
  })

  it('🔴 handler 同时返回 cost 和没通过的验证 → 两样都持久化，lineage 读得到', async () => {
    const failed = {
      method: 'package_integrity' as const,
      passed: false,
      checks: [{ name: '指纹一致', passed: false, detail: '写进去的跟该写的对不上' }],
      failure_reason: '内容指纹对不上',
    }
    const f = makeFixture({
      registry: makeRegistry([
        definition({
          steps: ['a'],
          verification: { method: 'package_integrity', delayMs: 0 },
          costModel: { kind: 'fixed', estimate: () => 0.25, stepCeilingUsd: { a: 0.25 } },
        }),
      ]),
      capabilities: () => ({
        [KEY]: capabilityOf({
          a: async () => ({ output: { done: true }, costActualUsd: 0.25, verification: failed }),
        }),
      }),
      options: { policy: policyWithCap(10) },
    })

    const outcome = await runAction(f.kernel, submit())

    expect(outcome.kind).toBe('dead_letter')
    expect(outcome.execution?.failure?.code).toBe('VERIFICATION_FAILED')
    expect(stepCost(f, 'a')).toBe(0.25)
    // 🔴 失败的验证结论必须留在库里 —— 不然 lineage 里查不到「它是怎么没做成的」
    const persisted = f.tables.action_run_steps.find((s) => s.step_key === 'a')!.verification
    expect(persisted).toEqual(failed)

    const lineage = await loadActionLineage(f.supabase, outcome.run.id)
    expect(lineage!.verification?.passed).toBe(false)
    expect(lineage!.verification?.failure_reason).toBe('内容指纹对不上')
    expect(lineage!.humanSummary).toContain('验没过')
  })
})

describe('S3 · 死信重跑之后，预算从历史真实花费起算', () => {
  /** a 花 1.5 成功；b 第一次炸、之后每次花 1。两步都诚实声明了上限。 */
  function budgetFixture(cap: number) {
    const control = { failB: true }
    const bCalls = vi.fn()
    const f = makeFixture({
      registry: makeRegistry([
        definition({ costModel: { kind: 'fixed', estimate: () => 2, stepCeilingUsd: { a: 1.5, b: 1 } } }),
      ]),
      capabilities: () => ({
        [KEY]: capabilityOf({
          a: async () => ({ output: { a: 1 }, costActualUsd: 1.5 }),
          b: async () => {
            bCalls()
            if (control.failB) throw new KernelError('INVALID_STATE', '下游还没准备好')
            return { output: { done: true }, costActualUsd: 1 }
          },
        }),
      }),
      options: { policy: policyWithCap(cap) },
    })
    return { f, control, bCalls }
  }

  it('🔴 a 花掉 1.5 之后，b 的上限 1 装不进剩下的 0.5 → 一分钱都不花就停手', async () => {
    // 硬上限的意义就在这里：不是「花超了才发现」，是「装不下就不开跑」。
    const { f, bCalls } = budgetFixture(2)

    const first = await runAction(f.kernel, submit())

    expect(first.kind).toBe('dead_letter')
    expect(first.execution?.failure?.code).toBe('COST_CAP_EXCEEDED')
    expect(stepCost(f, 'a')).toBe(1.5)
    expect(stepCost(f, 'b')).toBe(0)
    expect(bCalls).not.toHaveBeenCalled()
    expect(first.execution?.failure?.humanReason).toContain('这一步不开跑')
  })

  it('🔴 反复重跑也一样：装不下就永远不调 handler，账面一分不动', async () => {
    const { f, control, bCalls } = budgetFixture(2)

    const first = await runAction(f.kernel, submit())
    control.failB = false
    const before = totalCost(f)

    await resumeDeadLetterRun(f.kernel, first.run.id, 'ray@magiclab')
    const second = await resumeDeadLetterRun(f.kernel, first.run.id, 'ray@magiclab')

    expect(second.kind).toBe('dead_letter')
    expect(second.execution?.failure?.code).toBe('COST_CAP_EXCEEDED')
    expect(bCalls).not.toHaveBeenCalled()
    expect(totalCost(f)).toBe(before) // 只增不减，而且根本没增
    expect(stepCost(f, 'a')).toBe(1.5) // a 从头到尾只跑过一次
  })

  it('把上限提高之后再重跑 → 开跑前那道闸放行，这一步真的跑完', async () => {
    const { f, control, bCalls } = budgetFixture(2)

    const first = await runAction(f.kernel, submit())
    expect(first.kind).toBe('dead_letter')
    control.failB = false

    // 人把这个客户的单次上限从 2 提到 10（改规则要升版本）
    const policy = f.tables.client_automation_policies.find((p) => p.action_key === KEY)!
    policy.spend_cap_per_run_usd = 10
    policy.policy_version = Number(policy.policy_version) + 1

    const resumed = await resumeDeadLetterRun(f.kernel, first.run.id, 'ray@magiclab')

    expect(resumed.kind).toBe('succeeded')
    expect(bCalls).toHaveBeenCalledTimes(1)
    expect(stepCost(f, 'a')).toBe(1.5) // a 没重跑（断点续跑）
    expect(stepCost(f, 'b')).toBe(1)
    expect(totalCost(f)).toBe(2.5)
  })

  it('上限一开始就够大 → 重跑正常成功，且总花费如实累加', async () => {
    const { f, control } = budgetFixture(10)

    const first = await runAction(f.kernel, submit())
    expect(first.kind).toBe('dead_letter') // b 第一次抛错

    control.failB = false
    const resumed = await resumeDeadLetterRun(f.kernel, first.run.id, 'ray@magiclab')

    expect(resumed.kind).toBe('succeeded')
    expect(totalCost(f)).toBe(2.5)
  })
})

describe('S3 · 重试之内，同一步的花费也累加', () => {
  it('前两次抛错前没产生花费 → 该步只记最后一次真花的 0.5（累计不等于乱加）', async () => {
    let calls = 0
    const f = makeFixture({
      registry: makeRegistry([
        definition({
          steps: ['a'],
          retryPolicy: { maxAttempts: 3, backoff: 'fixed', baseMs: 1 },
          costModel: { kind: 'fixed', estimate: () => 0.5, stepCeilingUsd: { a: 0.5 } },
        }),
      ]),
      capabilities: () => ({
        [KEY]: capabilityOf({
          a: async () => {
            calls += 1
            if (calls < 3) throw new RetryableCapabilityError('上游 429')
            return { output: { done: true }, costActualUsd: 0.5 }
          },
        }),
      }),
      options: { policy: policyWithCap(10) },
    })

    const outcome = await runAction(f.kernel, submit())
    expect(outcome.kind).toBe('succeeded')
    // 前两次抛错前没返回 cost，所以只有最后一次的 0.5 —— 这条确认「不多算」
    expect(stepCost(f, 'a')).toBe(0.5)
  })

  it('🔴 每次尝试都返回 cost（钱真花了才失败）→ 累计，不被最后一次覆盖', async () => {
    let calls = 0
    const f = makeFixture({
      registry: makeRegistry([
        definition({
          steps: ['a'],
          retryPolicy: { maxAttempts: 3, backoff: 'fixed', baseMs: 1 },
          verification: { method: 'package_integrity', delayMs: 0 },
          // 🔴 上限的口径是**这一步的总花费**：0.4 × 3 次 = 1.2。
          //    按「每次尝试最多 0.4」算的话，重试 N 次就能花到 N × 0.4，硬上限当场失效。
          costModel: { kind: 'fixed', estimate: () => 1.2, stepCeilingUsd: { a: 1.2 } },
        }),
      ]),
      capabilities: () => ({
        [KEY]: capabilityOf({
          a: async () => {
            calls += 1
            return {
              output: { done: true },
              costActualUsd: 0.4,
              verification:
                calls < 3
                  ? { method: 'package_integrity' as const, passed: false, checks: [], failure_reason: '没验过' }
                  : { method: 'package_integrity' as const, passed: true, checks: [] },
            }
          },
        }),
      }),
      options: { policy: policyWithCap(10) },
    })

    const first = await runAction(f.kernel, submit())
    // 验证不过不重试 → 一次就死信，但那 0.4 已经花了
    expect(first.kind).toBe('dead_letter')
    expect(stepCost(f, 'a')).toBe(0.4)

    // 重跑：第二次仍然验证不过，钱累加到 0.8
    const second = await resumeDeadLetterRun(f.kernel, first.run.id, 'ray@magiclab')
    expect(second.kind).toBe('dead_letter')
    expect(stepCost(f, 'a')).toBeCloseTo(0.8, 10)

    // 第三次验证通过，钱累加到 1.2 —— **从头到尾没有一次变小**
    const third = await resumeDeadLetterRun(f.kernel, first.run.id, 'ray@magiclab')
    expect(third.kind).toBe('succeeded')
    expect(stepCost(f, 'a')).toBeCloseTo(1.2, 10)
  })

  it('🔴 重试把这一步的总花费顶破声明上限 → 契约违约（不是「每次都没超就行」）', async () => {
    let calls = 0
    const f = makeFixture({
      registry: makeRegistry([
        definition({
          steps: ['a'],
          retryPolicy: { maxAttempts: 3, backoff: 'fixed', baseMs: 1 },
          // 声明这一步总共最多 0.5，但它每次尝试都花 0.4
          costModel: { kind: 'fixed', estimate: () => 0.5, stepCeilingUsd: { a: 0.5 } },
        }),
      ]),
      capabilities: () => ({
        [KEY]: capabilityOf({
          a: async () => {
            calls += 1
            if (calls < 3) throw new RetryableCapabilityError('上游 429')
            return { output: { done: true }, costActualUsd: 0.4 }
          },
        }),
      }),
      options: { policy: policyWithCap(10) },
    })

    // 第一轮：前两次抛错没产生花费，第三次花 0.4 → 0.4 <= 0.5，通过
    const first = await runAction(f.kernel, submit())
    expect(first.kind).toBe('succeeded')
    expect(stepCost(f, 'a')).toBe(0.4)

    // 把它打回死信再跑一次 → 累计 0.8 > 声明的 0.5
    const step = f.tables.action_run_steps.find((s) => s.step_key === 'a')!
    step.status = 'dead_letter'
    const run = f.tables.action_runs[0]
    run.status = 'dead_letter'
    calls = 2 // 让下一次调用直接返回花费

    const again = await resumeDeadLetterRun(f.kernel, first.run.id, 'ray@magiclab')
    expect(again.kind).toBe('dead_letter')
    expect(again.execution?.failure?.code).toBe('COST_CONTRACT_VIOLATION')
    expect(stepCost(f, 'a')).toBeCloseTo(0.8, 10) // 钱照样如实记账
  })
})

describe('S3 · 成功路径的原有行为不变', () => {
  it('正常成功时 cost / verification / output 照旧落库', async () => {
    const ok = { method: 'package_integrity' as const, passed: true, checks: [{ name: '回读', passed: true }] }
    const f = makeFixture({
      registry: makeRegistry([
        definition({
          steps: ['a'],
          verification: { method: 'package_integrity', delayMs: 0 },
          costModel: { kind: 'fixed', estimate: () => 0.3, stepCeilingUsd: { a: 0.3 } },
        }),
      ]),
      capabilities: () => ({
        [KEY]: capabilityOf({
          a: async () => ({ output: { done: true }, costActualUsd: 0.3, verification: ok }),
        }),
      }),
      options: { policy: policyWithCap(10) },
    })

    const outcome = await runAction(f.kernel, submit())

    expect(outcome.kind).toBe('succeeded')
    const step = f.tables.action_run_steps.find((s) => s.step_key === 'a')!
    expect(step.status).toBe('succeeded')
    expect(step.cost_actual_usd).toBe(0.3)
    expect(step.verification).toEqual(ok)
    expect(step.output).toEqual({ done: true })
    expect(outcome.execution?.verification).toEqual(ok)
  })
})
