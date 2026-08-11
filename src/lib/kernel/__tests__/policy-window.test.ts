/**
 * C5 (P2) —— 政策的生效判据是**时间窗**，不是「有没有结束时间」。
 *
 * 早先 getActivePolicy 用 `effective_to IS NULL` 过滤：
 * 一条 `effective_from <= now < effective_to`、明明还在管事的政策，
 * 会被当成「客户没配政策」→ 该自动做的事全部 no_policy 拒绝。
 *
 * 修后的判据（应用层 isPolicyActive 与 RPC 的 SQL 完全一致）：
 *   effective_from <= now AND (effective_to IS NULL OR effective_to > now)
 *
 * 夹具时钟冻结在 2026-08-08T02:00:00Z —— 所有窗口都相对它摆。
 */

import { describe, it, expect } from 'vitest'
import { runAction } from '../runner'
import { approveRun } from '../authorize'
import { isPolicyActive } from '../store'
import { ACTION_REGISTRY } from '../registry'
import { createCapabilities, computeBlogContentHash } from '@/lib/capabilities'
import type { BlogDraftRow } from '@/lib/capabilities/seo/build-publish-package'
import type { ClientAutomationPolicy } from '../types'
import { makeFixture, CLIENT_A, GOAL_A, POST_A, BLOG_DRAFT, liveFence } from './fixtures'

const KEY = 'seo.build_publish_package'
const HASH = computeBlogContentHash(BLOG_DRAFT as unknown as BlogDraftRow)
const NOW = new Date('2026-08-08T02:00:00.000Z')

const PAST = '2026-08-01T00:00:00.000Z'
const FUTURE = '2026-08-15T00:00:00.000Z'
const JUST_BEFORE = '2026-08-08T01:00:00.000Z'

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

function policyWith(window: { from?: string; to?: string | null }) {
  return {
    action_key: KEY,
    mode: 'auto_approve',
    spend_cap_per_run_usd: 0,
    effective_from: window.from ?? PAST,
    effective_to: window.to ?? null,
  }
}

describe('C5 · isPolicyActive 的四种窗口', () => {
  const base = {
    id: 'p',
    client_id: CLIENT_A,
    action_key: KEY,
    mode: 'auto_approve',
    policy_version: 1,
    spend_cap_per_run_usd: 0,
    spend_cap_per_period_usd: null,
    spend_cap_period: null,
    decision_ttl_seconds: 900,
    updated_by: 't',
  } as Omit<ClientAutomationPolicy, 'effective_from' | 'effective_to'>

  it.each([
    ['无结束时间', PAST, null, true],
    ['🔴 有结束时间且还没到期 —— 这条就是 P2 修的', PAST, FUTURE, true],
    ['还没开始生效', FUTURE, null, false],
    ['已经到期', PAST, JUST_BEFORE, false],
  ])('%s → active=%s', (_name, from, to, expected) => {
    const p = { ...base, effective_from: from, effective_to: to } as ClientAutomationPolicy
    expect(isPolicyActive(p, NOW)).toBe(expected)
  })
})

describe('P2-4 · 时间窗过滤必须发生在截断之前（数据库侧）', () => {
  /** 造 N 条未来才生效的定时政策（模拟客户排了一整年的计划）。 */
  function futurePolicies(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      id: `policy-future-${String(i).padStart(2, '0')}`,
      client_id: CLIENT_A,
      action_key: KEY,
      mode: 'deny', // 未来的政策是禁止 —— 选错行的话行为立刻不同
      policy_version: 1,
      spend_cap_per_run_usd: 0,
      spend_cap_per_period_usd: null,
      spend_cap_period: null,
      decision_ttl_seconds: 900,
      // 全部晚于冻结时钟（2026-08-08T02:00Z），且晚于当前生效那条
      effective_from: `2026-09-${String((i % 28) + 1).padStart(2, '0')}T0${i % 10}:00:00.000Z`,
      effective_to: null,
      updated_by: 'scheduler',
    }))
  }

  it('🔴 25 条未来政策排在前面，当前真正生效的那条（更早）仍然找得到', async () => {
    // 早先是「先取最近 20 行再内存过滤」：25 条未来行按 effective_from 倒序
    // 全排在生效那条前面 → 生效那条被截掉 → 应用层报「没配政策」，
    // 而 RPC 却查得到它 —— 两边口径分家。
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: policyWith({}) }, // policy-1，effective_from=2026-08-01，auto
    })
    f.tables.client_automation_policies.push(...futurePolicies(25))
    expect(f.tables.client_automation_policies).toHaveLength(26)

    const outcome = await runAction(f.kernel, submit())

    expect(outcome.kind).toBe('succeeded')
    expect(f.tables.authorization_decisions[0].policy_id).toBe('policy-1')
    expect(f.tables.production_packages).toHaveLength(1)
  })

  it('多条都在生效时 → 确定性取 effective_from 最新的那条', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: policyWith({ from: '2026-08-01T00:00:00.000Z' }) },
    })
    // 第二条也在生效，且 from 更晚 —— 该赢
    f.tables.client_automation_policies.push({
      id: 'policy-newer',
      client_id: CLIENT_A,
      action_key: KEY,
      mode: 'require_approval',
      policy_version: 1,
      spend_cap_per_run_usd: 0,
      spend_cap_per_period_usd: null,
      spend_cap_period: null,
      decision_ttl_seconds: 900,
      effective_from: '2026-08-05T00:00:00.000Z',
      effective_to: null,
      updated_by: 'settings-ui',
    })

    const outcome = await runAction(f.kernel, submit())

    // 赢的是更晚那条 require_approval —— 不是随缘取一条
    expect(outcome.kind).toBe('pending_approval')
    expect(f.tables.authorization_decisions[0].policy_id).toBe('policy-newer')
  })

  it('人工批准路径同一口径：25 条未来政策挡不住批准', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: { ...policyWith({}), mode: 'require_approval' } },
    })
    f.tables.client_automation_policies.push(...futurePolicies(25))

    const pending = await runAction(f.kernel, submit())
    expect(pending.kind).toBe('pending_approval')

    const { approveRun } = await import('../authorize')
    const approved = await approveRun(f.kernel, pending.run.id, 'ray@magiclab')
    expect(approved.verdict).toBe('allow')
  })
})

describe('C5 · 三条执行路径同一个口径', () => {
  it('🔴 Gateway 全链路：带结束时间但没到期的政策 → 正常自动执行（不再 no_policy）', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: policyWith({ to: FUTURE }) },
    })

    const outcome = await runAction(f.kernel, submit())

    expect(outcome.kind).toBe('succeeded')
    expect(f.tables.production_packages).toHaveLength(1)
    // 决策也绑上了这行有限期政策
    expect(f.tables.authorization_decisions[0].policy_id).toBe('policy-1')
  })

  it('人工审批路径：有限期但没到期的 require_approval 政策 → 挂起后能正常批准', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: { ...policyWith({ to: FUTURE }), mode: 'require_approval' } },
    })

    const pending = await runAction(f.kernel, submit())
    expect(pending.kind).toBe('pending_approval')

    const approved = await approveRun(f.kernel, pending.run.id, 'ray@magiclab')
    expect(approved.verdict).toBe('allow')
  })

  it('还没开始生效的政策 → no_policy 拒绝（提前配好的下周规则不能今天放行）', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: policyWith({ from: FUTURE }) },
    })

    const outcome = await runAction(f.kernel, submit())
    expect(outcome.kind).toBe('denied')
    expect(f.tables.authorization_decisions[0].deny_code).toBe('no_policy')
  })

  it('已到期的政策 → policy_expired 拒绝（跟「从来没配过」分开说，引导人去续）', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: policyWith({ to: JUST_BEFORE }) },
    })

    const outcome = await runAction(f.kernel, submit())
    expect(outcome.kind).toBe('denied')
    expect(f.tables.authorization_decisions[0].deny_code).toBe('policy_expired')
    expect(String(outcome.humanReason)).toContain('过期')
  })

  it('授权之后政策窗口关闭 → 执行前被拦（Gateway 与 RPC 同口径）', async () => {
    // 授权时窗口开着（到 04:00），把时钟拨过窗口关闭点再执行
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: {
        policy: {
          ...policyWith({ to: '2026-08-08T03:00:00.000Z' }),
          // 授权 TTL 调长，确保先撞上的是「政策窗口关了」而不是「授权过期」——
          // 两条都该拦，但这条测的是前者
          decision_ttl_seconds: 86400,
        },
      },
    })
    const { submitActionRun } = await import('../runner')
    const { authorizeRun } = await import('../authorize')
    const { executeAuthorizedRun } = await import('../gateway')

    const { run } = await submitActionRun(f.kernel, submit())
    const auth = await authorizeRun(f.kernel, run)
    expect(auth.verdict).toBe('allow')

    f.clock.now = new Date('2026-08-08T03:30:00.000Z')

    await expect(executeAuthorizedRun(f.kernel, auth.ctx!, liveFence(f))).rejects.toThrow(/没有生效的自动化规则/)
    expect(f.tables.production_packages).toHaveLength(0)
  })
})
