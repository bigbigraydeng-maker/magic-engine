/**
 * P2-2 —— capability 装配必须跟契约的 key/version 一致（运行时校验，不信 TS 类型）。
 * P2-3 —— 幂等命中必须返回第一次的真实结果，不是空壳。
 */

import { describe, it, expect, vi } from 'vitest'
import type { ActionDefinition } from '../types'
import { runAction, submitActionRun } from '../runner'
import { authorizeRun } from '../authorize'
import { executeAuthorizedRun } from '../gateway'
import { ACTION_REGISTRY } from '../registry'
import { KernelError } from '../errors'
import { createCapabilities, computeBlogContentHash } from '@/lib/capabilities'
import type { BlogDraftRow } from '@/lib/capabilities/seo/build-publish-package'
import { makeFixture, makeRegistry, CLIENT_A, GOAL_A, POST_A, BLOG_DRAFT, liveFence } from './fixtures'

const KEY = 'seo.build_publish_package'
const HASH = computeBlogContentHash(BLOG_DRAFT as unknown as BlogDraftRow)
const BASE = ACTION_REGISTRY.get(KEY) as ActionDefinition
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

describe('P2-2 · 装配校验：授权按 v2 签，不许悄悄跑 v1 实现', () => {
  it('🔴 注册表 v2 + 装配 v1 → 拒绝执行，且不去领执行权（授权不被消费）', async () => {
    const builds = vi.fn()
    const f = makeFixture({
      // 注册表升到 v2 —— 但 createCapabilities 装配的实现还是 version: 1
      registry: makeRegistry([{ ...BASE, version: 2 }]),
      capabilities: (sb) => {
        const impl = createCapabilities(sb)[KEY]
        return {
          [KEY]: {
            ...impl,
            steps: {
              ...impl.steps,
              build: async (s: Parameters<(typeof impl.steps)['build']>[0]) => {
                builds()
                return impl.steps.build(s)
              },
            },
          },
        }
      },
      options: { policy: AUTO_POLICY },
    })

    type RpcFn = (name: string, args: Record<string, unknown>) => Promise<unknown>
    const spied = f.supabase as unknown as { rpc: RpcFn }
    const rpcCalls: string[] = []
    const realRpc = spied.rpc.bind(f.supabase) as RpcFn
    spied.rpc = (name, args) => {
      rpcCalls.push(name)
      return realRpc(name, args)
    }

    const { run } = await submitActionRun(f.kernel, submit())
    expect(run.action_version).toBe(2) // 授权按 v2 签
    const auth = await authorizeRun(f.kernel, run)
    expect(auth.verdict).toBe('allow')

    await expect(executeAuthorizedRun(f.kernel, auth.ctx!, liveFence(f))).rejects.toThrow(/装配对不上契约/)

    // 🔴 三条硬断言：没领执行权、capability 没跑、授权没被消费（修好装配还能跑）
    expect(rpcCalls).not.toContain('kernel_begin_authorized_run')
    expect(builds).not.toHaveBeenCalled()
    expect(f.tables.authorization_decisions.at(-1)!.consumed_at ?? null).toBeNull()
    expect(f.tables.action_runs[0].status).toBe('authorized')
    expect(f.tables.production_packages).toHaveLength(0)
  })

  it('装配的 actionKey 跟契约对不上 → 同样拒绝', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: (sb) => {
        const impl = createCapabilities(sb)[KEY]
        // 装配错位：键上挂着一个自称是别的动作的实现
        return { [KEY]: { ...impl, actionKey: 'ads.some_other_action' as never } }
      },
      options: { policy: AUTO_POLICY },
    })
    const { run } = await submitActionRun(f.kernel, submit())
    const auth = await authorizeRun(f.kernel, run)

    await expect(executeAuthorizedRun(f.kernel, auth.ctx!, liveFence(f))).rejects.toThrow(/装配对不上契约/)
    expect(f.tables.production_packages).toHaveLength(0)
  })

  it('✅ key / version 一致 → 正常执行', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: AUTO_POLICY },
    })
    const outcome = await runAction(f.kernel, submit())
    expect(outcome.kind).toBe('succeeded')
  })
})

describe('P2-3 · 幂等命中返回第一次的真实结果', () => {
  it('🔴 result2 的产物和验证 deepEqual result1，capability 仍只跑 1 次', async () => {
    const builds = vi.fn()
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: (sb) => {
        const impl = createCapabilities(sb)[KEY]
        return {
          [KEY]: {
            ...impl,
            steps: {
              ...impl.steps,
              build: async (s: Parameters<(typeof impl.steps)['build']>[0]) => {
                builds()
                return impl.steps.build(s)
              },
            },
          },
        }
      },
      options: { policy: AUTO_POLICY },
    })

    const result1 = await runAction(f.kernel, submit())
    expect(result1.kind).toBe('succeeded')
    expect(result1.execution?.output).toBeTruthy()

    const result2 = await runAction(f.kernel, submit())

    expect(result2.kind).toBe('idempotent_hit')
    expect(result2.execution?.idempotentHit).toBe(true)
    // 🔴 幂等语义：同一请求再来一次，拿到跟第一次**等价**的结果
    expect(result2.execution?.output).toEqual(result1.execution?.output)
    expect(result2.execution?.output?.package_id).toBe(
      String(f.tables.production_packages[0].id),
    )
    expect(result2.execution?.verification).toEqual(result1.execution?.verification)
    expect(result2.execution?.verification?.passed).toBe(true)
    // capability 一次都没多跑，包也没多一个
    expect(builds).toHaveBeenCalledTimes(1)
    expect(f.tables.production_packages).toHaveLength(1)
  })

  it('🔴 run 标着成功但历史步骤缺产物 → fail closed，不返回假的 success + null', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: AUTO_POLICY },
    })
    await runAction(f.kernel, submit())

    // 模拟数据损坏：verify 步骤的产物被清空（缺了契约必填的 package_id）
    const verifyStep = f.tables.action_run_steps.find((s) => s.step_key === 'verify')!
    verifyStep.output = {}
    const persistStep = f.tables.action_run_steps.find((s) => s.step_key === 'persist')!
    persistStep.output = {}
    const buildStep = f.tables.action_run_steps.find((s) => s.step_key === 'build')!
    buildStep.output = {}

    await expect(runAction(f.kernel, submit())).rejects.toThrow(/历史数据不一致|不合它自己的契约/)
  })

  it('run 标着成功但缺了某一步的记录 → fail closed', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: AUTO_POLICY },
    })
    await runAction(f.kernel, submit())

    // 整条 verify 步骤记录丢失
    const idx = f.tables.action_run_steps.findIndex((s) => s.step_key === 'verify')
    f.tables.action_run_steps.splice(idx, 1)

    await expect(runAction(f.kernel, submit())).rejects.toThrow(KernelError)
  })

  it('run 标着成功但验证记录缺失 → fail closed（声明了验证的动作不能没验证）', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: AUTO_POLICY },
    })
    await runAction(f.kernel, submit())

    for (const s of f.tables.action_run_steps) s.verification = null

    await expect(runAction(f.kernel, submit())).rejects.toThrow(/验证记录缺失/)
  })
})
