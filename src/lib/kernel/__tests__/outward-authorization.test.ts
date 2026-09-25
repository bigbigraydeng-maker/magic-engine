/**
 * 逐动作的对外副作用授权。
 *
 * 这一组要证明的：
 *   ① 默认仍然是拒绝 —— 换成逐动作声明之后，**没有**任何东西被顺手放开；
 *   ② 声明不能拿来盖事实（`reversible: false` 填个 rollback 也不放行）；
 *   ③ 授权层那道闸和 Gateway 那两道闸**各自**有效 ——
 *      每一道都有一个只有它能满足的用例（防「闸被前一道遮住」）。
 *
 * 🔴 全程用 `makeRegistry` 造测试专用定义。**真注册表一个新动作都不加。**
 */

import { describe, it, expect } from 'vitest'
import type {
  ActionDefinition,
  AuthorizedExecutionContext,
  OutwardApproval,
  OutwardAuthorization,
} from '../types'
import { runAction, submitActionRun, approveAndRun } from '../runner'
import { authorizeRun } from '../authorize'
import { executeAuthorizedRun } from '../gateway'
import { ACTION_REGISTRY } from '../registry'
import { outwardBlockReason } from '../outward-authorization'
import { RetryableCapabilityError } from '../errors'
import type { CapabilityImplementation } from '../types'
import { makeFixture, makeRegistry, CLIENT_A, GOAL_A, POST_A, BLOG_DRAFT, liveFence } from './fixtures'
import { computeBlogContentHash, createCapabilities } from '@/lib/capabilities'
import type { BlogDraftRow } from '@/lib/capabilities/seo/build-publish-package'

const KEY = 'seo.build_publish_package'
const HASH = computeBlogContentHash(BLOG_DRAFT as unknown as BlogDraftRow)

const GOOD_DECLARATION: OutwardAuthorization = {
  declaredIn: 'K-WP02 #882 (test-only definition)',
  approval: { mode: 'human_only' },
  rollback: 'snapshot_restore',
}

/** 一个**完全合规**的对外动作。各条用例只在它上面破坏一处。 */
function outwardDefinition(patch: Partial<ActionDefinition> = {}): ActionDefinition {
  const base = ACTION_REGISTRY.get(KEY) as ActionDefinition
  return {
    ...base,
    sideEffect: 'outward',
    reversible: true,
    providerIdempotency: 'supported',
    outwardAuthorization: GOOD_DECLARATION,
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

/** 一个只记调用次数、不做事的 capability —— 用来断言「一次都没被调」。 */
function countingCapability(calls: string[]) {
  const step = (name: string) => async () => {
    calls.push(name)
    return { output: { package_id: 'p1', content_hash: HASH }, verification: null, costActualUsd: 0 }
  }
  return (): Readonly<Record<string, CapabilityImplementation>> => ({
    [KEY]: {
      actionKey: KEY,
      version: 1,
      steps: { build: step('build'), persist: step('persist'), verify: step('verify') },
    } as unknown as CapabilityImplementation,
  })
}

const APPROVAL_POLICY = {
  action_key: KEY,
  mode: 'require_approval',
  spend_cap_per_run_usd: 100,
}

// ── 判据本身（纯函数，不需要跑整条链） ────────────────────────────────────────

describe('判据：非 outward 的动作不受影响', () => {
  it('真注册表里那个内部动作照旧放行（outwardAuthorization 保持 null）', () => {
    const internal = ACTION_REGISTRY.get(KEY) as ActionDefinition
    expect(internal.sideEffect).toBe('internal_write')
    expect(internal.outwardAuthorization).toBeNull()
    expect(outwardBlockReason(internal)).toBeNull()
  })
})

describe('判据：对外动作缺一项都不放行', () => {
  it('完整声明 → 放行', () => {
    expect(outwardBlockReason(outwardDefinition())).toBeNull()
  })

  it('🔴 没有声明（null）→ 拒绝。默认就是不放行', () => {
    const reason = outwardBlockReason(outwardDefinition({ outwardAuthorization: null }))
    expect(reason).toContain('没有逐动作的对外授权声明')
  })

  it('🔴 declaredIn 空白 → 拒绝（出处要能追到人）', () => {
    for (const declaredIn of ['', '   ', '\t\n']) {
      const reason = outwardBlockReason(
        outwardDefinition({ outwardAuthorization: { ...GOOD_DECLARATION, declaredIn } }),
      )
      expect(reason, `declaredIn=${JSON.stringify(declaredIn)}`).toContain('declaredIn')
    }
  })

  it('approval.mode 是别的值 → 拒绝', () => {
    const reason = outwardBlockReason(
      outwardDefinition({
        outwardAuthorization: {
          ...GOOD_DECLARATION,
          approval: { mode: 'nope' } as unknown as OutwardApproval,
        },
      }),
    )
    expect(reason).not.toBeNull()
  })

  it('approval 整个缺失 → 拒绝', () => {
    const { approval: _omitted, ...withoutApproval } = GOOD_DECLARATION
    const reason = outwardBlockReason(
      outwardDefinition({
        outwardAuthorization: withoutApproval as unknown as OutwardAuthorization,
      }),
    )
    expect(reason).not.toBeNull()
  })

  it('rollback 不是两个合法值之一 → 拒绝', () => {
    const reason = outwardBlockReason(
      outwardDefinition({
        outwardAuthorization: {
          ...GOOD_DECLARATION,
          rollback: 'somehow' as unknown as OutwardAuthorization['rollback'],
        },
      }),
    )
    expect(reason).toContain('怎么撤回')
  })

  it('🔴 reversible:false 填个 snapshot_restore 仍然拒绝 —— 声明盖不住事实', () => {
    const reason = outwardBlockReason(
      outwardDefinition({
        reversible: false,
        outwardAuthorization: { ...GOOD_DECLARATION, rollback: 'snapshot_restore' },
      }),
    )
    expect(reason).toContain('reversible')
    // provider_native 也一样，换个填法不改变结论
    expect(
      outwardBlockReason(
        outwardDefinition({
          reversible: false,
          outwardAuthorization: { ...GOOD_DECLARATION, rollback: 'provider_native' },
        }),
      ),
    ).toContain('reversible')
  })

  it('🔴 providerIdempotency 是 not_applicable → 拒绝（对外动作说自己不调外部服务是自相矛盾）', () => {
    const reason = outwardBlockReason(outwardDefinition({ providerIdempotency: 'not_applicable' }))
    expect(reason).toContain('not_applicable')
  })

  it('unsupported 是诚实的声明，本身不构成拒绝', () => {
    expect(outwardBlockReason(outwardDefinition({ providerIdempotency: 'unsupported' }))).toBeNull()
  })

  it('🔴 有一步没写成本上界 → 拒绝，并且说出是哪一步', () => {
    const reason = outwardBlockReason(
      outwardDefinition({
        costModel: { kind: 'fixed', estimate: () => 0, stepCeilingUsd: { build: 0, verify: 0 } },
      }),
    )
    expect(reason).toContain('persist')
  })

  it('🔴 整体 estimate 为 0 不能替代逐步声明（内部动作的兜底不适用于对外动作）', () => {
    const reason = outwardBlockReason(
      outwardDefinition({ costModel: { kind: 'fixed', estimate: () => 0 } }),
    )
    expect(reason).toContain('每一步都要显式声明成本上界')
  })

  it('上界不是真实金额（NaN / Infinity / 负数）→ 当成没声明', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const reason = outwardBlockReason(
        outwardDefinition({
          costModel: {
            kind: 'fixed',
            estimate: () => 0,
            stepCeilingUsd: { build: bad, persist: 0, verify: 0 },
          },
        }),
      )
      expect(reason, `ceiling=${bad}`).toContain('build')
    }
  })
})

// ── 授权层那道闸 ──────────────────────────────────────────────────────────────

describe('授权层：对外动作默认拒绝', () => {
  it('🔴 outward + 没有声明 → denied，capability 一次都不调', async () => {
    const calls: string[] = []
    const f = makeFixture({
      registry: makeRegistry([outwardDefinition({ outwardAuthorization: null })]),
      capabilities: countingCapability(calls),
      options: { policy: APPROVAL_POLICY },
    })

    const outcome = await runAction(f.kernel, submitInput())

    expect(outcome.kind).toBe('denied')
    expect(f.tables.authorization_decisions[0].deny_code).toBe('outward_side_effect_blocked')
    expect(calls, '被拒的对外动作不许有任何一步真的跑起来').toEqual([])
  })

  it('🔴 outward + auto_approve → denied（自动永远不足以放行对外动作）', async () => {
    const calls: string[] = []
    const f = makeFixture({
      registry: makeRegistry([outwardDefinition()]),
      capabilities: countingCapability(calls),
      options: {
        policy: { action_key: KEY, mode: 'auto_approve', spend_cap_per_run_usd: 100 },
      },
    })

    const outcome = await runAction(f.kernel, submitInput())

    expect(outcome.kind).toBe('denied')
    // 🔴 专用码，不是结构性那个 —— 前者可恢复（改规则就能做），后者不可恢复。
    //    合用一个码会让「按提示改完规则还是做不了」变成永久锁死。
    expect(f.tables.authorization_decisions[0].deny_code).toBe('outward_requires_human_policy')
    expect(String(f.tables.authorization_decisions[0].reason)).toContain('要人点头')
    expect(calls).toEqual([])
  })

  it('outward + require_approval → 停在等人点头，capability 一次都不调', async () => {
    const calls: string[] = []
    const f = makeFixture({
      registry: makeRegistry([outwardDefinition()]),
      capabilities: countingCapability(calls),
      options: { policy: APPROVAL_POLICY },
    })

    const outcome = await runAction(f.kernel, submitInput())

    expect(outcome.kind).toBe('pending_approval')
    expect(outcome.run.status).toBe('pending_approval')
    expect(outcome.run.needs_human).toBe(true)
    expect(calls).toEqual([])
  })

  it('人点了同意 → 新签一条 human 决策，然后才往下走', async () => {
    const calls: string[] = []
    const f = makeFixture({
      registry: makeRegistry([outwardDefinition()]),
      capabilities: countingCapability(calls),
      options: { policy: APPROVAL_POLICY },
    })

    const pending = await runAction(f.kernel, submitInput())
    expect(pending.kind).toBe('pending_approval')

    await approveAndRun(f.kernel, pending.run.id, 'bigbigraydeng@gmail.com')

    const allow = f.tables.authorization_decisions.find((d) => d.verdict === 'allow')
    expect(allow, '人点头之后应该新签一条 allow').toBeTruthy()
    expect(allow!.decided_by).toBe('human')
    expect(allow!.decided_by_user).toBe('bigbigraydeng@gmail.com')
    // 原来那条 require_approval 一个字都没被改
    expect(f.tables.authorization_decisions[0].verdict).toBe('require_approval')
  })
})

// ── 审计快照：凭什么允许它对外写，必须写进决策记录 ──────────────────────────

describe('审计快照带上对外授权的依据', () => {
  /** 决策行里的 definition 快照。 */
  function definitionSnapshot(f: ReturnType<typeof makeFixture>, index: number) {
    const snap = f.tables.authorization_decisions[index].policy_snapshot as {
      definition: Record<string, unknown>
    }
    return snap.definition
  }

  it('🔴 pending 与最终 human allow 两条决策都带完整的 outward 治理快照', async () => {
    const calls: string[] = []
    const f = makeFixture({
      registry: makeRegistry([outwardDefinition({ providerIdempotency: 'unsupported' })]),
      capabilities: countingCapability(calls),
      options: { policy: APPROVAL_POLICY },
    })

    const pending = await runAction(f.kernel, submitInput())
    await approveAndRun(f.kernel, pending.run.id, 'bigbigraydeng@gmail.com')

    // 两条：require_approval + human allow
    expect(f.tables.authorization_decisions.length).toBeGreaterThanOrEqual(2)
    for (const index of [0, f.tables.authorization_decisions.length - 1]) {
      const def = definitionSnapshot(f, index)
      expect(def.side_effect, `第 ${index} 条`).toBe('outward')
      // 🔴 `approval_mode` 和 `autonomy_envelope` 必须进快照 —— 否则复盘时
      //    只看到「没要人点头」，说不清当时是在什么范围内放行的。
      expect(def.outward_authorization, `第 ${index} 条`).toEqual({
        declared_in: 'K-WP02 #882 (test-only definition)',
        requires_human_approval: true,
        approval_mode: 'human_only',
        autonomy_envelope: null,
        rollback: 'snapshot_restore',
      })
      expect(def.provider_idempotency, `第 ${index} 条`).toBe('unsupported')
      expect(def.step_ceiling_usd, `第 ${index} 条`).toEqual({ build: 0, persist: 0, verify: 0 })
    }
  })

  it('内部动作的快照里 outward_authorization 是 null', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: { action_key: KEY, mode: 'auto_approve', spend_cap_per_run_usd: 0 } },
    })
    await runAction(f.kernel, submitInput())

    const def = definitionSnapshot(f, 0)
    expect(def.side_effect).toBe('internal_write')
    expect(def.outward_authorization).toBeNull()
    expect(def.provider_idempotency).toBe('not_applicable')
    // 这个动作没声明每步上界 —— 如实存 null，不编一个空对象
    expect(def.step_ceiling_usd).toBeNull()
  })

  it('🔴 快照必须能 JSON 无损 round-trip（函数进去了会被悄悄丢掉）', async () => {
    const calls: string[] = []
    const f = makeFixture({
      registry: makeRegistry([outwardDefinition()]),
      capabilities: countingCapability(calls),
      options: { policy: APPROVAL_POLICY },
    })
    await runAction(f.kernel, submitInput())

    const snapshot = f.tables.authorization_decisions[0].policy_snapshot
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot)
  })

  it('🔴 不许把 costModel 整个塞进快照（estimate 是函数，JSON 存不住）', async () => {
    const calls: string[] = []
    const f = makeFixture({
      registry: makeRegistry([outwardDefinition()]),
      capabilities: countingCapability(calls),
      options: { policy: APPROVAL_POLICY },
    })
    await runAction(f.kernel, submitInput())

    const def = definitionSnapshot(f, 0)
    expect(def.cost_model).toBeUndefined()
    expect(JSON.stringify(def)).not.toContain('estimate')
  })
})

// ── Gateway 那两道闸（各自独立） ───────────────────────────────────────────────

describe('Gateway：独立于授权层再判一次', () => {
  /**
   * 🔴 这一条要证明的是 **Gateway 自己那道结构闸在不在**，
   *    所以必须造出「授权层放过了、只有 Gateway 能拦」的库状态：
   *    先拿一个合规的对外动作正常拿到授权，再把注册表换成
   *    「同一个 key，但声明被抽走」的版本去执行。
   */
  it('🔴 声明在授权之后被抽走 → Gateway 拒绝，且授权一次都没被兑换', async () => {
    const calls: string[] = []
    const f = makeFixture({
      registry: makeRegistry([outwardDefinition()]),
      capabilities: countingCapability(calls),
      options: { policy: APPROVAL_POLICY },
    })

    const { run } = await submitActionRun(f.kernel, submitInput())
    const auth = await authorizeRun(f.kernel, run)
    // 走人工批准这条路拿到真实的 allow
    const pendingRunId = run.id
    await approveAndRun(f.kernel, pendingRunId, 'bigbigraydeng@gmail.com')
    expect(auth.verdict).toBe('require_approval')

    // 现在把声明抽走 —— 只有 Gateway 那道闸能发现
    const stripped = { ...f.kernel, registry: makeRegistry([outwardDefinition({ outwardAuthorization: null })]) }

    type RpcFn = (name: string, args: Record<string, unknown>) => Promise<unknown>
    const spied = f.supabase as unknown as { rpc: RpcFn }
    const rpcCalls: string[] = []
    const realRpc = spied.rpc.bind(f.supabase) as RpcFn
    spied.rpc = (name, args) => {
      rpcCalls.push(name)
      return realRpc(name, args)
    }

    const ctx = {
      runId: pendingRunId,
      clientId: CLIENT_A,
      actionKey: KEY,
      actionVersion: 1,
      decisionId: f.tables.authorization_decisions.find((d) => d.verdict === 'allow')!.id,
      costCapUsd: 100,
    } as unknown as AuthorizedExecutionContext

    await expect(
      executeAuthorizedRun(stripped, ctx, liveFence(f, pendingRunId)),
    ).rejects.toThrow(/资产之外/)

    expect(
      rpcCalls,
      'Gateway 应该在自己那一层就停手 —— 被拦下的对外动作不许消费掉授权',
    ).not.toContain('kernel_begin_authorized_run')
  })

  /**
   * 🔴 这一条只有「Gateway 复核放行是谁签的」那道闸能满足。
   *
   *    第一版写错过，值得记下来：当时只把 `decided_by` 改成 `policy`，
   *    政策却还是 `require_approval` —— 于是**既有**的模式复核
   *    （机器签的放行只在政策仍是 auto_approve 时有效）先报了 POLICY_CHANGED，
   *    我这道新闸整个被遮住，拆掉它测试照样绿。这正是本仓一路在防的形状。
   *
   *    要让它单独可咬，得摆成「既有那道闸看着完全正常」的样子：
   *    机器签的放行 + 政策确实是 auto_approve。授权层本来签不出这种组合
   *    （⑥b 会拒），但它被改坏、被绕过、或将来多一条签发路径时就会出现 ——
   *    那时候唯一还站着的就是这一句。
   */
  it('🔴 放行是机器签的 → Gateway 拒绝执行对外动作（既有模式复核看着一切正常）', async () => {
    const calls: string[] = []
    const f = makeFixture({
      registry: makeRegistry([outwardDefinition()]),
      capabilities: countingCapability(calls),
      options: { policy: APPROVAL_POLICY },
    })

    const pending = await runAction(f.kernel, submitInput())
    await approveAndRun(f.kernel, pending.run.id, 'bigbigraydeng@gmail.com')

    // 上面那次批准是合法的，会真的跑完 —— 所以基线要在这里取，
    // 后面断言的是「被拦的这一次没有再跑任何一步」，不是「一步都没跑过」。
    const callsBeforeBlockedAttempt = calls.length

    const allow = f.tables.authorization_decisions.find((d) => d.verdict === 'allow')!
    allow.decided_by = 'policy'
    allow.consumed_at = null
    // 🔴 关键：政策也摆成 auto_approve，让「机器签 + 政策是自动」自洽 ——
    //    否则既有的模式复核会先开火，测不到我们要测的那道闸。
    f.tables.client_automation_policies[0].mode = 'auto_approve'
    const runRow = f.tables.action_runs[0]
    runRow.status = 'authorized'

    const ctx = {
      runId: String(runRow.id),
      clientId: CLIENT_A,
      actionKey: KEY,
      actionVersion: 1,
      decisionId: allow.id,
      costCapUsd: 100,
    } as unknown as AuthorizedExecutionContext

    await expect(
      executeAuthorizedRun(f.kernel, ctx, liveFence(f, String(runRow.id))),
    ).rejects.toThrow(/只认人工批准|不是人点头/)
    expect(calls.length, '被拦下的这一次不许再跑任何一步').toBe(callsBeforeBlockedAttempt)
  })
})

// ── 对外动作接上既有的钱闸与重试闸 ────────────────────────────────────────────

describe('对外动作接上既有的成本与重试机制', () => {
  it('🔴 unsupported + 会花钱的步骤 + 结果未知的失败 → 不自动重试，转人工', async () => {
    let buildCalls = 0
    const f = makeFixture({
      registry: makeRegistry([
        outwardDefinition({
          providerIdempotency: 'unsupported',
          costModel: {
            kind: 'estimated',
            estimate: () => 1,
            stepCeilingUsd: { build: 5, persist: 0, verify: 0 },
          },
        }),
      ]),
      capabilities: () => ({
        [KEY]: {
          actionKey: KEY,
          version: 1,
          steps: {
            build: async () => {
              buildCalls += 1
              throw Object.assign(new Error('provider 超时，结果未知'), { retryable: true })
            },
            persist: async () => ({ output: {}, verification: null, costActualUsd: 0 }),
            verify: async () => ({ output: {}, verification: null, costActualUsd: 0 }),
          },
        } as unknown as CapabilityImplementation,
      }),
      options: { policy: APPROVAL_POLICY },
    })

    const pending = await runAction(f.kernel, submitInput())
    const outcome = await approveAndRun(f.kernel, pending.run.id, 'ray')

    expect(outcome.kind).toBe('dead_letter')
    expect(buildCalls, '不认幂等键的付费步骤，结果未知时不许自动重试').toBe(1)
    expect(f.tables.action_runs[0].status).toBe('dead_letter')
    expect(f.tables.action_runs[0].needs_human).toBe(true)
  })

  it('🔴 unsupported + 会花钱的对外步骤 + 结果未知的失败 → 依旧不自动重试（新判据没有弱化成本这条路）', async () => {
    let buildCalls = 0
    const f = makeFixture({
      registry: makeRegistry([
        outwardDefinition({
          providerIdempotency: 'unsupported',
          costModel: {
            kind: 'estimated',
            estimate: () => 1,
            stepCeilingUsd: { build: 5, persist: 0, verify: 0 },
          },
        }),
      ]),
      capabilities: () => ({
        [KEY]: {
          actionKey: KEY,
          version: 1,
          steps: {
            build: async () => {
              buildCalls += 1
              throw new RetryableCapabilityError('provider 超时，结果未知')
            },
            persist: async () => ({ output: {}, verification: null, costActualUsd: 0 }),
            verify: async () => ({ output: {}, verification: null, costActualUsd: 0 }),
          },
        } as unknown as CapabilityImplementation,
      }),
      options: { policy: APPROVAL_POLICY },
    })

    const pending = await runAction(f.kernel, submitInput())
    const outcome = await approveAndRun(f.kernel, pending.run.id, 'ray')

    expect(outcome.kind).toBe('dead_letter')
    expect(buildCalls, '付费的对外步骤，结果未知时不许自动重试').toBe(1)
    expect(f.tables.action_runs[0].needs_human).toBe(true)
  })

  it('🔴 unsupported + 零成本的对外步骤 + 结果未知的失败 → 一样不自动重试（重放风险跟钱无关）', async () => {
    let buildCalls = 0
    const f = makeFixture({
      registry: makeRegistry([
        outwardDefinition({
          providerIdempotency: 'unsupported',
          // 默认 costModel 就是零成本（build/persist/verify 全 0）——
          // 刻意不额外声明正的 stepCeilingUsd，证明这道闸不是靠钱触发的。
        }),
      ]),
      capabilities: () => ({
        [KEY]: {
          actionKey: KEY,
          version: 1,
          steps: {
            build: async () => {
              buildCalls += 1
              // 🔴 必须是 Kernel 认识的「可重试」类型 —— 裸 Error 挂个 .retryable
              //    字段不会被 isRetryable() 认出来，那样测的就不是这道闸了。
              throw new RetryableCapabilityError('provider 超时，结果未知')
            },
            persist: async () => ({ output: {}, verification: null, costActualUsd: 0 }),
            verify: async () => ({ output: {}, verification: null, costActualUsd: 0 }),
          },
        } as unknown as CapabilityImplementation,
      }),
      options: { policy: APPROVAL_POLICY },
    })

    const pending = await runAction(f.kernel, submitInput())
    const outcome = await approveAndRun(f.kernel, pending.run.id, 'ray')

    expect(outcome.kind).toBe('dead_letter')
    expect(buildCalls, '零成本的对外步骤，结果未知时也不许自动重试 —— 重放的是外部写入，不是钱').toBe(1)
    expect(f.tables.action_runs[0].status).toBe('dead_letter')
    expect(f.tables.action_runs[0].needs_human).toBe(true)
  })

  it('✅ supported + 零成本的对外步骤 + 结果未知的失败 → 照常按幂等键重试、跑完（新判据没有误伤真幂等）', async () => {
    let buildCalls = 0
    const f = makeFixture({
      registry: makeRegistry([
        outwardDefinition({
          providerIdempotency: 'supported',
        }),
      ]),
      capabilities: () => ({
        [KEY]: {
          actionKey: KEY,
          version: 1,
          steps: {
            build: async () => {
              buildCalls += 1
              if (buildCalls < 2) {
                throw new RetryableCapabilityError('临时抖动')
              }
              return { output: { package_id: 'p1', content_hash: HASH }, verification: null, costActualUsd: 0 }
            },
            persist: async () => ({ output: {}, verification: null, costActualUsd: 0 }),
            // 🔴 最后一步要同时满足两件事，缺一样整轮都会落死信，
            //    于是这条用例就再也证明不了「重试没被误伤」那件事了
            //    （它会因为完全无关的原因变红）：
            //      ① 契约声明了 package_integrity 验证 —— 必须真给出一条通过的记录；
            //      ② 产物要满足 outputSchema 的必填字段（package_id / content_hash）。
            verify: async () => ({
              output: { package_id: 'p1', content_hash: HASH },
              verification: {
                method: 'package_integrity' as const,
                passed: true,
                checks: [{ name: 'package_readable', passed: true }],
              },
              costActualUsd: 0,
            }),
          },
        } as unknown as CapabilityImplementation,
      }),
      options: { policy: APPROVAL_POLICY },
    })

    const pending = await runAction(f.kernel, submitInput())
    const outcome = await approveAndRun(f.kernel, pending.run.id, 'ray')

    expect(outcome.kind).toBe('succeeded')
    expect(buildCalls, '认幂等键的对外步骤，重试没有被这条规则误伤').toBe(2)
  })

  it('🔴 预算装不下声明的上界 → handler 一次都不调', async () => {
    let buildCalls = 0
    const f = makeFixture({
      registry: makeRegistry([
        outwardDefinition({
          costModel: {
            kind: 'estimated',
            estimate: () => 1,
            stepCeilingUsd: { build: 50, persist: 0, verify: 0 },
          },
        }),
      ]),
      capabilities: () => ({
        [KEY]: {
          actionKey: KEY,
          version: 1,
          steps: {
            build: async () => {
              buildCalls += 1
              return { output: {}, verification: null, costActualUsd: 0 }
            },
            persist: async () => ({ output: {}, verification: null, costActualUsd: 0 }),
            verify: async () => ({ output: {}, verification: null, costActualUsd: 0 }),
          },
        } as unknown as CapabilityImplementation,
      }),
      // 上限 2 元，而 build 这一步声明最多花 50
      options: { policy: { action_key: KEY, mode: 'require_approval', spend_cap_per_run_usd: 2 } },
    })

    const pending = await runAction(f.kernel, submitInput())
    const outcome = await approveAndRun(f.kernel, pending.run.id, 'ray')

    expect(outcome.kind).toBe('dead_letter')
    expect(buildCalls, '钱不够就不该开跑 —— 不是跑完再发现超了').toBe(0)
  })
})
