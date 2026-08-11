/**
 * P1-4 —— **provider 已经收了钱，然后才抛错。**
 *
 * 这是硬预算最难的一条边界：
 *   provider 扣款成功 → 网络超时 / JSON 解析失败 / 502
 *   → handler 抛异常，没有 `CapabilityStepResult`
 *   → `costActualUsd` 没机会返回
 *   → Kernel 记 0 元并重试
 *   → provider 不认幂等键的话，**每次重试都再收一遍**。
 *
 * 🔴 Kernel 不能凭空知道 provider 扣了多少钱。所以契约被写成可执行的安全规则：
 *
 *   A. 能可靠拿到已扣金额的，把它挂在异常上带回来（`costActualUsd`），
 *      Kernel 先落库、再决定重不重试 —— 顺序跟成功路径一致（事实先于判定）。
 *   B. 拿不到、且 provider 不保证幂等重放 → **一律 fail closed，不自动重试**，
 *      转死信让人来判。
 *   C. 零成本的内部动作（v1 唯一上线的那个）完全不受影响。
 *
 * 🔴 不声称 Kernel 能给不支持幂等的 provider exactly-once。
 */

import { describe, it, expect, vi } from 'vitest'
import type { ActionDefinition, CapabilityImplementation, CapabilityStepResult } from '../types'
import { runAction, resumeDeadLetterRun, submitActionRun } from '../runner'
import { RetryableCapabilityError } from '../errors'
import { ACTION_REGISTRY } from '../registry'
import { createCapabilities, computeBlogContentHash } from '@/lib/capabilities'
import type { BlogDraftRow } from '@/lib/capabilities/seo/build-publish-package'
import { makeFixture, makeRegistry, CLIENT_A, GOAL_A, POST_A, BLOG_DRAFT } from './fixtures'

const KEY = 'seo.build_publish_package'
const HASH = computeBlogContentHash(BLOG_DRAFT as unknown as BlogDraftRow)

function paidDefinition(over: Partial<ActionDefinition> = {}): ActionDefinition {
  return {
    actionKey: KEY,
    version: 1,
    title: '会花钱的外部动作',
    inputSchema: { type: 'object', required: ['n'], properties: { n: { type: 'string' } }, additionalProperties: false },
    outputSchema: { type: 'object', required: ['done'], properties: { done: { type: 'boolean' } }, additionalProperties: true },
    capability: 'test',
    risk: 'low',
    sideEffect: 'internal_write',
    reversible: true,
    idempotency: { keyFields: ['n'], scope: 'client' },
    costModel: { kind: 'fixed', estimate: () => 1, stepCeilingUsd: { a: 5 } },
    providerIdempotency: 'unsupported',
    retryPolicy: { maxAttempts: 3, backoff: 'fixed', baseMs: 1 },
    verification: null,
    requiredCapabilityTier: 'paid_client',
    steps: ['a'],
    allowedPurposes: ['growth'],
    ...over,
  } as ActionDefinition
}

function capabilityOf(
  steps: Record<string, () => Promise<CapabilityStepResult>>,
): CapabilityImplementation {
  return { actionKey: KEY as never, version: 1, steps: steps as never }
}

const submit = () => ({
  clientId: CLIENT_A,
  actionKey: KEY,
  purpose: 'growth' as const,
  goalId: GOAL_A,
  triggeredBy: 'agent' as const,
  input: { n: 'one' },
})

const policyWithCap = (cap: number) => ({
  action_key: KEY,
  mode: 'auto_approve',
  spend_cap_per_run_usd: cap,
})

const stepCost = (f: { tables: Record<string, Array<Record<string, unknown>>> }, key = 'a') =>
  Number(f.tables.action_run_steps.find((s) => s.step_key === key)!.cost_actual_usd)

describe('P1-4 · provider 收了钱才抛错', () => {
  it('🔴 异常带着已扣金额 → 钱落库，不是记 0 元', async () => {
    const calls = vi.fn()
    const f = makeFixture({
      registry: makeRegistry([paidDefinition({ providerIdempotency: 'supported' })]),
      capabilities: () => ({
        [KEY]: capabilityOf({
          a: async () => {
            calls()
            // 已经扣了 1.25，然后读响应超时
            throw new RetryableCapabilityError('读响应超时', { costActualUsd: 1.25 })
          },
        }),
      }),
      options: { policy: policyWithCap(10) },
    })

    const out = await runAction(f.kernel, submit())

    expect(out.kind).toBe('dead_letter')
    // 🔴 三次尝试各扣 1.25 → 账本如实记 3.75，不是 0
    expect(calls).toHaveBeenCalledTimes(3)
    expect(stepCost(f)).toBeCloseTo(3.75, 10)
  })

  it('🔴 抛错带回来的金额也要过合法性校验（NaN 不许进账本）', async () => {
    const f = makeFixture({
      registry: makeRegistry([paidDefinition({ providerIdempotency: 'supported' })]),
      capabilities: () => ({
        [KEY]: capabilityOf({
          a: async () => {
            throw new RetryableCapabilityError('坏响应', { costActualUsd: Number.NaN })
          },
        }),
      }),
      options: { policy: policyWithCap(10) },
    })

    const out = await runAction(f.kernel, submit())

    expect(out.kind).toBe('dead_letter')
    expect(out.execution?.failure?.code).toBe('INVALID_COST')
    expect(stepCost(f)).toBe(0) // 账本没被污染
  })

  it('🔴 结果未知 + provider 不保证幂等 → **不自动重试**，转死信', async () => {
    const calls = vi.fn()
    const f = makeFixture({
      registry: makeRegistry([paidDefinition({ providerIdempotency: 'unsupported' })]),
      capabilities: () => ({
        [KEY]: capabilityOf({
          a: async () => {
            calls()
            throw new RetryableCapabilityError('网关 502，不知道那边到底扣没扣')
          },
        }),
      }),
      options: { policy: policyWithCap(10) },
    })

    const out = await runAction(f.kernel, submit())

    expect(out.kind).toBe('dead_letter')
    expect(out.execution?.failure?.code).toBe('UNSAFE_RETRY')
    // 🔴 只调了一次 —— 重试可能再收一次钱，那不是 Kernel 能替客户冒的险
    expect(calls).toHaveBeenCalledTimes(1)
    expect(out.execution?.failure?.humanReason).toContain('不自动重试')
  })

  it('🔴 说不出每步上限的动作同样按「可能收费」处置（不确定就别重试）', async () => {
    const calls = vi.fn()
    const f = makeFixture({
      registry: makeRegistry([
        // 没有 stepCeilingUsd，estimate 是正数 → 说不出上界
        paidDefinition({ costModel: { kind: 'fixed', estimate: () => 1 } }),
      ]),
      capabilities: () => ({
        [KEY]: capabilityOf({
          a: async () => {
            calls()
            throw new RetryableCapabilityError('超时')
          },
        }),
      }),
      options: { policy: policyWithCap(10) },
    })

    const out = await runAction(f.kernel, submit())

    expect(out.kind).toBe('dead_letter')
    // 说不出上界的付费步骤在开跑前就被拦了，handler 一次都没调
    expect(calls).not.toHaveBeenCalled()
  })

  it('✅ provider 保证幂等 → 可以按同一把键重试', async () => {
    const keys: string[] = []
    let n = 0
    const f = makeFixture({
      registry: makeRegistry([paidDefinition({ providerIdempotency: 'supported' })]),
      capabilities: () => ({
        [KEY]: {
          actionKey: KEY as never,
          version: 1,
          steps: {
            a: async (s: { idempotencyKey: string }) => {
              keys.push(s.idempotencyKey)
              n += 1
              if (n < 3) throw new RetryableCapabilityError('上游 429')
              return { output: { done: true }, costActualUsd: 0.5 }
            },
          } as never,
        },
      }),
      options: { policy: policyWithCap(10) },
    })

    const out = await runAction(f.kernel, submit())

    expect(out.kind).toBe('succeeded')
    expect(n).toBe(3)
    // 🔴 三次尝试出示的是**同一把键** —— 这才是重试安全的依据
    expect(new Set(keys).size).toBe(1)
  })

  it('✅ 零成本的内部动作不受影响：照常重试、照常跑完', async () => {
    let n = 0
    const f = makeFixture({
      registry: makeRegistry([
        paidDefinition({
          providerIdempotency: 'not_applicable',
          costModel: { kind: 'fixed', estimate: () => 0 }, // 契约说它根本不花钱
        }),
      ]),
      capabilities: () => ({
        [KEY]: capabilityOf({
          a: async () => {
            n += 1
            if (n < 3) throw new RetryableCapabilityError('临时抖动')
            return { output: { done: true }, costActualUsd: 0 }
          },
        }),
      }),
      options: { policy: policyWithCap(0) },
    })

    const out = await runAction(f.kernel, submit())

    expect(out.kind).toBe('succeeded')
    expect(n).toBe(3) // 重试没被这条规则误伤
  })

  it('✅ v1 真正上线的那个安全能力完全不受影响（回归护栏）', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: { action_key: KEY, mode: 'auto_approve', spend_cap_per_run_usd: 0 } },
    })

    const out = await runAction(f.kernel, {
      clientId: CLIENT_A,
      actionKey: KEY,
      purpose: 'growth',
      goalId: GOAL_A,
      triggeredBy: 'schedule',
      input: { blog_post_id: POST_A, content_hash: HASH },
    })

    expect(out.kind).toBe('succeeded')
    expect(f.tables.production_packages).toHaveLength(1)
  })

  it('🔴 重试循环里也守硬上限：上限 $2 就只能花 $2，不是 maxAttempts × $2', async () => {
    // 🔴 这条是「抛错也记账」自己带进来的洞的回归护栏。
    //    预检以前每个步骤只跑一次（在 while 之前），所以重试循环整个绕过硬上限：
    //    实测上限 $2 的授权，三次重试各扣 $2，落库 $6，失败码还是 provider 的原始错误。
    //    现在预检**每次尝试之前**都跑，第二次尝试在「这一步预算已花完」那道闸上就停住。
    const calls = vi.fn()
    const f = makeFixture({
      registry: makeRegistry([
        paidDefinition({
          providerIdempotency: 'supported',
          retryPolicy: { maxAttempts: 3, backoff: 'fixed', baseMs: 1 },
          costModel: { kind: 'fixed', estimate: () => 2, stepCeilingUsd: { a: 2 } },
        }),
      ]),
      capabilities: () => ({
        [KEY]: capabilityOf({
          a: async () => {
            calls()
            throw new RetryableCapabilityError('扣了 2 块又超时', { costActualUsd: 2 })
          },
        }),
      }),
      options: { policy: policyWithCap(2) },
    })

    const out = await runAction(f.kernel, submit())

    expect(out.kind).toBe('dead_letter')
    // 🔴 只花了 2，不是 6
    expect(stepCost(f)).toBe(2)
    expect(calls).toHaveBeenCalledTimes(1)
    expect(out.execution?.failure?.code).toBe('COST_CAP_EXCEEDED')
  })

  it('🔴 抛错记下的钱和历史花费一起受硬上限管（重跑不许再突破）', async () => {
    const calls = vi.fn()
    const f = makeFixture({
      registry: makeRegistry([
        paidDefinition({
          providerIdempotency: 'supported',
          retryPolicy: { maxAttempts: 1, backoff: 'fixed', baseMs: 1 },
          costModel: { kind: 'fixed', estimate: () => 1, stepCeilingUsd: { a: 2 } },
        }),
      ]),
      capabilities: () => ({
        [KEY]: capabilityOf({
          a: async () => {
            calls()
            throw new RetryableCapabilityError('扣了钱又超时', { costActualUsd: 2 })
          },
        }),
      }),
      options: { policy: policyWithCap(2) },
    })

    const first = await runAction(f.kernel, submit())
    expect(first.kind).toBe('dead_letter')
    expect(stepCost(f)).toBe(2) // 抛错时那 2 块如实记账
    expect(calls).toHaveBeenCalledTimes(1)

    // 重跑：这一步的上限 2 已经花完 → 开跑前就拦住，一分钱不再花
    const again = await resumeDeadLetterRun(f.kernel, first.run.id, 'ray@magiclab')
    expect(again.kind).toBe('dead_letter')
    expect(calls).toHaveBeenCalledTimes(1)
    expect(stepCost(f)).toBe(2)
  })
})

describe('P1-4b · 接管一条跑到一半的 run，跟「结果未知」是同一个场景', () => {
  it('🔴 provider 不保证幂等 → 接管 running **不自动重跑**，转人工', async () => {
    // 同一个 PR 里一边用 UNSAFE_RETRY 挡住重试、一边让接管路径把 handler 又调一遍，
    // 是自相矛盾的：上一个执行者崩在 handler 调用中途，结果同样未知。
    const calls = vi.fn()
    const f = makeFixture({
      registry: makeRegistry([paidDefinition({ providerIdempotency: 'unsupported' })]),
      capabilities: () => ({
        [KEY]: capabilityOf({
          a: async () => {
            calls()
            return { output: { done: true }, costActualUsd: 1 }
          },
        }),
      }),
      options: { policy: policyWithCap(10) },
      startAt: '2026-08-08T02:00:00.000Z',
      leaseSeconds: 60,
    })

    // 摆成「上一个执行者崩在执行中途」：running + 租约过期 + 步骤没跑完、还没记账
    const { run } = await submitActionRun(f.kernel, submit())
    const row = f.tables.action_runs[0]
    row.status = 'running'
    row.claimed_by = 'dead-worker#1'
    row.lease_expires_at = new Date(f.clock.now.getTime() + 60_000).toISOString()
    f.tables.action_run_steps.push({
      id: 'step-inflight', run_id: run.id, client_id: CLIENT_A,
      step_key: 'a', step_index: 0, status: 'running',
      attempt: 1, reclaim_count: 0, output: {}, verification: null,
      cost_actual_usd: 0, last_error: null, claim_generation: Number(row.claim_generation ?? 0),
      created_at: f.clock.now.toISOString(), updated_at: f.clock.now.toISOString(),
      claimed_by: null, claimed_at: null, heartbeat_at: null, next_attempt_at: null,
      started_at: null, finished_at: null,
    })
    f.clock.now = new Date(f.clock.now.getTime() + 61_000)

    const out = await runAction(f.kernel, submit())

    expect(out.kind).toBe('dead_letter')
    // 🔴 handler 一次都没被再调 —— 可能重复扣款的事不由系统替客户决定
    expect(calls).not.toHaveBeenCalled()
    expect(out.humanReason).toContain('人工确认')
  })

  it('✅ provider 保证幂等 → 接管 running 可以接着跑', async () => {
    const calls = vi.fn()
    const f = makeFixture({
      registry: makeRegistry([paidDefinition({ providerIdempotency: 'supported' })]),
      capabilities: () => ({
        [KEY]: capabilityOf({
          a: async () => {
            calls()
            return { output: { done: true }, costActualUsd: 1 }
          },
        }),
      }),
      options: { policy: policyWithCap(10) },
      startAt: '2026-08-08T02:00:00.000Z',
      leaseSeconds: 60,
    })

    const { run } = await submitActionRun(f.kernel, submit())
    const row = f.tables.action_runs[0]
    row.status = 'running'
    row.claimed_by = 'dead-worker#1'
    row.lease_expires_at = new Date(f.clock.now.getTime() + 60_000).toISOString()
    void run
    f.clock.now = new Date(f.clock.now.getTime() + 61_000)

    const out = await runAction(f.kernel, submit())

    expect(out.kind).toBe('succeeded')
    expect(calls).toHaveBeenCalledTimes(1)
  })

  it('✅ 零成本的内部动作接管 running 不受影响', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: { action_key: KEY, mode: 'auto_approve', spend_cap_per_run_usd: 0 } },
      startAt: '2026-08-08T02:00:00.000Z',
      leaseSeconds: 60,
    })
    const realSubmit = {
      clientId: CLIENT_A, actionKey: KEY, purpose: 'growth' as const, goalId: GOAL_A,
      triggeredBy: 'schedule' as const, input: { blog_post_id: POST_A, content_hash: HASH },
    }
    await submitActionRun(f.kernel, realSubmit)
    const row = f.tables.action_runs[0]
    row.status = 'running'
    row.claimed_by = 'dead-worker#1'
    row.lease_expires_at = new Date(f.clock.now.getTime() + 60_000).toISOString()
    f.clock.now = new Date(f.clock.now.getTime() + 61_000)

    const out = await runAction(f.kernel, realSubmit)
    expect(out.kind).toBe('succeeded')
  })
})
