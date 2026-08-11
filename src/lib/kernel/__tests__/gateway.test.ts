/**
 * Gateway 负向测试 —— 「业务写能力不许绕过授权层」这句话的证据。
 *
 * 🔴 每一条都必须**伪造到底**：不是「少传了参数所以炸了」，
 *    而是「字段全对、类型全对、就是没有真授权 —— 依然进不去」。
 *    编译期的 brand 只能挡住「忘了授权」；这一组挡的是「故意规避」。
 */

import { describe, it, expect, vi } from 'vitest'
import type {
  ActionDefinition,
  AuthorizedExecutionContext,
  CapabilityImplementation,
  CapabilityStepResult,
} from '../types'
import { executeAuthorizedRun } from '../gateway'
import { authorizeRun } from '../authorize'
import { submitActionRun, runAction, resumeDeadLetterRun } from '../runner'
import { KernelError, RetryableCapabilityError } from '../errors'
import { fetchKernelHandoffTodos } from '../handoff'
import { makeFixture, makeRegistry, CLIENT_A, CLIENT_B, GOAL_A, liveFence } from './fixtures'

// ── 合成动作：让重试 / 死信 / 成本超支这些路径能被真正跑一遍 ──────────────────
//    （不往生产注册表里塞假动作 —— 注册表必须只说真话）

const TEST_KEY = 'seo.build_publish_package'

function testDefinition(over: Partial<ActionDefinition> = {}): ActionDefinition {
  return {
    actionKey: TEST_KEY,
    version: 1,
    title: '测试动作',
    inputSchema: { type: 'object', required: ['n'], properties: { n: { type: 'string' } }, additionalProperties: false },
    outputSchema: { type: 'object', required: ['done'], properties: { done: { type: 'boolean' } }, additionalProperties: true },
    capability: 'test',
    risk: 'low',
    sideEffect: 'internal_write',
    reversible: true,
    idempotency: { keyFields: ['n'], scope: 'client' },
    costModel: { kind: 'fixed', estimate: () => 0 },
    retryPolicy: { maxAttempts: 3, backoff: 'exponential', baseMs: 100 },
    verification: null,
    requiredCapabilityTier: 'paid_client',
    steps: ['work'],
    allowedPurposes: ['growth'],
    ...over,
  } as ActionDefinition
}

function capabilityOf(
  steps: Record<string, (s: { attempt: number }) => Promise<CapabilityStepResult>>,
): CapabilityImplementation {
  return {
    actionKey: TEST_KEY as never,
    version: 1,
    steps: steps as never,
  }
}

const OK_CAPABILITY = () =>
  ({ [TEST_KEY]: capabilityOf({ work: async () => ({ output: { done: true } }) }) })

const AUTO_POLICY = { action_key: TEST_KEY, mode: 'auto_approve', spend_cap_per_run_usd: 0 }

function submit() {
  return {
    clientId: CLIENT_A,
    actionKey: TEST_KEY,
    purpose: 'growth' as const,
    goalId: GOAL_A,
    triggeredBy: 'agent' as const,
    input: { n: 'one' },
  }
}

/** 造一个字段齐全的假授权上下文 —— 正是「故意规避」长的样子。 */
function forgeContext(over: Partial<Record<string, unknown>>): AuthorizedExecutionContext {
  return {
    decisionId: 'decision-does-not-exist',
    runId: 'run-does-not-exist',
    clientId: CLIENT_A,
    actionKey: TEST_KEY,
    actionVersion: 1,
    policyVersion: 1,
    costCapUsd: 0,
    idempotencyKey: 'whatever',
    expiresAt: null,
    ...over,
  } as unknown as AuthorizedExecutionContext
}

describe('Gateway：没有真授权就进不去', () => {
  it('拿一个凭空捏造的上下文调执行 → 抛错，什么也没跑', async () => {
    const f = makeFixture({
      registry: makeRegistry([testDefinition()]),
      capabilities: OK_CAPABILITY,
      options: { policy: AUTO_POLICY },
    })
    const { run } = await submitActionRun(f.kernel, submit())

    await expect(
      executeAuthorizedRun(f.kernel, forgeContext({ runId: run.id }), liveFence(f)),
    ).rejects.toThrow(KernelError)
    await expect(
      executeAuthorizedRun(f.kernel, forgeContext({ runId: run.id }), liveFence(f)),
    ).rejects.toThrow(/查不到这次执行对应的授权记录/)
    expect(f.tables.action_run_steps).toHaveLength(0)
  })

  it('伪造上下文声称已放行，但库里那条其实是「等人点头」→ 抛错', async () => {
    const f = makeFixture({
      registry: makeRegistry([testDefinition()]),
      capabilities: OK_CAPABILITY,
      options: { policy: { ...AUTO_POLICY, mode: 'require_approval' } },
    })
    const pending = await runAction(f.kernel, submit())
    const realDecisionId = String(f.tables.authorization_decisions[0].id)

    // 字段全对，只有一件事是假的：这条决策的 verdict 不是 allow
    await expect(
      executeAuthorizedRun(
        f.kernel,
        forgeContext({ runId: pending.run.id, decisionId: realDecisionId }),
        liveFence(f),
      ),
    ).rejects.toThrow(/没有被放行/)
  })

  it('跨客户：拿 A 客户的授权去对 B 客户执行 → 抛错并明确说是安全告警', async () => {
    const f = makeFixture({
      registry: makeRegistry([testDefinition()]),
      capabilities: OK_CAPABILITY,
      options: { policy: AUTO_POLICY },
    })
    const { run } = await submitActionRun(f.kernel, submit())
    const auth = await authorizeRun(f.kernel, run)
    expect(auth.ctx).toBeTruthy()

    // 把决策悄悄改挂到另一个客户（模拟串台的数据形状）
    f.tables.authorization_decisions[0].client_id = CLIENT_B

    await expect(executeAuthorizedRun(f.kernel, auth.ctx!, liveFence(f))).rejects.toThrow(/安全告警/)
  })

  it('🔴 串台的东西**在去领执行权之前**就被拒了，不是靠数据库那一层兜住', async () => {
    // 这条测的是「两道闸各自都在」，不是「最后结果对」。
    // 数据库那道闸（kernel_begin_authorized_run）也查跨客户，所以只断言
    // 「最后抛错了」的话，把 Gateway 这道闸整个删掉，测试照样全绿 ——
    // 上一轮变异验证正是这么漏掉的。判据必须是**根本没去领执行权**。
    const f = makeFixture({
      registry: makeRegistry([testDefinition()]),
      capabilities: OK_CAPABILITY,
      options: { policy: AUTO_POLICY },
    })
    const { run } = await submitActionRun(f.kernel, submit())
    const auth = await authorizeRun(f.kernel, run)

    type RpcFn = (name: string, args: Record<string, unknown>) => Promise<unknown>
    const spied = f.supabase as unknown as { rpc: RpcFn }
    const rpcCalls: string[] = []
    const realRpc = spied.rpc.bind(f.supabase) as RpcFn
    spied.rpc = (name, args) => {
      rpcCalls.push(name)
      return realRpc(name, args)
    }

    f.tables.authorization_decisions[0].client_id = CLIENT_B
    await expect(executeAuthorizedRun(f.kernel, auth.ctx!, liveFence(f))).rejects.toThrow(/安全告警/)

    expect(
      rpcCalls,
      'Gateway 应该在自己那一层就认出串台并停手，而不是把它交给数据库去挡',
    ).not.toContain('kernel_begin_authorized_run')
    // 状态一点没动
    expect(f.tables.action_runs[0].status).toBe('authorized')
    expect(f.tables.authorization_decisions[0].consumed_at ?? null).toBeNull()
  })

  it('授权之后客户改了规则（policy_version 变了）→ 旧授权立即失效', async () => {
    const f = makeFixture({
      registry: makeRegistry([testDefinition()]),
      capabilities: OK_CAPABILITY,
      options: { policy: AUTO_POLICY },
    })
    const { run } = await submitActionRun(f.kernel, submit())
    const auth = await authorizeRun(f.kernel, run)

    f.tables.client_automation_policies[0].policy_version = 2

    await expect(executeAuthorizedRun(f.kernel, auth.ctx!, liveFence(f))).rejects.toThrow(/规则后来改过了/)
  })

  it('契约版本对不上 → 抛错，不拿旧授权跑新实现', async () => {
    const f = makeFixture({
      registry: makeRegistry([testDefinition()]),
      capabilities: OK_CAPABILITY,
      options: { policy: AUTO_POLICY },
    })
    const { run } = await submitActionRun(f.kernel, submit())
    const auth = await authorizeRun(f.kernel, run)

    // 注册表升到 v2（模拟代码发版），但授权是按 v1 签的
    const v2 = makeRegistry([testDefinition({ version: 2 })])
    const kernelV2 = { ...f.kernel, registry: v2 }

    await expect(executeAuthorizedRun(kernelV2, auth.ctx!, liveFence(f))).rejects.toThrow(/重新授权|版契约/)
  })

  it('授权过期 → 抛错', async () => {
    const f = makeFixture({
      registry: makeRegistry([testDefinition()]),
      capabilities: OK_CAPABILITY,
      options: { policy: { ...AUTO_POLICY, decision_ttl_seconds: 60 } },
    })
    const { run } = await submitActionRun(f.kernel, submit())
    const auth = await authorizeRun(f.kernel, run)

    f.clock.now = new Date(f.clock.now.getTime() + 61_000)

    await expect(executeAuthorizedRun(f.kernel, auth.ctx!, liveFence(f))).rejects.toThrow(/已经过期/)
  })

  it('同一条授权兑换两次（重放）→ 第二次抛错，capability 只被调一次', async () => {
    const spy = vi.fn(async () => ({ output: { done: true } }))
    const f = makeFixture({
      registry: makeRegistry([testDefinition()]),
      capabilities: () => ({ [TEST_KEY]: capabilityOf({ work: spy }) }),
      options: { policy: AUTO_POLICY },
    })
    const { run } = await submitActionRun(f.kernel, submit())
    const auth = await authorizeRun(f.kernel, run)

    const first = await executeAuthorizedRun(f.kernel, auth.ctx!, liveFence(f))
    expect(first.status).toBe('succeeded')

    await expect(executeAuthorizedRun(f.kernel, auth.ctx!, liveFence(f))).rejects.toThrow(/已经.*用掉了|一次授权只能换一次/)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('Gateway：幂等', () => {
  it('同一把幂等键提交两次 → 只有一个 run，capability 只被调一次', async () => {
    const spy = vi.fn(async () => ({ output: { done: true } }))
    const f = makeFixture({
      registry: makeRegistry([testDefinition()]),
      capabilities: () => ({ [TEST_KEY]: capabilityOf({ work: spy }) }),
      options: { policy: AUTO_POLICY },
    })

    const first = await runAction(f.kernel, submit())
    const second = await runAction(f.kernel, submit())

    expect(first.kind).toBe('succeeded')
    expect(second.kind).toBe('idempotent_hit')
    expect(second.run.id).toBe(first.run.id)
    expect(f.tables.action_runs).toHaveLength(1)
    expect(spy).toHaveBeenCalledTimes(1)
    // 第二次连授权都没重签 —— 审计表里不该出现两个「谁批的」
    expect(f.tables.authorization_decisions).toHaveLength(1)
  })

  it('输入变了（幂等键变了）→ 是另一件事，会新建一个 run', async () => {
    const f = makeFixture({
      registry: makeRegistry([testDefinition()]),
      capabilities: OK_CAPABILITY,
      options: { policy: AUTO_POLICY },
    })

    await runAction(f.kernel, submit())
    await runAction(f.kernel, { ...submit(), input: { n: 'two' } })

    expect(f.tables.action_runs).toHaveLength(2)
  })
})

describe('Gateway：重试 / 死信 / 断点续跑', () => {
  it('可重试的失败 → 退避后再来，最终成功，尝试次数落在库里', async () => {
    let calls = 0
    const f = makeFixture({
      registry: makeRegistry([testDefinition()]),
      capabilities: () => ({
        [TEST_KEY]: capabilityOf({
          work: async () => {
            calls += 1
            if (calls < 3) throw new RetryableCapabilityError('上游 429')
            return { output: { done: true } }
          },
        }),
      }),
      options: { policy: AUTO_POLICY },
    })

    const outcome = await runAction(f.kernel, submit())

    expect(outcome.kind).toBe('succeeded')
    expect(calls).toBe(3)
    const step = f.tables.action_run_steps[0]
    expect(step.status).toBe('succeeded')
    expect(step.attempt).toBe(3)
  })

  it('重试到上限还是不行 → 死信，标记需要人处理，并进今日待办', async () => {
    const f = makeFixture({
      registry: makeRegistry([testDefinition()]),
      capabilities: () => ({
        [TEST_KEY]: capabilityOf({
          work: async () => {
            throw new RetryableCapabilityError('上游一直 500')
          },
        }),
      }),
      options: { policy: AUTO_POLICY },
    })

    const outcome = await runAction(f.kernel, submit())

    expect(outcome.kind).toBe('dead_letter')
    expect(outcome.run.status).toBe('dead_letter')
    expect(outcome.run.needs_human).toBe(true)
    const step = f.tables.action_run_steps[0]
    expect(step.status).toBe('dead_letter')
    expect(step.attempt).toBe(3) // maxAttempts

    // 🔴 死信不许死在日志里：必须能被今日待办捞出来，且三件套齐全
    const todos = await fetchKernelHandoffTodos(f.supabase, f.clock.now)
    expect(todos).toHaveLength(1)
    expect(todos[0].what).toContain('已经停手')
    expect(todos[0].how.length).toBeGreaterThan(10)
    // 🔴 **不给假的 action URL。** 执行看板不读 `action_runs` —— 链过去既找不到
    //    这条 run，也没有能处理它的按钮。三件套里的 href 宁可空着，
    //    也不能给一个「打得开但看不到这件事」的地址。
    //    （空 href 不会被 dropBrokenLinks 当成「链接坏了」丢掉，
    //     渲染器也不会画出一个点了没反应的按钮 —— 两处都有守卫测试。）
    expect(todos[0].href).toBe('')
    expect(todos[0].how).toContain('回我一句')
  })

  it('不可重试的失败 → 一次就停手，不白试三次', async () => {
    const spy = vi.fn(async () => {
      throw new KernelError('INVALID_INPUT', '这条稿子根本不存在')
    })
    const f = makeFixture({
      registry: makeRegistry([testDefinition()]),
      capabilities: () => ({ [TEST_KEY]: capabilityOf({ work: spy }) }),
      options: { policy: AUTO_POLICY },
    })

    const outcome = await runAction(f.kernel, submit())

    expect(outcome.kind).toBe('dead_letter')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('断点续跑：重跑时已经做成的步骤不再做第二遍', async () => {
    const aCalls = vi.fn(async () => ({ output: { a: 1 } }))
    let bShouldFail = true
    const f = makeFixture({
      registry: makeRegistry([testDefinition({ steps: ['a', 'b'] })]),
      capabilities: () => ({
        [TEST_KEY]: capabilityOf({
          a: aCalls,
          b: async () => {
            if (bShouldFail) throw new KernelError('INVALID_STATE', '下游还没准备好')
            return { output: { done: true } }
          },
        }),
      }),
      options: { policy: AUTO_POLICY },
    })

    const first = await runAction(f.kernel, submit())
    expect(first.kind).toBe('dead_letter')
    expect(aCalls).toHaveBeenCalledTimes(1)

    bShouldFail = false
    const resumed = await resumeDeadLetterRun(f.kernel, first.run.id, 'ray')

    expect(resumed.kind).toBe('succeeded')
    // 🔴 a 没有被重跑 —— 这就是断点续跑，不是整条重来
    expect(aCalls).toHaveBeenCalledTimes(1)
    const stepA = f.tables.action_run_steps.find((s) => s.step_key === 'a')
    expect(stepA?.status).toBe('succeeded')
    expect(stepA?.attempt).toBe(1)
  })
})

describe('Gateway：花钱不许超信封', () => {
  it('🔴 声明最多花 5、上限只有 1 → 装不下，handler 一次都不调', async () => {
    const spy = vi.fn(async () => ({ output: { done: true }, costActualUsd: 5 }))
    const f = makeFixture({
      registry: makeRegistry([
        testDefinition({ costModel: { kind: 'fixed', estimate: () => 1, stepCeilingUsd: { work: 5 } } }),
      ]),
      capabilities: () => ({ [TEST_KEY]: capabilityOf({ work: spy }) }),
      options: { policy: { ...AUTO_POLICY, spend_cap_per_run_usd: 1 } },
    })

    const outcome = await runAction(f.kernel, submit())

    expect(outcome.kind).toBe('dead_letter')
    expect(outcome.execution?.failure?.code).toBe('COST_CAP_EXCEEDED')
    // 硬上限 = 在调供应商**之前**拦住，而不是花完了再说
    expect(spy).not.toHaveBeenCalled()
  })

  it('🔴 声明最多花 1、实际花了 5 → 契约违约，停手且不重试（钱如实记账）', async () => {
    const spy = vi.fn(async () => ({ output: { done: true }, costActualUsd: 5 }))
    const f = makeFixture({
      registry: makeRegistry([
        testDefinition({ costModel: { kind: 'fixed', estimate: () => 1, stepCeilingUsd: { work: 1 } } }),
      ]),
      capabilities: () => ({ [TEST_KEY]: capabilityOf({ work: spy }) }),
      options: { policy: { ...AUTO_POLICY, spend_cap_per_run_usd: 10 } },
    })

    const outcome = await runAction(f.kernel, submit())

    expect(outcome.kind).toBe('dead_letter')
    expect(outcome.execution?.failure?.code).toBe('COST_CONTRACT_VIOLATION')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(Number(f.tables.action_run_steps[0].cost_actual_usd)).toBe(5)
  })
})

describe('Gateway：验证是成功的前提', () => {
  it('验证没过 → 死信，不算成功，且不重试', async () => {
    const spy = vi.fn(async () => ({
      output: { done: true },
      verification: {
        method: 'package_integrity' as const,
        passed: false,
        checks: [{ name: '指纹一致', passed: false }],
        failure_reason: '写进去的内容跟该写的对不上',
      },
    }))
    const f = makeFixture({
      registry: makeRegistry([
        testDefinition({ verification: { method: 'package_integrity', delayMs: 0 } }),
      ]),
      capabilities: () => ({ [TEST_KEY]: capabilityOf({ work: spy }) }),
      options: { policy: AUTO_POLICY },
    })

    const outcome = await runAction(f.kernel, submit())

    expect(outcome.kind).toBe('dead_letter')
    expect(outcome.execution?.failure?.code).toBe('VERIFICATION_FAILED')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('🔴 声明了要验证却一条验证记录都没有 → 也不许算成功', async () => {
    const f = makeFixture({
      registry: makeRegistry([
        testDefinition({ verification: { method: 'package_integrity', delayMs: 0 } }),
      ]),
      // 这个实现「忘了」做验证 —— 每一步都成功，就是没验
      capabilities: OK_CAPABILITY,
      options: { policy: AUTO_POLICY },
    })

    const outcome = await runAction(f.kernel, submit())

    expect(outcome.kind).toBe('dead_letter')
    expect(outcome.execution?.failure?.code).toBe('VERIFICATION_FAILED')
    expect(String(outcome.humanReason)).toContain('没有一条通过的验证记录')
  })
})

describe('Gateway：产物也要守契约', () => {
  it('产物不符合 output_schema → 死信，不静默放过', async () => {
    const f = makeFixture({
      registry: makeRegistry([testDefinition()]),
      capabilities: () => ({
        [TEST_KEY]: capabilityOf({ work: async () => ({ output: { nothing: 'useful' } }) }),
      }),
      options: { policy: AUTO_POLICY },
    })

    const outcome = await runAction(f.kernel, submit())
    expect(outcome.kind).toBe('dead_letter')
    expect(outcome.execution?.failure?.code).toBe('INVALID_OUTPUT')
  })
})

describe('Gateway：动作没实现 ≠ 跳过', () => {
  it('注册表里有、capability 没实现 → 死信 + 需要人处理', async () => {
    const f = makeFixture({
      registry: makeRegistry([testDefinition()]),
      capabilities: () => ({}),
      options: { policy: AUTO_POLICY },
    })

    const outcome = await runAction(f.kernel, submit())

    expect(outcome.kind).toBe('dead_letter')
    expect(outcome.execution?.failure?.code).toBe('CAPABILITY_NOT_IMPLEMENTED')
    expect(outcome.run.needs_human).toBe(true)
  })
})
