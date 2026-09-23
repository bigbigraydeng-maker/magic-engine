/**
 * 广告支柱 IMPACT 闭环 · 阶段 2 · 内核注册（P21.K）。
 *
 * 设计文档：`~/.claude/plans/ads-impact-loop-capability.md` §4.1/§4.2/§14.1（K1-K14）。
 *
 * 🔴 这份测试只验证**注册层**：四个 `ActionKey` 有没有被正确声明、
 *    有没有被既有的通用闸拦住。**不带任何真实 Meta 调用**——本文件里出现的
 *    "capability" 全部是骨架实现（测试专用，仿照 `rollback-hardening.test.ts`
 *    / `outward-authorization.test.ts` 的既有模式），真执行器留给 PR-B/PR-C。
 *
 * 覆盖 K1（撤回处理函数必须存在且被注册）、K2（广告动作一律人审批，
 * 不论客户策略）、K4（广告花费不进内核成本字段）、K5（必须挂 Goal）、
 * K14（生产遗留键不补进注册表）。K7 由 `architecture.test.ts` 的通用规则
 * 覆盖（`.eslintrc.json` 跟 `boundaries.ts` 一致性检查），本文件不重复。
 */

import { describe, it, expect } from 'vitest'
import { ACTION_REGISTRY, ACTION_KEYS } from '../registry'
import { outwardBlockReason } from '../outward-authorization'
import { runAction, submitActionRun, approveAndRun } from '../runner'
import { authorizeRun } from '../authorize'
import { KernelError } from '../errors'
import type { ActionDefinition, ActionKey, CapabilityImplementation } from '../types'
import { makeFixture, makeRegistry, CLIENT_A, CLIENT_B, GOAL_A } from './fixtures'

const ADS_KEYS = [
  'ads.budget_move_plan',
  'ads.add_retargeting_adset',
  'ads.create_audience',
  'ads.pause',
] as const satisfies readonly ActionKey[]

/** 每个动作 input_schema 的最小合法输入（跟 registry.ts 里的 required 字段一一对应）。 */
function minimalInputFor(key: (typeof ADS_KEYS)[number]): Record<string, unknown> {
  switch (key) {
    case 'ads.budget_move_plan':
      return {
        plan_id: 'plan-test-1',
        client_ad_account_id: 'act_test_1',
        currency: 'NZD',
        legs: [{ from_adset_id: 'adset-a', to_adset_id: 'adset-b', delta_usd: 50 }],
      }
    case 'ads.add_retargeting_adset':
      return {
        client_ad_account_id: 'act_test_1',
        campaign_id: 'campaign-1',
        audience_id: 'audience-1',
        creative_ref: 'creative-1',
      }
    case 'ads.create_audience':
      return {
        client_ad_account_id: 'act_test_1',
        object_id: 'video-123',
        object_type: 'video',
      }
    case 'ads.pause':
      return {
        client_ad_account_id: 'act_test_1',
        entity_id: 'adset-a',
        entity_type: 'adset',
      }
  }
}

/** 每个动作 output_schema 的最小合法产物（给"骨架 capability 能跑完"的正例用）。 */
function minimalOutputFor(key: (typeof ADS_KEYS)[number]): Record<string, unknown> {
  switch (key) {
    case 'ads.budget_move_plan':
      return { plan_id: 'plan-test-1', executed_legs: [] }
    case 'ads.add_retargeting_adset':
      return { adset_id: 'adset-new-1', status: 'paused' }
    case 'ads.create_audience':
      return { audience_id: 'audience-new-1', status: 'ready' }
    case 'ads.pause':
      return { entity_id: 'adset-a', status: 'paused' }
  }
}

function submitInputFor(key: (typeof ADS_KEYS)[number], opts: { goalId?: string | null } = {}) {
  return {
    clientId: CLIENT_A,
    actionKey: key,
    purpose: 'growth' as const,
    ...(opts.goalId !== undefined ? { goalId: opts.goalId } : { goalId: GOAL_A }),
    triggeredBy: 'human' as const,
    input: minimalInputFor(key),
  }
}

/** 骨架 capability：每一步都真的跑（记调用次数），可选是否挂 rollback。 */
function skeletonCapability(
  key: (typeof ADS_KEYS)[number],
  def: ActionDefinition,
  calls: string[],
  opts: { withRollback: boolean },
) {
  const steps = Object.fromEntries(
    def.steps.map((stepKey, i) => [
      stepKey,
      async () => {
        calls.push(stepKey)
        const isLast = i === def.steps.length - 1
        return {
          output: isLast ? minimalOutputFor(key) : {},
          costActualUsd: 0,
          // 🔴 def.verification 非 null（'ads_action_integrity'）—— Gateway 要求
          //    至少一条通过的验证记录才算 succeeded（gateway.ts:1175-1185）。
          //    骨架 handler 在最后一步给一条通过的记录；真实回读断言逻辑
          //    留给 PR-B/PR-C 的执行器实现。
          ...(isLast && def.verification
            ? {
                verification: {
                  method: def.verification.method,
                  passed: true,
                  checks: [{ name: '骨架验证（占位，PR-B/PR-C 补真实回读断言）', passed: true }],
                },
              }
            : {}),
        }
      },
    ]),
  )
  const impl: CapabilityImplementation = {
    actionKey: key,
    version: def.version,
    steps,
    ...(opts.withRollback
      ? {
          rollback: async () => ({
            ok: true as const,
            rollbackKind: 'noop' as const,
            detail: { reason: '骨架 handler，PR-B/PR-C 补全真实撤回逻辑' },
          }),
        }
      : {}),
  }
  return (): Readonly<Record<string, CapabilityImplementation>> => ({ [key]: impl })
}

const REQUIRE_APPROVAL_POLICY = (key: string) => ({
  action_key: key,
  mode: 'require_approval',
  spend_cap_per_run_usd: 0,
})

const AUTO_APPROVE_POLICY = (key: string) => ({
  action_key: key,
  mode: 'auto_approve',
  spend_cap_per_run_usd: 100,
})

// ── K14 · 注册表对齐 ────────────────────────────────────────────────────────

describe('K14 · 注册表对齐（对照 docs/STATE.md 的实查结论）', () => {
  it('🔴 生产遗留键 page.apply_cts_github_metadata_request 不在 ActionKey 范围内', () => {
    expect(ACTION_REGISTRY.has('page.apply_cts_github_metadata_request')).toBe(false)
    expect(ACTION_REGISTRY.get('page.apply_cts_github_metadata_request')).toBeNull()
    expect(ACTION_KEYS).not.toContain('page.apply_cts_github_metadata_request')
  })
})

// ── K1 · 四个广告动作已注册 + 声明齐全 + 撤回处理函数是硬约束 ──────────────

describe('K1 · 4 个广告动作已注册，声明对外可撤回', () => {
  it.each(ADS_KEYS)('%s 已注册、是对外动作、声明齐全（outwardBlockReason 通过）', (key) => {
    expect(ACTION_REGISTRY.has(key)).toBe(true)
    const def = ACTION_REGISTRY.get(key)!
    expect(def.sideEffect).toBe('outward')
    expect(def.reversible).toBe(true)
    expect(outwardBlockReason(def)).toBeNull()
  })

  it.each(ADS_KEYS)('%s 的对外授权出处能追到本设计文档', (key) => {
    const def = ACTION_REGISTRY.get(key)!
    expect(def.outwardAuthorization?.declaredIn).toContain('ads-impact-loop-capability.md')
    expect(def.outwardAuthorization?.requiresHumanApproval).toBe(true)
  })

  it.each(ADS_KEYS)(
    '🔴 %s：拿掉撤回处理函数 → 执行被拒绝（ROLLBACK_HANDLER_MISSING），capability 一次都没被调、授权未消费',
    async (key) => {
      const def = ACTION_REGISTRY.get(key)!
      const calls: string[] = []
      const f = makeFixture({
        registry: makeRegistry([def]),
        capabilities: skeletonCapability(key, def, calls, { withRollback: false }),
        options: { policy: REQUIRE_APPROVAL_POLICY(key) },
      })

      const { run } = await submitActionRun(f.kernel, submitInputFor(key))
      await authorizeRun(f.kernel, run)

      await expect(approveAndRun(f.kernel, run.id, 'human@x.com')).rejects.toThrow(
        /ROLLBACK_HANDLER_MISSING/,
      )

      // capability 一次都没被调 —— assembly gate 挡在 beginAuthorizedRun 之前
      expect(calls, `${key}: 骨架 capability 不该被调用`).toEqual([])

      // 授权决策未被消费：补上 handler 后同一份 approval 还能再用
      const allow = f.tables.authorization_decisions.find((d) => d.verdict === 'allow')
      expect(allow, `${key}: 应该已经签出一条 allow 决策`).toBeTruthy()
      expect(allow!.consumed_at).toBeNull()
    },
  )

  it.each(ADS_KEYS)(
    '✅ %s：装上撤回处理函数 → 不被 assembly gate 挡，能跑完整条执行链',
    async (key) => {
      const def = ACTION_REGISTRY.get(key)!
      const calls: string[] = []
      const f = makeFixture({
        registry: makeRegistry([def]),
        capabilities: skeletonCapability(key, def, calls, { withRollback: true }),
        options: { policy: REQUIRE_APPROVAL_POLICY(key) },
      })

      const { run } = await submitActionRun(f.kernel, submitInputFor(key))
      await authorizeRun(f.kernel, run)
      const result = await approveAndRun(f.kernel, run.id, 'human@x.com')

      expect(result.kind).toBe('succeeded')
      expect(calls).toEqual([...def.steps])
    },
  )
})

// ── K2 · 广告动作一律人审批，不论客户策略（复用既有通用机制，不新写 ads.* 判断） ──

describe('K2 · 广告动作一律人审批，不论客户策略', () => {
  it.each(ADS_KEYS)(
    '🔴 %s：客户策略配成 auto_approve 仍然拒绝（outward_requires_human_policy），capability 一次都没被调',
    async (key) => {
      const def = ACTION_REGISTRY.get(key)!
      const calls: string[] = []
      const f = makeFixture({
        registry: makeRegistry([def]),
        capabilities: skeletonCapability(key, def, calls, { withRollback: true }),
        options: { policy: AUTO_APPROVE_POLICY(key) },
      })

      const outcome = await runAction(f.kernel, submitInputFor(key))

      expect(outcome.kind).toBe('denied')
      expect(f.tables.authorization_decisions[0].deny_code).toBe('outward_requires_human_policy')
      expect(calls).toEqual([])
    },
  )

  it.each(ADS_KEYS)(
    '%s：客户策略配成 require_approval 时正常挂起等人点头（对照组，证明拒绝是因为 auto_approve 而不是别的原因）',
    async (key) => {
      const def = ACTION_REGISTRY.get(key)!
      const calls: string[] = []
      const f = makeFixture({
        registry: makeRegistry([def]),
        capabilities: skeletonCapability(key, def, calls, { withRollback: true }),
        options: { policy: REQUIRE_APPROVAL_POLICY(key) },
      })

      const outcome = await runAction(f.kernel, submitInputFor(key))

      expect(outcome.kind).toBe('pending_approval')
      expect(calls).toEqual([])
    },
  )
})

// ── K4 · 广告花费不进内核成本字段 ───────────────────────────────────────────

describe('K4 · 广告花费不进内核成本字段（只由 budget_policy 管，此处恒为 0）', () => {
  it.each(ADS_KEYS)('%s：costModel.estimate 恒为 0，不受输入里携带的预算/花费金额影响', (key) => {
    const def = ACTION_REGISTRY.get(key)!
    expect(def.costModel.estimate({})).toBe(0)
    expect(def.costModel.estimate({ delta_usd: 999_999, budget_usd: 50_000, spend: 1e9 })).toBe(0)
  })

  it.each(ADS_KEYS)('%s：每一步都有非负的真实成本上界（对外动作硬要求，不能留空）', (key) => {
    const def = ACTION_REGISTRY.get(key)!
    for (const stepKey of def.steps) {
      const ceiling = def.costModel.stepCeilingUsd?.[stepKey]
      expect(ceiling, `${key} 的 step "${stepKey}"`).toBeDefined()
      expect(
        typeof ceiling === 'number' && Number.isFinite(ceiling) && ceiling >= 0,
        `${key} 的 step "${stepKey}" 上界必须是有限非负数，实际是 ${String(ceiling)}`,
      ).toBe(true)
    }
  })

  it('🔴 ads.budget_move_plan：input 里带着巨大的预算挪动金额，授权层记的 cost_estimate_usd 依旧是 0', async () => {
    const def = ACTION_REGISTRY.get('ads.budget_move_plan')!
    const calls: string[] = []
    const f = makeFixture({
      registry: makeRegistry([def]),
      capabilities: skeletonCapability('ads.budget_move_plan', def, calls, { withRollback: true }),
      options: { policy: REQUIRE_APPROVAL_POLICY('ads.budget_move_plan') },
    })

    const { run } = await submitActionRun(f.kernel, {
      clientId: CLIENT_A,
      actionKey: 'ads.budget_move_plan',
      purpose: 'growth',
      goalId: GOAL_A,
      triggeredBy: 'human',
      input: {
        plan_id: 'plan-huge-1',
        client_ad_account_id: 'act_test_1',
        currency: 'NZD',
        // 🔴 一条腿声称要挪 50 万美金的广告预算 —— 这必须完全不影响
        //    Kernel 记录的 cost_estimate_usd（K4 的核心断言）。
        legs: [{ from_adset_id: 'adset-a', to_adset_id: 'adset-b', delta_usd: 500_000 }],
      },
    })
    const outcome = await authorizeRun(f.kernel, run)

    expect(outcome.verdict).toBe('require_approval')
    expect(outcome.decision.cost_estimate_usd).toBe(0)
  })
})

// ── K5 · 必须挂 Goal ────────────────────────────────────────────────────────

describe('K5 · 每次运行必须挂真实 Goal，禁止改用途绕过', () => {
  it.each(ADS_KEYS)('%s：allowedPurposes 只含 growth（不能通过改 purpose 绕开 Goal 要求）', (key) => {
    const def = ACTION_REGISTRY.get(key)!
    expect(def.allowedPurposes).toEqual(['growth'])
  })

  it.each(ADS_KEYS)('🔴 %s：growth 任务不挂 goal_id → 提交被拒（INVALID_INPUT）', async (key) => {
    const def = ACTION_REGISTRY.get(key)!
    const calls: string[] = []
    const f = makeFixture({
      registry: makeRegistry([def]),
      capabilities: skeletonCapability(key, def, calls, { withRollback: true }),
      options: { policy: REQUIRE_APPROVAL_POLICY(key) },
    })

    await expect(
      submitActionRun(f.kernel, submitInputFor(key, { goalId: null })),
    ).rejects.toThrow(/必须说清它服务哪个目标/)
    expect(calls).toEqual([])
  })

  it.each(ADS_KEYS)('🔴 %s：goal_id 属于别的客户 → 提交被拒（CROSS_CLIENT，安全告警）', async (key) => {
    const def = ACTION_REGISTRY.get(key)!
    const calls: string[] = []
    const OTHER_CLIENT_GOAL = '90a10000-0000-4000-8000-0000000000ff'
    const f = makeFixture({
      registry: makeRegistry([def]),
      capabilities: skeletonCapability(key, def, calls, { withRollback: true }),
      options: {
        policy: REQUIRE_APPROVAL_POLICY(key),
        goals: [
          { id: GOAL_A, client_id: CLIENT_A, title: '本客户的目标' },
          { id: OTHER_CLIENT_GOAL, client_id: CLIENT_B, title: '别的客户的目标' },
        ],
      },
    })

    await expect(
      submitActionRun(f.kernel, submitInputFor(key, { goalId: OTHER_CLIENT_GOAL })),
    ).rejects.toThrow(KernelError)
    expect(calls).toEqual([])
  })
})
