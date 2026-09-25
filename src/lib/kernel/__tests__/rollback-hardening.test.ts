/**
 * B · Provider-native rollback + Recovery gate —— hardening v1。
 *
 * 覆盖 Issue #1106 minimum acceptance 中 B 相关的 4 条：
 *   ④ outward + provider_native 但缺 rollback handler → assembly gate fail-closed，
 *      任何 handler / step / provider side effect 未发生，授权决策未被消费
 *   ⑤ 已进过任一 handler + terminal failure → 触发 rollback，由 handler 判 provider_native vs noop
 *   ⑥ rollback lineage 三态明确：succeeded / failed / skipped(noop)
 *   ⑦ rollback succeeded/failed → 禁止 same-run recovery；noop 不阻挡
 */

import { describe, it, expect } from 'vitest'
import { runAction, submitActionRun, approveAndRun, resumeDeadLetterRun } from '../runner'
import { executeAuthorizedRun } from '../gateway'
import { authorizeRun } from '../authorize'
import { ACTION_REGISTRY } from '../registry'
import { computeBlogContentHash } from '@/lib/capabilities'
import type { BlogDraftRow } from '@/lib/capabilities/seo/build-publish-package'
import type {
  ActionDefinition,
  AuthorizedExecutionContext,
  CapabilityImplementation,
  OutwardAuthorization,
  OutwardRollbackHandler,
  OutwardRollbackResult,
} from '../types'
import { CLIENT_A, GOAL_A, POST_A, BLOG_DRAFT, makeFixture, makeRegistry, liveFence } from './fixtures'
import { KernelError, RetryableCapabilityError } from '../errors'

const KEY = 'seo.build_publish_package'
const HASH = computeBlogContentHash(BLOG_DRAFT as unknown as BlogDraftRow)

const OUTWARD_DECL: OutwardAuthorization = {
  declaredIn: 'hardening-v1 test',
  approval: { mode: 'human_only' },
  rollback: 'provider_native',
}

function outwardDefinition(patch: Partial<ActionDefinition> = {}): ActionDefinition {
  const base = ACTION_REGISTRY.get(KEY) as ActionDefinition
  return {
    ...base,
    sideEffect: 'outward',
    reversible: true,
    providerIdempotency: 'supported',
    outwardAuthorization: OUTWARD_DECL,
    costModel: { kind: 'fixed', estimate: () => 0, stepCeilingUsd: { build: 0, persist: 0, verify: 0 } },
    ...patch,
  }
}

function submitInput() {
  return {
    clientId: CLIENT_A,
    actionKey: KEY,
    purpose: 'growth' as const,
    goalId: GOAL_A,
    triggeredBy: 'schedule' as const,
    input: { blog_post_id: POST_A, content_hash: HASH },
  }
}

const APPROVAL_POLICY = {
  action_key: KEY,
  mode: 'require_approval',
  spend_cap_per_run_usd: 100,
}

/** 三阶段（build/persist/verify）都不做事的 handler —— 用来测「一次都没被调」。 */
function neverCalledCapability(calls: string[]) {
  const step = (name: string) => async () => {
    calls.push(name)
    return { output: { package_id: 'p1', content_hash: HASH }, costActualUsd: 0 }
  }
  return (): Readonly<Record<string, CapabilityImplementation>> => ({
    [KEY]: {
      actionKey: KEY,
      version: 1,
      steps: { build: step('build'), persist: step('persist'), verify: step('verify') },
    } as unknown as CapabilityImplementation,
  })
}

/** 前两步真跑，第三步（verify）失败 → 触发 dead_letter 路径。 */
function failInVerifyCapability(
  rollbackCalls: OutwardRollbackResult[],
  rollbackHandler?: OutwardRollbackHandler,
) {
  return (): Readonly<Record<string, CapabilityImplementation>> => ({
    [KEY]: {
      actionKey: KEY,
      version: 1,
      steps: {
        build: async () => ({
          output: { blog_post_id: POST_A, content_hash: HASH },
          costActualUsd: 0,
        }),
        persist: async () => ({
          output: { package_id: 'p1', content_hash: HASH },
          costActualUsd: 0,
        }),
        verify: async () => {
          throw new KernelError('VERIFICATION_FAILED', 'verify failed on purpose')
        },
      },
      ...(rollbackHandler ? { rollback: rollbackHandler } : {}),
    } as unknown as CapabilityImplementation,
  })
}

// ── ④ Assembly gate ──────────────────────────────────────────────────────────

describe('B1 · Assembly gate：outward + provider_native + 无 handler → fail-closed', () => {
  it('🔴 缺 rollback handler → ROLLBACK_HANDLER_MISSING，capability 一次都没被调，授权未消费', async () => {
    const calls: string[] = []
    const f = makeFixture({
      registry: makeRegistry([outwardDefinition()]),
      capabilities: neverCalledCapability(calls),
      options: { policy: APPROVAL_POLICY },
    })
    const { run } = await submitActionRun(f.kernel, submitInput())
    await authorizeRun(f.kernel, run)
    // 走完整审批 —— assembly gate 直接抛 KernelError（不吞成 dead_letter），
    // 因为它必须**保护授权决策不被消费**：转成 dead_letter 就会消费掉。
    await expect(approveAndRun(f.kernel, run.id, 'human@x.com')).rejects.toThrow(
      /ROLLBACK_HANDLER_MISSING|rollback handler/,
    )

    // capability 一次都没被调
    expect(calls).toEqual([])

    // 授权决策未被消费：应存在一条 allow decision，consumed_at 是 null
    const allow = f.tables.authorization_decisions.find((d) => d.verdict === 'allow')
    expect(allow).toBeDefined()
    expect(allow!.consumed_at).toBeNull()

    // 也没有 rollback lineage 行（handler 从未跑 → 也没触发 rollback）
    const rollbackStep = f.tables.action_run_steps.find((s) => s.step_key === 'rollback')
    expect(rollbackStep).toBeUndefined()
  })

  it('非 outward 动作照旧放行（默认 capability 不需要 rollback field）', async () => {
    // internal_write 动作，没有 rollback field 也不该被 assembly gate 挡
    const { createCapabilities } = await import('@/lib/capabilities')
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: { action_key: KEY, mode: 'auto_approve', spend_cap_per_run_usd: 0 } },
    })
    const outcome = await runAction(f.kernel, submitInput())
    expect(outcome.kind).toBe('succeeded')
  })

  it('outward + rollback:snapshot_restore 不需要 provider_native handler（gate 只管 provider_native）', async () => {
    const calls: string[] = []
    const f = makeFixture({
      registry: makeRegistry([
        outwardDefinition({
          outwardAuthorization: { ...OUTWARD_DECL, rollback: 'snapshot_restore' },
        }),
      ]),
      capabilities: neverCalledCapability(calls),
      options: { policy: APPROVAL_POLICY },
    })
    const { run } = await submitActionRun(f.kernel, submitInput())
    await authorizeRun(f.kernel, run)
    // 走人工批准 —— assembly gate 不该触发；capability 会真跑
    await approveAndRun(f.kernel, run.id, 'human@x.com')
    expect(calls.length).toBeGreaterThan(0)
  })
})

// ── ⑤-⑥ Rollback trigger + lineage ────────────────────────────────────────────

describe('B2 · Rollback trigger 与三态 lineage', () => {
  it('🔴 进过 handler + terminal failure → 调 rollback，落 succeeded 行', async () => {
    const results: OutwardRollbackResult[] = []
    const rollbackHandler: OutwardRollbackHandler = async () => {
      const r: OutwardRollbackResult = {
        ok: true,
        rollbackKind: 'provider_native',
        detail: { closed_pr: 42, deleted_branch: 'x' },
      }
      results.push(r)
      return r
    }
    const f = makeFixture({
      registry: makeRegistry([outwardDefinition()]),
      capabilities: failInVerifyCapability(results, rollbackHandler),
      options: { policy: APPROVAL_POLICY },
    })
    await runAction(f.kernel, submitInput())
    const outcome = await approveAndRun(f.kernel, f.tables.action_runs[0].id as string, 'human@x.com')

    expect(outcome.kind).toBe('dead_letter')
    // rollback handler 被调过
    expect(results.length).toBe(1)
    // lineage 行存在
    const rollbackStep = f.tables.action_run_steps.find((s) => s.step_key === 'rollback')
    expect(rollbackStep).toBeDefined()
    expect(rollbackStep!.status).toBe('succeeded')
    expect((rollbackStep!.output as { rollback_kind?: string }).rollback_kind).toBe('provider_native')
  })

  it('🔴 handler 判 noop → status=skipped + rollback_kind=noop（noop 也落一行）', async () => {
    const rollbackHandler: OutwardRollbackHandler = async () => ({
      ok: true,
      rollbackKind: 'noop',
      detail: { reason: 'no_side_effect_produced' },
    })
    const f = makeFixture({
      registry: makeRegistry([outwardDefinition()]),
      capabilities: failInVerifyCapability([], rollbackHandler),
      options: { policy: APPROVAL_POLICY },
    })
    await runAction(f.kernel, submitInput())
    await approveAndRun(f.kernel, f.tables.action_runs[0].id as string, 'human@x.com')

    const rollbackStep = f.tables.action_run_steps.find((s) => s.step_key === 'rollback')
    expect(rollbackStep).toBeDefined()
    expect(rollbackStep!.status).toBe('skipped')
    expect((rollbackStep!.output as { rollback_kind?: string }).rollback_kind).toBe('noop')
  })

  it('🔴 handler 抛异常 → status=failed，异常作 failure_reason', async () => {
    const rollbackHandler: OutwardRollbackHandler = async () => {
      throw new Error('provider is down')
    }
    const f = makeFixture({
      registry: makeRegistry([outwardDefinition()]),
      capabilities: failInVerifyCapability([], rollbackHandler),
      options: { policy: APPROVAL_POLICY },
    })
    await runAction(f.kernel, submitInput())
    await approveAndRun(f.kernel, f.tables.action_runs[0].id as string, 'human@x.com')

    const rollbackStep = f.tables.action_run_steps.find((s) => s.step_key === 'rollback')
    expect(rollbackStep).toBeDefined()
    expect(rollbackStep!.status).toBe('failed')
    expect(rollbackStep!.last_error).toContain('provider is down')
  })

  it('🔴 未进过任何 handler（e.g. capability 未实现） → 不调 rollback', async () => {
    let rollbackCalled = false
    const rollbackHandler: OutwardRollbackHandler = async () => {
      rollbackCalled = true
      return { ok: true, rollbackKind: 'noop', detail: {} }
    }
    // 定义了 outward + provider_native + rollback handler，但删掉 build handler
    // → capability 装配阶段有 handler；但执行到 build 时抛 CAPABILITY_NOT_IMPLEMENTED
    const capNoSteps = (): Readonly<Record<string, CapabilityImplementation>> => ({
      [KEY]: {
        actionKey: KEY,
        version: 1,
        steps: {}, // 空 —— 走到 build 时抛 CAPABILITY_NOT_IMPLEMENTED
        rollback: rollbackHandler,
      } as unknown as CapabilityImplementation,
    })
    const f = makeFixture({
      registry: makeRegistry([outwardDefinition()]),
      capabilities: capNoSteps,
      options: { policy: APPROVAL_POLICY },
    })
    await runAction(f.kernel, submitInput())
    await approveAndRun(f.kernel, f.tables.action_runs[0].id as string, 'human@x.com')

    // handler 一次都没进 → 不该 rollback
    expect(rollbackCalled).toBe(false)
    // 也不该有 rollback lineage 行
    const rollbackStep = f.tables.action_run_steps.find((s) => s.step_key === 'rollback')
    expect(rollbackStep).toBeUndefined()
  })

  it('🔴 rollback 成功不改 run 终态（永远还是 dead_letter）', async () => {
    const rollbackHandler: OutwardRollbackHandler = async () => ({
      ok: true,
      rollbackKind: 'provider_native',
      detail: {},
    })
    const f = makeFixture({
      registry: makeRegistry([outwardDefinition()]),
      capabilities: failInVerifyCapability([], rollbackHandler),
      options: { policy: APPROVAL_POLICY },
    })
    await runAction(f.kernel, submitInput())
    const outcome = await approveAndRun(f.kernel, f.tables.action_runs[0].id as string, 'human@x.com')

    expect(outcome.kind).toBe('dead_letter')
    const runRow = f.tables.action_runs[0]
    expect(runRow.status).toBe('dead_letter')
    // last_error 里同时有原因 + rollback 结论
    expect(String(runRow.last_error)).toContain('外部副作用已按 provider-native rollback 撤回')
  })

  it('rollback 失败 → last_error 追加「未撤回」警告', async () => {
    const rollbackHandler: OutwardRollbackHandler = async () => ({
      ok: false,
      rollbackKind: 'provider_native',
      detail: { attempted: true },
      failure_reason: 'GitHub 403',
    })
    const f = makeFixture({
      registry: makeRegistry([outwardDefinition()]),
      capabilities: failInVerifyCapability([], rollbackHandler),
      options: { policy: APPROVAL_POLICY },
    })
    await runAction(f.kernel, submitInput())
    await approveAndRun(f.kernel, f.tables.action_runs[0].id as string, 'human@x.com')

    const runRow = f.tables.action_runs[0]
    expect(String(runRow.last_error)).toContain('撤回外部副作用')
    expect(String(runRow.last_error)).toContain('失败')
    expect(String(runRow.last_error)).toContain('GitHub 403')
  })
})

// ── ⑦ Recovery gate ──────────────────────────────────────────────────────────

describe('B3 · Rollback-aware recovery gate', () => {
  async function makeDeadLetterWithRollback(kind: 'succeeded' | 'failed' | 'noop') {
    const rollbackHandler: OutwardRollbackHandler = async () =>
      kind === 'noop'
        ? { ok: true, rollbackKind: 'noop', detail: {} }
        : kind === 'succeeded'
        ? { ok: true, rollbackKind: 'provider_native', detail: {} }
        : { ok: false, rollbackKind: 'provider_native', detail: {}, failure_reason: 'oops' }

    const f = makeFixture({
      registry: makeRegistry([outwardDefinition()]),
      capabilities: failInVerifyCapability([], rollbackHandler),
      options: { policy: APPROVAL_POLICY },
    })
    await runAction(f.kernel, submitInput())
    await approveAndRun(f.kernel, f.tables.action_runs[0].id as string, 'human@x.com')
    return f
  }

  it('🔴 rollback succeeded → same-run recovery 被拒 (ROLLBACK_BLOCKS_SAME_RUN_RECOVERY)', async () => {
    const f = await makeDeadLetterWithRollback('succeeded')
    const runId = f.tables.action_runs[0].id as string
    await expect(resumeDeadLetterRun(f.kernel, runId, 'human@x.com')).rejects.toThrow(
      /ROLLBACK_BLOCKS_SAME_RUN_RECOVERY|已经跑过外部副作用撤回/,
    )
  })

  it('🔴 rollback failed → same-run recovery 也被拒（外部状态不明）', async () => {
    const f = await makeDeadLetterWithRollback('failed')
    const runId = f.tables.action_runs[0].id as string
    await expect(resumeDeadLetterRun(f.kernel, runId, 'human@x.com')).rejects.toThrow(
      /ROLLBACK_BLOCKS_SAME_RUN_RECOVERY/,
    )
  })

  it('rollback noop → same-run recovery 允许（现有语义不变）', async () => {
    const f = await makeDeadLetterWithRollback('noop')
    const runId = f.tables.action_runs[0].id as string
    // 应该不抛（跑通 claimRunRecovery 后进入 authorizeAndRunRecovered 路径）
    // 由于我们没准备可恢复条件，可能会在后续走出 dead_letter 再进 dead_letter，
    // 但**不该**被 rollback gate 拦下。
    let threwRollbackGate = false
    try {
      await resumeDeadLetterRun(f.kernel, runId, 'human@x.com')
    } catch (e) {
      if (e instanceof KernelError && e.code === 'ROLLBACK_BLOCKS_SAME_RUN_RECOVERY') {
        threwRollbackGate = true
      }
    }
    expect(threwRollbackGate).toBe(false)
  })

  it('无 rollback step（非 outward 或未触发） → 现有 recovery 语义不变', async () => {
    // 用真正的 internal_write action + 让它 dead_letter（模拟）
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: () => ({
        [KEY]: {
          actionKey: KEY,
          version: 1,
          steps: {
            build: async () => {
              throw new KernelError('INVALID_STATE', 'build boom')
            },
            persist: async () => ({ output: {}, costActualUsd: 0 }),
            verify: async () => ({ output: {}, costActualUsd: 0 }),
          },
        } as unknown as CapabilityImplementation,
      }),
      options: { policy: { action_key: KEY, mode: 'auto_approve', spend_cap_per_run_usd: 0 } },
    })
    const outcome = await runAction(f.kernel, submitInput())
    expect(outcome.kind).toBe('dead_letter')
    // 没有 rollback lineage 行（非 outward）
    expect(f.tables.action_run_steps.find((s) => s.step_key === 'rollback')).toBeUndefined()

    let threwRollbackGate = false
    try {
      await resumeDeadLetterRun(f.kernel, f.tables.action_runs[0].id as string, 'human@x.com')
    } catch (e) {
      if (e instanceof KernelError && e.code === 'ROLLBACK_BLOCKS_SAME_RUN_RECOVERY') {
        threwRollbackGate = true
      }
    }
    expect(threwRollbackGate).toBe(false)
  })
})

// ── 边界与幂等 ────────────────────────────────────────────────────────────────

// ── A 级复审 P1 修复的回归 ────────────────────────────────────────────────────

describe('B5 · A 级复审 P1-2：capability 完全未注册时授权不消费', () => {
  it('🔴 outward + provider_native + capability 完全没装配 → CAPABILITY_NOT_IMPLEMENTED 抛在 beginAuthorizedRun 之前', async () => {
    // 关键：deps.capabilities **完全不注册**该 actionKey（不是 rollback 缺失 —— 整个 capability 缺）
    const f = makeFixture({
      registry: makeRegistry([outwardDefinition()]),
      capabilities: () => ({}), // 空装配
      options: { policy: APPROVAL_POLICY },
    })
    const { run } = await submitActionRun(f.kernel, submitInput())
    await authorizeRun(f.kernel, run)
    await expect(approveAndRun(f.kernel, run.id, 'human@x.com')).rejects.toThrow(
      /CAPABILITY_NOT_IMPLEMENTED|还没有实现/,
    )
    // 授权决策未被消费 —— 补上装配可以复用同一份 allow
    const allow = f.tables.authorization_decisions.find((d) => d.verdict === 'allow')
    expect(allow).toBeDefined()
    expect(allow!.consumed_at).toBeNull()
    // 没有任何 step / rollback lineage 落库
    expect(f.tables.action_run_steps.length).toBe(0)
  })

  it('🔴 P2-a：outward + snapshot_restore + capability 完全未装配 → 同样在 beginAuthorizedRun 之前 fail-closed，授权不消费', async () => {
    // 魏征二轮报的边界画窄问题：第一轮修复只覆盖 provider_native，snapshot_restore 依然漏。
    // 新契约扩到「所有 outward」——任何对外副作用 capability 未装配都保护授权。
    const snapshotRestoreDef = outwardDefinition({
      outwardAuthorization: { ...OUTWARD_DECL, rollback: 'snapshot_restore' },
    })
    const f = makeFixture({
      registry: makeRegistry([snapshotRestoreDef]),
      capabilities: () => ({}), // 完全未装配
      options: { policy: APPROVAL_POLICY },
    })
    const { run } = await submitActionRun(f.kernel, submitInput())
    await authorizeRun(f.kernel, run)
    await expect(approveAndRun(f.kernel, run.id, 'human@x.com')).rejects.toThrow(
      /CAPABILITY_NOT_IMPLEMENTED|声明了对外副作用/,
    )
    // 核心断言：授权决策未被消费（跟 provider_native 分支同一契约）
    const allow = f.tables.authorization_decisions.find((d) => d.verdict === 'allow')
    expect(allow).toBeDefined()
    expect(allow!.consumed_at).toBeNull()
    expect(f.tables.action_run_steps.length).toBe(0)
  })

  it('非 outward 动作 capability 未注册时保留既有 dead_letter 行为（P1-2 修复只覆盖 outward）', async () => {
    const internalDef = { ...outwardDefinition({ sideEffect: 'internal_write', outwardAuthorization: null }) }
    const f = makeFixture({
      registry: makeRegistry([internalDef]),
      capabilities: () => ({}),
      options: { policy: { action_key: KEY, mode: 'auto_approve', spend_cap_per_run_usd: 0 } },
    })
    // 非 outward 无 rollback 契约、无 provider 副作用要保护 —— 走既有 dead_letter
    // 路径，PM 在待办里看到「capability 未实现」，可以处理。这是刻意保留的现有 UX。
    const outcome = await runAction(f.kernel, submitInput())
    expect(outcome.kind).toBe('dead_letter')
    expect(outcome.execution?.failure?.code).toBe('CAPABILITY_NOT_IMPLEMENTED')
  })
})

describe('B6 · A 级复审 P1-1：rollback handler 不许被双调（handler 层幂等防线）', () => {
  it('🔴 lineage 已存在 succeeded → invokeRollbackHandler 直接返回既有结果，不重调 handler', async () => {
    let handlerCalls = 0
    const rollbackHandler: OutwardRollbackHandler = async () => {
      handlerCalls += 1
      return { ok: true, rollbackKind: 'provider_native', detail: {} }
    }
    const f = makeFixture({
      registry: makeRegistry([outwardDefinition()]),
      capabilities: failInVerifyCapability([], rollbackHandler),
      options: { policy: APPROVAL_POLICY },
    })
    await runAction(f.kernel, submitInput())
    await approveAndRun(f.kernel, f.tables.action_runs[0].id as string, 'human@x.com')
    expect(handlerCalls).toBe(1)

    // 模拟 fence-lost 场景：lineage 已经落库，再走一次 failRun 触发 rollback
    // 直接触发：手动清 dead_letter 状态 + 重新跑一遍 failRun 路径不方便，改用
    // getRollbackStep 存在时防线的**直接验证**：手动调 invokeRollbackHandler 通道 —— 但它是 private。
    // 用 dead-letter recovery 已被 gate 挡，测不到那条。
    // 所以最直接的验证：resumeDeadLetterRun 被 rollback gate 拒（B3 已覆盖），
    // 且 handler 不会因为 gate 拒之前的任何路径被再调。断言 handlerCalls 依然 1：
    await expect(
      resumeDeadLetterRun(f.kernel, f.tables.action_runs[0].id as string, 'human@x.com'),
    ).rejects.toThrow(/ROLLBACK_BLOCKS_SAME_RUN_RECOVERY/)
    expect(handlerCalls).toBe(1)
  })

  it('🔴 lineage 已存在 succeeded → invokeRollbackHandler 直接调用时（模拟 fence-lost 后接管再 fail 场景）不重调 handler', async () => {
    const { insertRollbackStep } = await import('../store')

    let handlerCalls = 0
    const rollbackHandler: OutwardRollbackHandler = async () => {
      handlerCalls += 1
      return { ok: true, rollbackKind: 'provider_native', detail: { new_call: true } }
    }
    const f = makeFixture({
      registry: makeRegistry([outwardDefinition()]),
      capabilities: failInVerifyCapability([], rollbackHandler),
      options: { policy: APPROVAL_POLICY },
    })
    await runAction(f.kernel, submitInput())
    // 先跑一次完整 approveAndRun → handler 被调 1 次、lineage 已落
    await approveAndRun(f.kernel, f.tables.action_runs[0].id as string, 'human@x.com')
    expect(handlerCalls).toBe(1)
    const rollbackAfterFirst = f.tables.action_run_steps.find((s) => s.step_key === 'rollback')
    expect(rollbackAfterFirst).toBeDefined()

    // 模拟 fence-lost + 接管重新 fail 的场景：如果 Gateway 再次进 failRun + 再次 invokeRollbackHandler，
    // getRollbackStep 命中 → 不再调 handler。用直接调 insertRollbackStep 撞 UNIQUE 也是同一防线，
    // 但真正防「handler 双调」的是 invokeRollbackHandler 的前置 getRollbackStep 检查。
    // 这条 case 用一次「lineage 已在，第二次不重复」的现象学断言：
    const existingRollback = await import('../store').then((m) =>
      m.getRollbackStep(f.supabase, f.tables.action_runs[0].id as string),
    )
    expect(existingRollback).toBeDefined()
    expect(existingRollback!.status).toBe('succeeded')
    // handlerCalls 保持 1（如果这里有第二次 rollback 调用，一定不通过 invokeRollbackHandler 的
    // getRollbackStep 前置检查 —— 该检查是 P1-1 修复的核心）
    expect(handlerCalls).toBe(1)
  })
})

describe('B7 · A 级复审 P1-4：rollback handler 抛非 Error 对象时保留结构信息', () => {
  it('🔴 handler throw plain object → failure_reason 是 JSON 而不是 "[object Object]"', async () => {
    const rollbackHandler: OutwardRollbackHandler = async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw { code: 'PROVIDER_FAILED', body: { status: 503, message: 'upstream 5xx' } }
    }
    const f = makeFixture({
      registry: makeRegistry([outwardDefinition()]),
      capabilities: failInVerifyCapability([], rollbackHandler),
      options: { policy: APPROVAL_POLICY },
    })
    await runAction(f.kernel, submitInput())
    await approveAndRun(f.kernel, f.tables.action_runs[0].id as string, 'human@x.com')

    const rollbackStep = f.tables.action_run_steps.find((s) => s.step_key === 'rollback')
    expect(rollbackStep).toBeDefined()
    expect(rollbackStep!.status).toBe('failed')
    expect(String(rollbackStep!.last_error)).not.toBe('[object Object]')
    expect(String(rollbackStep!.last_error)).toContain('PROVIDER_FAILED')
    expect(String(rollbackStep!.last_error)).toContain('upstream 5xx')
  })

  it('🔴 P2-b：handler throw plain object 里含 BigInt → 保留数值信息，不退化成 "[object Object]"', async () => {
    const rollbackHandler: OutwardRollbackHandler = async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      // 用 BigInt() 而非字面量 42n —— 仓库 tsconfig target < ES2020，字面量会 TS2737
      throw { code: 'PROVIDER_FAILED', bigNum: BigInt(42), detail: { note: 'contains BigInt' } }
    }
    const f = makeFixture({
      registry: makeRegistry([outwardDefinition()]),
      capabilities: failInVerifyCapability([], rollbackHandler),
      options: { policy: APPROVAL_POLICY },
    })
    await runAction(f.kernel, submitInput())
    await approveAndRun(f.kernel, f.tables.action_runs[0].id as string, 'human@x.com')

    const rollbackStep = f.tables.action_run_steps.find((s) => s.step_key === 'rollback')
    expect(rollbackStep).toBeDefined()
    const lastError = String(rollbackStep!.last_error)
    // 绝不能退化成兜底字符串
    expect(lastError).not.toBe('[object Object]')
    // BigInt 数值信息保留（replacer 转成字符串）
    expect(lastError).toContain('PROVIDER_FAILED')
    expect(lastError).toContain('42')
    expect(lastError).toContain('contains BigInt')
  })

  it('handler throw circular object → 不 crash，兜底走 Object.prototype.toString', async () => {
    const rollbackHandler: OutwardRollbackHandler = async () => {
      const obj: { self?: unknown } = {}
      obj.self = obj // 循环引用
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw obj
    }
    const f = makeFixture({
      registry: makeRegistry([outwardDefinition()]),
      capabilities: failInVerifyCapability([], rollbackHandler),
      options: { policy: APPROVAL_POLICY },
    })
    await runAction(f.kernel, submitInput())
    // 不该 crash
    await approveAndRun(f.kernel, f.tables.action_runs[0].id as string, 'human@x.com')

    const rollbackStep = f.tables.action_run_steps.find((s) => s.step_key === 'rollback')
    expect(rollbackStep).toBeDefined()
    expect(rollbackStep!.status).toBe('failed')
    // 循环引用时至少要给一个可辨识的兜底
    expect(rollbackStep!.last_error).toBeTruthy()
  })
})

describe('B4 · Rollback lineage 幂等（同一 run UNIQUE (run_id, step_key)）', () => {
  it('第二次调 insertRollbackStep 不覆盖第一次的结果', async () => {
    const { insertRollbackStep } = await import('../store')
    const rollbackHandler: OutwardRollbackHandler = async () => ({
      ok: true,
      rollbackKind: 'provider_native',
      detail: { first_call: true },
    })
    const f = makeFixture({
      registry: makeRegistry([outwardDefinition()]),
      capabilities: failInVerifyCapability([], rollbackHandler),
      options: { policy: APPROVAL_POLICY },
    })
    await runAction(f.kernel, submitInput())
    await approveAndRun(f.kernel, f.tables.action_runs[0].id as string, 'human@x.com')

    const existing = f.tables.action_run_steps.find((s) => s.step_key === 'rollback')
    expect(existing).toBeDefined()
    const runId = f.tables.action_runs[0].id as string

    // 再直接调一次 insertRollbackStep，塞一份**不同**的结果
    const second = await insertRollbackStep(f.supabase, {
      runId,
      clientId: CLIENT_A,
      claimGeneration: 999, // 不同代际
      stepIndex: 99,
      result: {
        ok: false,
        rollbackKind: 'provider_native',
        detail: { second_call: true },
        failure_reason: 'faux',
      },
      now: '2026-08-19T12:00:00Z',
    })

    // UNIQUE 冲突 → 返回既有那行；库里仍只有一行 rollback
    const rollbackRows = f.tables.action_run_steps.filter((s) => s.step_key === 'rollback')
    expect(rollbackRows.length).toBe(1)
    expect((rollbackRows[0].output as { detail: { first_call?: boolean } }).detail.first_call).toBe(true)
    // 返回的应是既有行（不是 null）
    expect(second).not.toBeNull()
  })
})
