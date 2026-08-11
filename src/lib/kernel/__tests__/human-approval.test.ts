/**
 * P1-1 —— 人工批准**不能**盖过当前政策。
 *
 * 早先 `approveRun` 只检查「run 是不是在等审批」，于是等审批期间世界变了也照签：
 * 政策被删掉 / 政策改成禁止 / 契约升版 / 输入已不合法 / 动作被改成对外副作用。
 * 最阴的一条是政策被删 —— 签出来的决策 `policy_version = null`，
 * Gateway 重读也拿到 null，`null === null` 直接放行。
 *
 * 现在人工批准能做的**只有一件事**：把「当前仍是 require_approval、
 * 而且跟当初挂起时同一版」的政策，从「等你点头」变成「可以做」。
 * 其余任何变化一律 fail closed，并落一条说清变了什么的拒绝记录。
 */

import { describe, it, expect, vi } from 'vitest'
import type { ActionDefinition } from '../types'
import { runAction, approveAndRun } from '../runner'
import { ACTION_REGISTRY } from '../registry'
import { createCapabilities, computeBlogContentHash } from '@/lib/capabilities'
import type { BlogDraftRow } from '@/lib/capabilities/seo/build-publish-package'
import { makeFixture, makeRegistry, CLIENT_A, GOAL_A, POST_A, BLOG_DRAFT } from './fixtures'

const KEY = 'seo.build_publish_package'
const HASH = computeBlogContentHash(BLOG_DRAFT as unknown as BlogDraftRow)
const BASE = ACTION_REGISTRY.get(KEY) as ActionDefinition

const APPROVAL_POLICY = { action_key: KEY, mode: 'require_approval', spend_cap_per_run_usd: 0 }

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

/** 起一个已经停在「等人点头」的 run，并数清 capability 被调过几次。 */
async function pendingFixture() {
  const calls = vi.fn()
  const f = makeFixture({
    registry: ACTION_REGISTRY,
    capabilities: (sb) => {
      const real = createCapabilities(sb)
      const impl = real[KEY]
      return {
        [KEY]: {
          ...impl,
          steps: Object.fromEntries(
            Object.entries(impl.steps).map(([k, h]) => [
              k,
              async (s: Parameters<typeof h>[0]) => {
                calls()
                return h(s)
              },
            ]),
          ),
        },
      }
    },
    options: { policy: APPROVAL_POLICY },
  })
  const pending = await runAction(f.kernel, submit())
  expect(pending.kind).toBe('pending_approval')
  expect(calls).not.toHaveBeenCalled()
  return { f, pending, calls }
}

/** 断言：这次批准没有放行、什么也没做、并且留下了一条说明原因的拒绝记录。 */
function expectFailedClosed(
  f: Awaited<ReturnType<typeof pendingFixture>>['f'],
  calls: ReturnType<typeof vi.fn>,
  outcome: { kind: string; run: { status: string } },
  denyCode: string,
) {
  expect(outcome.kind).toBe('denied')
  expect(outcome.run.status).toBe('denied')
  expect(calls).not.toHaveBeenCalled()
  expect(f.tables.production_packages).toHaveLength(0)
  const last = f.tables.authorization_decisions.at(-1)!
  expect(last.verdict).toBe('deny')
  expect(last.deny_code).toBe(denyCode)
  // 拒绝理由必须说清是谁点的、以及为什么现在不行
  expect(String(last.reason)).toContain('ray@magiclab')
}

describe('P1-1 · 人工批准盖不过当前政策', () => {
  it('挂起期间政策被删掉 → 人点同意也不执行', async () => {
    const { f, pending, calls } = await pendingFixture()
    f.tables.client_automation_policies.length = 0

    const out = await approveAndRun(f.kernel, pending.run.id, 'ray@magiclab')

    expectFailedClosed(f, calls, out, 'no_policy')
    // 🔴 最关键的一条：绝不能签出一个 policy_version = null 的放行
    expect(f.tables.authorization_decisions.every((d) => d.verdict !== 'allow')).toBe(true)
  })

  it('挂起期间政策从「要审批」改成「禁止」→ 人点同意也不执行', async () => {
    const { f, pending, calls } = await pendingFixture()
    await f.supabase
      .from('client_automation_policies')
      .update({ mode: 'deny' })
      .eq('id', 'policy-1')
      .select('id')

    const out = await approveAndRun(f.kernel, pending.run.id, 'ray@magiclab')
    expectFailedClosed(f, calls, out, 'policy_deny')
  })

  it('挂起期间政策改成「自动执行」→ 人也不能按旧请求补签', async () => {
    const { f, pending, calls } = await pendingFixture()
    await f.supabase
      .from('client_automation_policies')
      .update({ mode: 'auto_approve' })
      .eq('id', 'policy-1')
      .select('id')

    const out = await approveAndRun(f.kernel, pending.run.id, 'ray@magiclab')
    expectFailedClosed(f, calls, out, 'policy_changed_since_request')
  })

  it('挂起期间政策版本变了（改了花钱上限）→ 人点同意也不执行', async () => {
    const { f, pending, calls } = await pendingFixture()
    // 只改上限，模式还是 require_approval —— 版本由数据库自动 +1
    await f.supabase
      .from('client_automation_policies')
      .update({ spend_cap_per_run_usd: 50 })
      .eq('id', 'policy-1')
      .select('id')
    expect(f.tables.client_automation_policies[0].policy_version).toBe(2)

    const out = await approveAndRun(f.kernel, pending.run.id, 'ray@magiclab')
    expectFailedClosed(f, calls, out, 'policy_changed_since_request')
    expect(String(f.tables.authorization_decisions.at(-1)!.reason)).toContain('第 1 版 → 第 2 版')
  })

  it('🔴 政策被删掉又重建成「自动执行」（版本号回到 1）→ 人也不能按旧请求补签', async () => {
    // 这条专门盯「模式检查」本身。
    // 光把模式从 require_approval 改成 auto_approve 是测不出它的：改模式会让
    // 数据库自动把版本 +1，于是版本检查会先把它拦下来 —— 模式检查被挡在后面，
    // 删掉也不会红（上一轮变异验证正是这么漏掉的）。
    // 而「删掉再建一条」是设置页很自然会做的事，新行的版本号从 1 开始，
    // 于是版本对得上、模式却变了 —— 只有模式检查挡得住。
    const { f, pending, calls } = await pendingFixture()
    f.tables.client_automation_policies.length = 0
    f.tables.client_automation_policies.push({
      id: 'policy-2',
      client_id: CLIENT_A,
      action_key: KEY,
      mode: 'auto_approve',
      policy_version: 1,
      spend_cap_per_run_usd: 0,
      spend_cap_per_period_usd: null,
      spend_cap_period: null,
      decision_ttl_seconds: 900,
      effective_from: '2020-01-01T00:00:00.000Z',
      effective_to: null,
      updated_by: 'settings-ui',
    })

    const out = await approveAndRun(f.kernel, pending.run.id, 'ray@magiclab')
    expectFailedClosed(f, calls, out, 'policy_changed_since_request')
  })

  it('🔴 模式变了但行和版本都没动（触发器失灵的形状）→ 只有模式检查挡得住', async () => {
    // 三种改法三道闸：.update() 改模式 → 版本 +1 → 版本检查先拦；
    // 删掉重建 → 行身份检查先拦；**直接改内存行**（绕过触发器复刻）→
    // 行还是那行、版本还是 1，只有「当前必须仍是 require_approval」这道自己咬人。
    // C2 加了身份检查之后，这道闸恰好被遮蔽过一次（变异验证抓出来的）。
    const { f, pending, calls } = await pendingFixture()
    f.tables.client_automation_policies[0].mode = 'auto_approve'

    const out = await approveAndRun(f.kernel, pending.run.id, 'ray@magiclab')
    expectFailedClosed(f, calls, out, 'policy_changed_since_request')
    expect(String(f.tables.authorization_decisions.at(-1)!.reason)).toContain('自动执行')
  })

  it('挂起期间契约升版 → 人点同意也不执行', async () => {
    const { f, pending, calls } = await pendingFixture()
    const v2 = { ...f.kernel, registry: makeRegistry([{ ...BASE, version: 2 }]) }

    const out = await approveAndRun(v2, pending.run.id, 'ray@magiclab')
    expectFailedClosed(f, calls, out, 'unknown_action_version')
  })

  it('挂起期间输入契约收紧、这条的参数已不合法 → 人点同意也不执行', async () => {
    const { f, pending, calls } = await pendingFixture()
    const tightened: ActionDefinition = {
      ...BASE,
      inputSchema: {
        type: 'object',
        required: ['blog_post_id', 'content_hash', 'reviewed_by'],
        properties: {
          blog_post_id: { type: 'string' },
          content_hash: { type: 'string' },
          reviewed_by: { type: 'string' },
        },
        additionalProperties: false,
      },
    }
    const k = { ...f.kernel, registry: makeRegistry([tightened]) }

    const out = await approveAndRun(k, pending.run.id, 'ray@magiclab')
    expectFailedClosed(f, calls, out, 'invalid_input')
  })

  it('🔴 挂起期间动作被改成会对外发布 → 人也批不了', async () => {
    const { f, pending, calls } = await pendingFixture()
    const k = { ...f.kernel, registry: makeRegistry([{ ...BASE, sideEffect: 'outward' as const }]) }

    const out = await approveAndRun(k, pending.run.id, 'ray@magiclab')
    expectFailedClosed(f, calls, out, 'outward_side_effect_blocked')
    expect(String(f.tables.authorization_decisions.at(-1)!.reason)).toContain('根本不做')
  })

  it('挂起期间估算涨到超过上限 → 人点同意也不执行', async () => {
    const { f, pending, calls } = await pendingFixture()
    const costly = { ...f.kernel, registry: makeRegistry([{ ...BASE, costModel: { kind: 'estimated' as const, estimate: () => 9 } }]) }

    const out = await approveAndRun(costly, pending.run.id, 'ray@magiclab')
    expectFailedClosed(f, calls, out, 'over_cost_cap')
  })

  it('当初那份审批请求找不到了 → 不凭空签一份放行', async () => {
    const { f, pending, calls } = await pendingFixture()
    // 模拟运维手滑把 run 上的指向抹了（或指向了一条不存在的记录）
    await f.supabase
      .from('action_runs')
      .update({ authorization_decision_id: null })
      .eq('id', pending.run.id)
      .select('id')

    const out = await approveAndRun(f.kernel, pending.run.id, 'ray@magiclab')
    expectFailedClosed(f, calls, out, 'approval_context_lost')
  })

  it('✅ 什么都没变 → 正常批准并真的跑完', async () => {
    const { f, pending, calls } = await pendingFixture()

    const out = await approveAndRun(f.kernel, pending.run.id, 'ray@magiclab')

    expect(out.kind).toBe('succeeded')
    expect(calls).toHaveBeenCalled()
    expect(f.tables.production_packages).toHaveLength(1)
    const allow = f.tables.authorization_decisions.at(-1)!
    expect(allow.verdict).toBe('allow')
    expect(allow.decided_by).toBe('human')
    expect(allow.decided_by_user).toBe('ray@magiclab')
    expect(allow.policy_version).toBe(1)
    // 原来那条 require_approval 一个字都没被改
    expect(f.tables.authorization_decisions[0].verdict).toBe('require_approval')
  })
})
