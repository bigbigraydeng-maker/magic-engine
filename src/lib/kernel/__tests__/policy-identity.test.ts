/**
 * C2 —— 授权绑定的是**那一行政策**，不只是一个版本号。
 *
 * 版本号只在同一行政策内有意义：「auto v1 → 删掉 → 重建 deny v1」时
 * 两条政策版本号完全一样，只查版本号的话这条路整个是敞开的。
 * 所以决策记 `policy_id`（uuid，删了就再也造不出同一个），执行前三连查：
 * **行身份 → 版本 → 模式**。模式复核还兼任版本触发器失灵时的最后防线。
 *
 * 🔴 Gateway 层的测试全部断言「**在去领执行权之前**就被拒了」
 *    （`kernel_begin_authorized_run` 一次都没被调用）——
 *    RPC 里有同样的检查，只看最终结果的话，把 Gateway 那层删掉照样绿。
 */

import { describe, it, expect, vi } from 'vitest'
import { runAction, submitActionRun } from '../runner'
import { authorizeRun, approveRun } from '../authorize'
import { executeAuthorizedRun } from '../gateway'
import { ACTION_REGISTRY } from '../registry'
import { createCapabilities, computeBlogContentHash } from '@/lib/capabilities'
import type { BlogDraftRow } from '@/lib/capabilities/seo/build-publish-package'
import { makeFixture, CLIENT_A, GOAL_A, POST_A, BLOG_DRAFT, liveFence } from './fixtures'
import type { Row } from './fake-supabase'

const KEY = 'seo.build_publish_package'
const HASH = computeBlogContentHash(BLOG_DRAFT as unknown as BlogDraftRow)
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

/** 把政策整行删掉、换成一条新行（模拟「设置页里删了重配」）。 */
function rebuildPolicy(tables: Record<string, Row[]>, over: Partial<Row>) {
  const old = tables.client_automation_policies[0]
  tables.client_automation_policies.length = 0
  tables.client_automation_policies.push({
    ...old,
    id: 'policy-rebuilt',
    policy_version: 1, // 新行版本号从 1 开始 —— 跟旧行一模一样
    ...over,
  })
}

/** 拿到一份已签发但还没开跑的授权 + capability 调用计数 + RPC 调用记录。 */
async function authorizedFixture(policyMode = 'auto_approve') {
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
    options: { policy: { ...AUTO_POLICY, mode: policyMode } },
  })

  type RpcFn = (name: string, args: Record<string, unknown>) => Promise<unknown>
  const spied = f.supabase as unknown as { rpc: RpcFn }
  const rpcCalls: string[] = []
  const realRpc = spied.rpc.bind(f.supabase) as RpcFn
  spied.rpc = (name, args) => {
    rpcCalls.push(name)
    return realRpc(name, args)
  }

  return { f, builds, rpcCalls }
}

describe('C2 · 政策身份：删掉重建 ≠ 同一条政策', () => {
  it('🔴 auto v1 签发 → 删掉 → 重建 deny v1 → 拒绝执行，且 Gateway 层就拒了', async () => {
    const { f, builds, rpcCalls } = await authorizedFixture()
    const { run } = await submitActionRun(f.kernel, submit())
    const auth = await authorizeRun(f.kernel, run)
    expect(auth.ctx).toBeTruthy()
    expect(f.tables.authorization_decisions[0].policy_id).toBe('policy-1')

    rebuildPolicy(f.tables, { mode: 'deny' })

    await expect(executeAuthorizedRun(f.kernel, auth.ctx!, liveFence(f))).rejects.toThrow(/删掉重建/)
    // 🔴 两道闸各自都在：Gateway 自己拒的，没走到数据库那道
    expect(rpcCalls).not.toContain('kernel_begin_authorized_run')
    expect(builds).not.toHaveBeenCalled()
    expect(f.tables.production_packages).toHaveLength(0)
    expect(f.tables.action_runs[0].status).toBe('authorized')
  })

  it('🔴 auto v1 → 删掉 → 重建 auto v1（连模式都一样）→ 旧授权也拒绝', async () => {
    // 最严的一条：新政策跟旧政策**内容完全相同**，只是行不是同一行。
    // 授权引用的必须是「签发时那份具体契约」，不是「内容碰巧一样的另一份」。
    const { f, builds } = await authorizedFixture()
    const { run } = await submitActionRun(f.kernel, submit())
    const auth = await authorizeRun(f.kernel, run)

    rebuildPolicy(f.tables, { mode: 'auto_approve' })

    await expect(executeAuthorizedRun(f.kernel, auth.ctx!, liveFence(f))).rejects.toThrow(/删掉重建/)
    expect(builds).not.toHaveBeenCalled()
  })

  it('🔴 人批的授权 → 政策换成 auto → 旧的 human allow 拒绝执行', async () => {
    const { f, builds } = await authorizedFixture('require_approval')
    const pending = await runAction(f.kernel, submit())
    expect(pending.kind).toBe('pending_approval')
    const approved = await approveRun(f.kernel, pending.run.id, 'ray@magiclab')
    expect(approved.verdict).toBe('allow')

    // 人批完、还没执行，政策被改成了自动（版本触发器会 bump 版本）
    await f.supabase
      .from('client_automation_policies')
      .update({ mode: 'auto_approve' })
      .eq('id', 'policy-1')
      .select('id')

    await expect(executeAuthorizedRun(f.kernel, approved.ctx!, liveFence(f))).rejects.toThrow(/规则/)
    expect(builds).not.toHaveBeenCalled()
  })

  it('🔴 人批的授权 → 政策删掉重建仍是 require_approval v1 → 也拒绝（身份检查独立于版本）', async () => {
    const { f, builds } = await authorizedFixture('require_approval')
    const pending = await runAction(f.kernel, submit())
    const approved = await approveRun(f.kernel, pending.run.id, 'ray@magiclab')

    rebuildPolicy(f.tables, { mode: 'require_approval' })

    await expect(executeAuthorizedRun(f.kernel, approved.ctx!, liveFence(f))).rejects.toThrow(/删掉重建/)
    expect(builds).not.toHaveBeenCalled()
  })

  it('🔴 模式变了但行和版本都没动（触发器失灵的形状）→ Gateway 的模式复核自己咬人', async () => {
    // 直接改内存行，绕过 .update()，也就绕过了版本触发器 —— 版本还是 1、行还是那一行。
    // 只有模式复核挡得住这条。
    const { f, builds, rpcCalls } = await authorizedFixture()
    const { run } = await submitActionRun(f.kernel, submit())
    const auth = await authorizeRun(f.kernel, run)

    f.tables.client_automation_policies[0].mode = 'deny'

    await expect(executeAuthorizedRun(f.kernel, auth.ctx!, liveFence(f))).rejects.toThrow(/已经不是自动/)
    expect(rpcCalls).not.toContain('kernel_begin_authorized_run')
    expect(builds).not.toHaveBeenCalled()
  })

  it('✅ 行 / 版本 / 模式都没变 → 正常执行', async () => {
    const { f, builds } = await authorizedFixture()
    const { run } = await submitActionRun(f.kernel, submit())
    const auth = await authorizeRun(f.kernel, run)

    const result = await executeAuthorizedRun(f.kernel, auth.ctx!, liveFence(f))
    expect(result.status).toBe('succeeded')
    expect(builds).toHaveBeenCalledTimes(1)
    expect(f.tables.production_packages).toHaveLength(1)
  })

  it('每一条 allow / require_approval 决策都带着 policy_id（审计可回指到那一行）', async () => {
    const { f } = await authorizedFixture('require_approval')
    const pending = await runAction(f.kernel, submit())
    await approveRun(f.kernel, pending.run.id, 'ray@magiclab')

    const decisions = f.tables.authorization_decisions
    expect(decisions).toHaveLength(2)
    expect(decisions.every((d) => d.policy_id === 'policy-1')).toBe(true)
  })
})
