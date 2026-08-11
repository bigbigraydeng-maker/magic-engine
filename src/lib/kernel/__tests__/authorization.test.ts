/**
 * 授权段（DAPE 的 A）—— 三态 + 默认 deny + 未知动作留痕。
 *
 * 这一组测试的核心不变量：
 *   **没有任何一条路径能在不写下一条 authorization_decisions 的情况下往前走。**
 * 「静默不执行」和「拒绝并说明原因」在这个系统里是两件事，后者才是及格线。
 */

import { describe, it, expect } from 'vitest'
import type { ActionDefinition } from '../types'
import { runAction, approveAndRun, rejectPendingRun } from '../runner'
import { ACTION_REGISTRY } from '../registry'
import { createCapabilities } from '@/lib/capabilities'
import { makeFixture, makeRegistry, CLIENT_A, GOAL_A, POST_A, BLOG_DRAFT } from './fixtures'
import { computeBlogContentHash } from '@/lib/capabilities'
import type { BlogDraftRow } from '@/lib/capabilities/seo/build-publish-package'

const HASH = computeBlogContentHash(BLOG_DRAFT as unknown as BlogDraftRow)

function submitInput() {
  return {
    clientId: CLIENT_A,
    actionKey: 'seo.build_publish_package',
    purpose: 'growth' as const,
    goalId: GOAL_A,
    triggeredBy: 'schedule' as const,
    input: { blog_post_id: POST_A, content_hash: HASH },
  }
}

describe('授权：默认 deny', () => {
  it('客户没配政策 → 拒绝，并写下一条说明为什么的记录', async () => {
    const f = makeFixture({ registry: ACTION_REGISTRY, capabilities: createCapabilities })

    const outcome = await runAction(f.kernel, submitInput())

    expect(outcome.kind).toBe('denied')
    expect(f.tables.authorization_decisions).toHaveLength(1)
    const d = f.tables.authorization_decisions[0]
    expect(d.verdict).toBe('deny')
    expect(d.deny_code).toBe('no_policy')
    // 拒绝必须有人看见 —— 只写日志就是「发现死在日志里」
    expect(outcome.run.needs_human).toBe(true)
    expect(String(d.reason)).toContain('还没有为')
    // 一个 package 都没造出来
    expect(f.tables.production_packages).toHaveLength(0)
  })

  it('政策明确写了 deny → 拒绝', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: { action_key: 'seo.build_publish_package', mode: 'deny' } },
    })

    const outcome = await runAction(f.kernel, submitInput())

    expect(outcome.kind).toBe('denied')
    expect(f.tables.authorization_decisions[0].deny_code).toBe('policy_deny')
  })

  it('政策已经过期 → 拒绝，不按旧政策放行', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: {
        policy: {
          action_key: 'seo.build_publish_package',
          mode: 'auto_approve',
          effective_to: '2026-01-01T00:00:00.000Z',
        },
      },
    })
    // 注意：store 只按 effective_to IS NULL 过滤，所以带 effective_to 的行会被读到，
    // 由授权层去判它过没过期 —— 这一条正是在测那一层。
    const outcome = await runAction(f.kernel, submitInput())
    expect(outcome.kind).toBe('denied')
  })
})

describe('授权：未知动作', () => {
  it('注册表里没有的动作 → 拒绝，并且**必须留下一条 deny 记录**', async () => {
    const f = makeFixture({ registry: ACTION_REGISTRY, capabilities: createCapabilities })

    const outcome = await runAction(f.kernel, {
      ...submitInput(),
      actionKey: 'ads.diversify_meta_creatives', // AI 现编的自由文本，注册表里没有
    })

    expect(outcome.kind).toBe('denied')
    expect(outcome.run.needs_human).toBe(true)
    const d = f.tables.authorization_decisions[0]
    expect(d.deny_code).toBe('unknown_action')
    expect(d.action_version).toBe(0)
    // 说人话：不能只写「不在白名单里」
    expect(String(d.reason)).toContain('不是系统认识的动作')
  })

  it('同一个未知动作提交两次 → 只有一个 run，不会天天新增一条一样的拒绝', async () => {
    const f = makeFixture({ registry: ACTION_REGISTRY, capabilities: createCapabilities })
    const input = { ...submitInput(), actionKey: 'ads.diversify_meta_creatives' }

    await runAction(f.kernel, input)
    await runAction(f.kernel, input)

    expect(f.tables.action_runs).toHaveLength(1)
  })
})

describe('授权：三态', () => {
  it('auto_approve → 放行，run 走到 authorized 并拿到执行凭证', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: {
        policy: { action_key: 'seo.build_publish_package', mode: 'auto_approve', spend_cap_per_run_usd: 0 },
      },
    })

    const outcome = await runAction(f.kernel, submitInput())

    expect(outcome.kind).toBe('succeeded')
    const d = f.tables.authorization_decisions[0]
    expect(d.verdict).toBe('allow')
    expect(d.decided_by).toBe('policy')
    expect(d.policy_version).toBe(1)
    // 授权被兑换过一次，且只有一次
    expect(d.consumed_at).toBeTruthy()
    expect(d.consumed_by).toBe('test-worker')
  })

  it('require_approval → 停在等人点头，capability 一次都不调', async () => {
    let called = 0
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: (sb) => {
        const real = createCapabilities(sb)
        const wrapped = { ...real['seo.build_publish_package'] }
        wrapped.steps = Object.fromEntries(
          Object.entries(real['seo.build_publish_package'].steps).map(([k, h]) => [
            k,
            async (s: Parameters<typeof h>[0]) => {
              called += 1
              return h(s)
            },
          ]),
        )
        return { 'seo.build_publish_package': wrapped }
      },
      options: {
        policy: { action_key: 'seo.build_publish_package', mode: 'require_approval' },
      },
    })

    const outcome = await runAction(f.kernel, submitInput())

    expect(outcome.kind).toBe('pending_approval')
    expect(outcome.run.status).toBe('pending_approval')
    expect(outcome.run.needs_human).toBe(true)
    expect(called).toBe(0)
    expect(f.tables.production_packages).toHaveLength(0)
    expect(f.tables.authorization_decisions[0].verdict).toBe('require_approval')
  })

  it('人点了同意 → 新签一条 human 决策（不改写原来那条），然后真的跑完', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: { action_key: 'seo.build_publish_package', mode: 'require_approval' } },
    })

    const pending = await runAction(f.kernel, submitInput())
    const done = await approveAndRun(f.kernel, pending.run.id, 'bigbigraydeng@gmail.com')

    expect(done.kind).toBe('succeeded')
    expect(f.tables.authorization_decisions).toHaveLength(2)
    // 🔴 原来那条 require_approval 一个字都没被改
    expect(f.tables.authorization_decisions[0].verdict).toBe('require_approval')
    const human = f.tables.authorization_decisions[1]
    expect(human.verdict).toBe('allow')
    expect(human.decided_by).toBe('human')
    expect(human.decided_by_user).toBe('bigbigraydeng@gmail.com')
    expect(f.tables.production_packages).toHaveLength(1)
  })

  it('人点了不做 → 落 denied，同样是新签一条，且不执行', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: { action_key: 'seo.build_publish_package', mode: 'require_approval' } },
    })

    const pending = await runAction(f.kernel, submitInput())
    const rejected = await rejectPendingRun(f.kernel, pending.run.id, 'ray', '这周先不做')

    expect(rejected.kind).toBe('denied')
    expect(rejected.run.status).toBe('denied')
    expect(f.tables.production_packages).toHaveLength(0)
    expect(f.tables.authorization_decisions[1].decided_by).toBe('human')
  })
})

describe('授权：花钱信封', () => {
  const COSTLY: ActionDefinition = {
    ...(ACTION_REGISTRY.get('seo.build_publish_package') as ActionDefinition),
    costModel: { kind: 'estimated', estimate: () => 12.5 },
  }

  it('预计花费超过客户设的单次上限 → 拒绝，理由里写清差多少', async () => {
    const f = makeFixture({
      registry: makeRegistry([COSTLY]),
      capabilities: createCapabilities,
      options: {
        policy: {
          action_key: 'seo.build_publish_package',
          mode: 'auto_approve',
          spend_cap_per_run_usd: 2,
        },
      },
    })

    const outcome = await runAction(f.kernel, submitInput())

    expect(outcome.kind).toBe('denied')
    const d = f.tables.authorization_decisions[0]
    expect(d.deny_code).toBe('over_cost_cap')
    expect(String(d.reason)).toContain('$12.50')
    expect(String(d.reason)).toContain('$2.00')
  })

  it('上限没填 = 0，不是「不限」', async () => {
    const f = makeFixture({
      registry: makeRegistry([COSTLY]),
      capabilities: createCapabilities,
      options: {
        policy: {
          action_key: 'seo.build_publish_package',
          mode: 'auto_approve',
          spend_cap_per_run_usd: null,
        },
      },
    })

    const outcome = await runAction(f.kernel, submitInput())
    expect(outcome.kind).toBe('denied')
    expect(f.tables.authorization_decisions[0].deny_code).toBe('over_cost_cap')
  })
})

describe('授权：目标绑定的双向约束', () => {
  it('增长类任务不挂目标 → 提交阶段就拒绝', async () => {
    const f = makeFixture({ registry: ACTION_REGISTRY, capabilities: createCapabilities })
    await expect(
      runAction(f.kernel, { ...submitInput(), goalId: null }),
    ).rejects.toThrow(/必须说清它服务哪个目标/)
  })

  it('维护类任务硬挂一个目标 → 也拒绝（防伪造 Goal）', async () => {
    const f = makeFixture({ registry: ACTION_REGISTRY, capabilities: createCapabilities })
    await expect(
      runAction(f.kernel, { ...submitInput(), purpose: 'maintenance', goalId: GOAL_A }),
    ).rejects.toThrow(/不该挂在某个增长目标下/)
  })

  it('动作定义只允许 growth 时，拿它当维护任务提交 → 拒绝并留痕', async () => {
    const f = makeFixture({ registry: ACTION_REGISTRY, capabilities: createCapabilities })
    const outcome = await runAction(f.kernel, {
      ...submitInput(),
      purpose: 'maintenance',
      goalId: null,
    })
    expect(outcome.kind).toBe('denied')
    expect(f.tables.authorization_decisions[0].deny_code).toBe('purpose_not_allowed')
  })
})

describe('授权：输入契约', () => {
  it('少了必填字段 → 拒绝（而不是等执行到一半才炸）', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: { action_key: 'seo.build_publish_package', mode: 'auto_approve' } },
    })

    // content_hash 是幂等键的一半，缺了连键都算不出来
    await expect(
      runAction(f.kernel, { ...submitInput(), input: { blog_post_id: POST_A } }),
    ).rejects.toThrow(/算不出幂等键/)
  })

  it('多了没定义的字段 → 拒绝', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: { action_key: 'seo.build_publish_package', mode: 'auto_approve' } },
    })

    const outcome = await runAction(f.kernel, {
      ...submitInput(),
      input: { blog_post_id: POST_A, content_hash: HASH, publish_now: 'yes' },
    })

    expect(outcome.kind).toBe('denied')
    expect(f.tables.authorization_decisions[0].deny_code).toBe('invalid_input')
  })
})

describe('授权：对外副作用硬闸', () => {
  it('定义里标了 outward 的动作，无论政策怎么配都不放行', async () => {
    const OUTWARD: ActionDefinition = {
      ...(ACTION_REGISTRY.get('seo.build_publish_package') as ActionDefinition),
      sideEffect: 'outward',
    }
    const f = makeFixture({
      registry: makeRegistry([OUTWARD]),
      capabilities: createCapabilities,
      options: {
        policy: {
          action_key: 'seo.build_publish_package',
          mode: 'auto_approve',
          spend_cap_per_run_usd: 100,
        },
      },
    })

    const outcome = await runAction(f.kernel, submitInput())

    expect(outcome.kind).toBe('denied')
    expect(f.tables.authorization_decisions[0].deny_code).toBe('outward_side_effect_blocked')
  })
})
