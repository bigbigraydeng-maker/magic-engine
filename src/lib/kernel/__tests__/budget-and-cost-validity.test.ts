/**
 * T2 —— 开跑前那道预算闸必须结合「下一步要花多少」。
 * T3 —— capability 报回来的花费必须是一个**真实金额**，两层都拦。
 *
 * T2 要防的：已花 $2、上限 $2，下一步是收费的 —— 只判 `spent > cap` 的话
 * 这一步照跑，花成 $3 之后才发现超了。钱已经出去了，事后判没有意义。
 * 但也不能简单改成 `spent >= cap`：`cap = 0` 是正常值（零成本能力），
 * 那样会把它们全部拦死。判据必须是**还剩多少 vs 下一步最多花多少**。
 *
 * T3 要防的：NaN / ±Infinity / 负数进账本。负数最危险 ——
 * 它能把「已花金额」减回来，让同一笔预算被反复消费。
 */

import { describe, it, expect, vi } from 'vitest'
import type { ActionDefinition, CapabilityImplementation, CapabilityStepResult } from '../types'
import { runAction, resumeDeadLetterRun } from '../runner'
import { ACTION_REGISTRY } from '../registry'
import { createCapabilities, computeBlogContentHash } from '@/lib/capabilities'
import type { BlogDraftRow } from '@/lib/capabilities/seo/build-publish-package'
import { makeFixture, makeRegistry, CLIENT_A, GOAL_A, POST_A, BLOG_DRAFT } from './fixtures'

const KEY = 'seo.build_publish_package'
const HASH = computeBlogContentHash(BLOG_DRAFT as unknown as BlogDraftRow)

/** 合成动作：两步 a / b，可以逐步声明成本上界。 */
function definition(over: Partial<ActionDefinition> = {}): ActionDefinition {
  return {
    actionKey: KEY,
    version: 1,
    title: '会花钱的测试动作',
    inputSchema: { type: 'object', required: ['n'], properties: { n: { type: 'string' } }, additionalProperties: false },
    outputSchema: { type: 'object', required: ['done'], properties: { done: { type: 'boolean' } }, additionalProperties: true },
    capability: 'test',
    risk: 'low',
    sideEffect: 'internal_write',
    reversible: true,
    idempotency: { keyFields: ['n'], scope: 'client' },
    // 🔴 estimate 故意给一个**很小的正数**：
    //    给 0 的话「整个动作不花钱」那条兜底会顶上来，测不到「每步上界」这条路；
    //    给大数的话授权阶段那道估算闸（估 > 上限 → deny）会先拦，也测不到执行期。
    costModel: { kind: 'fixed', estimate: () => 0.01, stepCeilingUsd: { a: 2, b: 1 } },
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

const stepCost = (f: { tables: Record<string, Array<Record<string, unknown>>> }, key: string) =>
  Number(f.tables.action_run_steps.find((s) => s.step_key === key)!.cost_actual_usd)

/** a 真花 2（刚好把 cap 花完）；b 的成本由参数决定。 */
function edgeFixture(args: {
  cap: number
  bCeiling: number
  bCost: number
  aCost?: number
  aCeiling?: number
  /** 整个动作的估算。必须 <= cap，否则授权阶段就 deny 了，测不到执行期那道闸。 */
  estimate?: number
}) {
  const bCalls = vi.fn()
  const f = makeFixture({
    registry: makeRegistry([
      definition({
        costModel: {
          kind: 'fixed',
          estimate: () => args.estimate ?? 0.01,
          stepCeilingUsd: { a: args.aCeiling ?? 2, b: args.bCeiling },
        },
      }),
    ]),
    capabilities: () => ({
      [KEY]: capabilityOf({
        a: async () => ({ output: { a: 1 }, costActualUsd: args.aCost ?? 2 }),
        b: async () => {
          bCalls()
          return { output: { done: true }, costActualUsd: args.bCost }
        },
      }),
    }),
    options: { policy: policyWithCap(args.cap) },
  })
  return { f, bCalls }
}

describe('T2 · 等号边界：已花 == 上限', () => {
  it('🔴 已花 $2 / 上限 $2 / 下一步要花钱 → handler 一次都不调', async () => {
    const { f, bCalls } = edgeFixture({ cap: 2, bCeiling: 1, bCost: 1 })

    const out = await runAction(f.kernel, submit())

    expect(out.kind).toBe('dead_letter')
    expect(out.execution?.failure?.code).toBe('COST_CAP_EXCEEDED')
    // 🔴 关键：供应商没被调用，钱没多花一分
    expect(bCalls).not.toHaveBeenCalled()
    expect(stepCost(f, 'a')).toBe(2)
    expect(stepCost(f, 'b')).toBe(0)
    expect(out.execution?.failure?.humanReason).toContain('这一步不开跑')
  })

  it('✅ 已花 $2 / 上限 $2 / 下一步声明零成本 → 照常跑完', async () => {
    const { f, bCalls } = edgeFixture({ cap: 2, bCeiling: 0, bCost: 0 })

    const out = await runAction(f.kernel, submit())

    expect(out.kind).toBe('succeeded')
    expect(bCalls).toHaveBeenCalledTimes(1)
    expect(stepCost(f, 'a')).toBe(2)
    expect(stepCost(f, 'b')).toBe(0)
  })

  it('✅ 上限 0 + 零成本步骤 → 放行（`spent >= cap` 会把这类全部拦死）', async () => {
    const { f, bCalls } = edgeFixture({
      cap: 0, bCeiling: 0, bCost: 0, aCost: 0, aCeiling: 0, estimate: 0,
    })

    const out = await runAction(f.kernel, submit())

    expect(out.kind).toBe('succeeded')
    expect(bCalls).toHaveBeenCalledTimes(1)
  })

  it('🔴 上限 0 + 下一步要花钱 → 第一步就拦住', async () => {
    const bCalls = vi.fn()
    const f = makeFixture({
      registry: makeRegistry([
        definition({
          steps: ['b'],
          costModel: { kind: 'fixed', estimate: () => 1, stepCeilingUsd: { b: 1 } },
        }),
      ]),
      capabilities: () => ({
        [KEY]: capabilityOf({
          b: async () => {
            bCalls()
            return { output: { done: true }, costActualUsd: 1 }
          },
        }),
      }),
      options: { policy: policyWithCap(0) },
    })

    const out = await runAction(f.kernel, submit())

    expect(out.kind).toBe('denied') // 授权阶段的估算闸先拦（估 1 > 上限 0）
    expect(bCalls).not.toHaveBeenCalled()
  })

  it('✅ 上限 0 + 当前真正上线的那个能力 → 一路通过（回归护栏）', async () => {
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

  it('🔴 声明最多 1、实际花了 3 → 契约违约（不是「估得不准」），钱照样记账', async () => {
    const { f, bCalls } = edgeFixture({ cap: 4, bCeiling: 1, bCost: 3 })

    const out = await runAction(f.kernel, submit())

    expect(bCalls).toHaveBeenCalledTimes(1) // 预检按声明放行，它没超过 remaining
    expect(out.kind).toBe('dead_letter')
    // 🔴 上限不作数了 = 预检那道硬闸失去依据，必须当成违约停手
    expect(out.execution?.failure?.code).toBe('COST_CONTRACT_VIOLATION')
    // 账本认的是 actual：如实记 3。不记账才危险 —— 重跑会从低估的数字起算。
    expect(stepCost(f, 'b')).toBe(3)
    expect(out.execution?.failure?.humanReason).toContain('声明最多花')
  })

  it('🔴 死信重跑撞在等号边界上 → 一分钱都不许再花', async () => {
    const { f, bCalls } = edgeFixture({ cap: 2, bCeiling: 1, bCost: 1 })

    const first = await runAction(f.kernel, submit())
    expect(first.kind).toBe('dead_letter')
    expect(bCalls).not.toHaveBeenCalled()

    const again = await resumeDeadLetterRun(f.kernel, first.run.id, 'ray@magiclab')

    expect(again.kind).toBe('dead_letter')
    expect(again.execution?.failure?.code).toBe('COST_CAP_EXCEEDED')
    expect(bCalls).not.toHaveBeenCalled()
    expect(stepCost(f, 'a')).toBe(2) // 历史花费一分没变
  })

  it('🔴 说不出上界的付费步骤 → 不管还剩多少钱都 fail closed', async () => {
    // 「还有余额就先跑，跑完再看超没超」等于承认预检不是硬上限。
    // 契约既然声明这个动作会花钱，就必须说清每一步最多花多少；说不清就别开跑。
    const make = (cap: number) => {
      const calls = vi.fn()
      const f = makeFixture({
        registry: makeRegistry([
          // 没有 stepCeilingUsd，且 estimate 是正数 → 每一步的成本都算「说不出」
          definition({ steps: ['a'], costModel: { kind: 'fixed', estimate: () => 0.5 } }),
        ]),
        capabilities: () => ({
          [KEY]: capabilityOf({
            a: async () => {
              calls()
              return { output: { done: true }, costActualUsd: 0 }
            },
          }),
        }),
        options: { policy: policyWithCap(cap) },
      })
      return { f, calls }
    }

    // 预算绰绰有余（100）也照样拦
    const loose = make(100)
    const out1 = await runAction(loose.f.kernel, submit())
    expect(out1.kind).toBe('dead_letter')
    expect(out1.execution?.failure?.code).toBe('COST_CAP_EXCEEDED')
    expect(loose.calls).not.toHaveBeenCalled()
    expect(out1.execution?.failure?.humanReason).toContain('没有声明它最多会花多少钱')

    // 预算刚好见底同样拦（这一半跟以前一致）
    const tight = make(0.5)
    const out2 = await runAction(tight.f.kernel, submit())
    expect(out2.kind).toBe('dead_letter')
    expect(tight.calls).not.toHaveBeenCalled()
  })

  it('🔴 remaining 恰好等于声明上限 → 放行；差最小一点点 → handler 一次不调', async () => {
    // 等号是够的；不够就是不够。这两条把边界钉死在同一个位置上。
    const exact = edgeFixture({ cap: 3, bCeiling: 1, bCost: 1 }) // a 花 2，剩 1，b 要 1
    const outExact = await runAction(exact.f.kernel, submit())
    expect(outExact.kind).toBe('succeeded')
    expect(exact.bCalls).toHaveBeenCalledTimes(1)

    const short = edgeFixture({ cap: 2.999, bCeiling: 1, bCost: 1 }) // 剩 0.999 < 1
    const outShort = await runAction(short.f.kernel, submit())
    expect(outShort.kind).toBe('dead_letter')
    expect(short.bCalls).not.toHaveBeenCalled()
  })
})

describe('T2 · 声明本身也得是个真实金额，且断点续跑要扣掉已花的', () => {
  it('🔴 声明的上限是 NaN / 负数 / Infinity → 当成「没声明」，付费步骤 fail closed', async () => {
    for (const bogus of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      const calls = vi.fn()
      const f = makeFixture({
        registry: makeRegistry([
          definition({
            steps: ['a'],
            costModel: { kind: 'fixed', estimate: () => 1, stepCeilingUsd: { a: bogus } },
          }),
        ]),
        capabilities: () => ({
          [KEY]: capabilityOf({
            a: async () => {
              calls()
              return { output: { done: true }, costActualUsd: 0 }
            },
          }),
        }),
        options: { policy: policyWithCap(100) },
      })

      const out = await runAction(f.kernel, submit())
      expect(out.kind, `声明 ${String(bogus)} 不该被当成有效上限`).toBe('dead_letter')
      expect(out.execution?.failure?.humanReason).toContain('没有声明它最多会花多少钱')
      expect(calls).not.toHaveBeenCalled()
    }
  })

  it('🔴 断点续跑：预检要扣掉这一步已经花掉的，否则合法的续跑会被误拦', async () => {
    // 上限 1.2 = 这一步的声明上限。第一次花了 0.4 就死信；
    // 续跑时「还可能再花」是 1.2 − 0.4 = 0.8，刚好等于剩下的 0.8 → 该放行。
    // 不扣的话会拿 1.2 跟 0.8 比 → 误拦，这条动作永远跑不完。
    let calls = 0
    const f = makeFixture({
      registry: makeRegistry([
        definition({
          steps: ['a'],
          verification: { method: 'package_integrity', delayMs: 0 },
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
                calls < 2
                  ? { method: 'package_integrity' as const, passed: false, checks: [], failure_reason: '没验过' }
                  : { method: 'package_integrity' as const, passed: true, checks: [] },
            }
          },
        }),
      }),
      options: { policy: policyWithCap(1.2) },
    })

    const first = await runAction(f.kernel, submit())
    expect(first.kind).toBe('dead_letter')
    expect(stepCost(f, 'a')).toBe(0.4)

    const resumed = await resumeDeadLetterRun(f.kernel, first.run.id, 'ray@magiclab')
    expect(resumed.kind).toBe('succeeded')
    expect(stepCost(f, 'a')).toBeCloseTo(0.8, 10)
  })
})

describe('T2c · 上限本身也必须是真实金额（NaN 会让整条花钱链路失效）', () => {
  it('🔴 政策里的上限是 NaN → 一律不做（`x > NaN` 恒假，三道闸会同时失效）', async () => {
    const calls = vi.fn()
    const f = makeFixture({
      registry: makeRegistry([
        definition({ steps: ['a'], costModel: { kind: 'fixed', estimate: () => 1, stepCeilingUsd: { a: 1 } } }),
      ]),
      capabilities: () => ({
        [KEY]: capabilityOf({
          a: async () => {
            calls()
            return { output: { done: true }, costActualUsd: 999 }
          },
        }),
      }),
      options: { policy: policyWithCap(0) },
    })
    // 🔴 绕过 Settings 直接把上限写成 numeric 的 NaN（修数脚本 / 坏输入）。
    //    注意这里放的是**字符串** 'NaN' —— JSON 没有 NaN 这个值，
    //    PostgREST 把 numeric 的 NaN 序列化成字符串 "NaN"，
    //    所以真正到达 JS 的就是这个形状。`1 > 'NaN'` 同样恒假，洞是一样的。
    f.tables.client_automation_policies[0].spend_cap_per_run_usd = 'NaN'

    const out = await runAction(f.kernel, submit())

    expect(out.kind).toBe('denied')
    expect(f.tables.authorization_decisions[0].deny_code).toBe('over_cost_cap')
    expect(out.humanReason).toContain('不是一个有效金额')
    expect(calls).not.toHaveBeenCalled()
  })

  it('🔴 Infinity / 负数的上限同样不算数（「不限」必须由人显式写一个大数）', async () => {
    for (const bogus of ['Infinity', '-Infinity', -1] as Array<string | number>) {
      const f = makeFixture({
        registry: makeRegistry([definition({ steps: ['a'] })]),
        capabilities: () => ({
          [KEY]: capabilityOf({ a: async () => ({ output: { done: true }, costActualUsd: 0 }) }),
        }),
        options: { policy: policyWithCap(0) },
      })
      f.tables.client_automation_policies[0].spend_cap_per_run_usd = bogus

      const out = await runAction(f.kernel, submit())
      expect(out.kind, `上限 ${String(bogus)} 不该被当成有效值`).toBe('denied')
    }
  })

  it('🔴 绕开应用直接往政策表写非法上限 → 数据库拒绝', async () => {
    const f = makeFixture({
      registry: makeRegistry([definition({ steps: ['a'] })]),
      capabilities: () => ({
        [KEY]: capabilityOf({ a: async () => ({ output: { done: true }, costActualUsd: 0 }) }),
      }),
      options: { policy: policyWithCap(0) },
    })

    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const { error } = await f.supabase.from('client_automation_policies').insert({
        client_id: CLIENT_A,
        action_key: `k-${String(bad)}`,
        mode: 'auto_approve',
        policy_version: 1,
        spend_cap_per_run_usd: bad,
        decision_ttl_seconds: 900,
        effective_from: '2020-01-01T00:00:00.000Z',
        effective_to: null,
        updated_by: 'bad-script',
      })
      expect(error?.message, `${String(bad)} 该被拒绝`).toContain('spend_caps_are_real_amounts')
    }
  })
})

describe('T3 · 花费必须是真实金额（应用层）', () => {
  function costFixture(reported: number) {
    return makeFixture({
      registry: makeRegistry([definition({ steps: ['a'] })]),
      capabilities: () => ({
        [KEY]: capabilityOf({
          a: async () => ({ output: { done: true }, costActualUsd: reported }),
        }),
      }),
      options: { policy: policyWithCap(10) },
    })
  }

  it('✅ 0 和正有限数照常入账', async () => {
    expect((await runAction(costFixture(0).kernel, submit())).kind).toBe('succeeded')
    const f = costFixture(1.25)
    expect((await runAction(f.kernel, submit())).kind).toBe('succeeded')
    expect(stepCost(f, 'a')).toBe(1.25)
  })

  for (const [label, value] of [
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['负数', -1],
  ] as Array<[string, number]>) {
    it(`🔴 ${label} → 停手，而且这个数字不进账本`, async () => {
      const f = costFixture(value)

      const out = await runAction(f.kernel, submit())

      expect(out.kind).toBe('dead_letter')
      expect(out.execution?.failure?.code).toBe('INVALID_COST')
      // 🔴 账本没被污染：还是初始的 0，不是 NaN / -1
      expect(stepCost(f, 'a')).toBe(0)
      // 产物照旧落库（东西可能真写出去了，lineage 得看得见）
      expect(f.tables.action_run_steps.find((s) => s.step_key === 'a')!.output).toEqual({ done: true })
    })
  }

  it('🔴 负数尤其危险：不许把已花金额减回来', async () => {
    const f = makeFixture({
      registry: makeRegistry([definition()]),
      capabilities: () => ({
        [KEY]: capabilityOf({
          a: async () => ({ output: { a: 1 }, costActualUsd: 1.5 }),
          b: async () => ({ output: { done: true }, costActualUsd: -1.5 }),
        }),
      }),
      options: { policy: policyWithCap(10) },
    })

    const out = await runAction(f.kernel, submit())

    expect(out.kind).toBe('dead_letter')
    expect(out.execution?.failure?.code).toBe('INVALID_COST')
    expect(stepCost(f, 'a')).toBe(1.5) // 历史花费一分没少
    expect(stepCost(f, 'b')).toBe(0)
  })
})

describe('T3 · 花费必须是真实金额（数据库层）', () => {
  function bareFixture() {
    return makeFixture({
      registry: makeRegistry([definition({ steps: ['a'] })]),
      capabilities: () => ({
        [KEY]: capabilityOf({ a: async () => ({ output: { done: true }, costActualUsd: 0 }) }),
      }),
      options: { policy: policyWithCap(10) },
    })
  }

  it('🔴 绕开应用直接 INSERT 非法金额 → 数据库拒绝', async () => {
    const f = bareFixture()
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const { error } = await f.supabase.from('action_run_steps').insert({
        run_id: 'run-x',
        client_id: CLIENT_A,
        step_key: `k-${String(bad)}`,
        step_index: 0,
        cost_actual_usd: bad,
      })
      expect(error?.message, `${String(bad)} 该被拒绝`).toContain('cost_actual_usd_is_a_real_amount')
    }
    expect(f.tables.action_run_steps).toHaveLength(0)
  })

  it('🔴 绕开应用直接 UPDATE 成非法金额 → 数据库拒绝，原值不动', async () => {
    const f = bareFixture()
    const out = await runAction(f.kernel, submit())
    expect(out.kind).toBe('succeeded')
    const stepId = f.tables.action_run_steps[0].id as string

    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { error } = await f.supabase
        .from('action_run_steps')
        .update({ cost_actual_usd: bad })
        .eq('id', stepId)
      expect(error?.message, `${String(bad)} 该被拒绝`).toContain('cost_actual_usd_is_a_real_amount')
    }
    expect(stepCost(f, 'a')).toBe(0)
  })

  it('✅ 合法金额照常写得进去（不是一刀切禁止写）', async () => {
    const f = bareFixture()
    await runAction(f.kernel, submit())
    const stepId = f.tables.action_run_steps[0].id as string

    const { error } = await f.supabase
      .from('action_run_steps')
      .update({ cost_actual_usd: 2.5 })
      .eq('id', stepId)

    expect(error).toBeNull()
    expect(stepCost(f, 'a')).toBe(2.5)
  })
})
