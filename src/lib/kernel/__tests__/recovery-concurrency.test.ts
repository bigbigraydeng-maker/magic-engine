/**
 * S1（P1）—— denied / dead_letter 恢复必须原子领取恢复权。
 *
 * 要防的形状（跟人工批准是同一类）：两个操作者（或双击）都看到 denied/dead_letter，
 * A 抢先恢复并开跑，B 晚到的无条件 update 又把 running/succeeded 的 run
 * 改回 queued 并再签一份 allow → capability 做第二遍。
 *
 * 现在两条恢复路径都走 `kernel_claim_run_recovery`：
 * 锁 run → 状态 CAS → 指针 CAS → （denied 还要查白名单）→
 * **步骤重置和状态转换在同一个事务里**（不留半恢复态）。
 *
 * 全部用 `Promise.allSettled` 真并发。
 */

import { describe, it, expect, vi } from 'vitest'
import { runAction, recoverDeniedRun, resumeDeadLetterRun } from '../runner'
import { ACTION_REGISTRY } from '../registry'
import { KernelError } from '../errors'
import { createCapabilities, computeBlogContentHash } from '@/lib/capabilities'
import type { BlogDraftRow } from '@/lib/capabilities/seo/build-publish-package'
import { makeFixture, CLIENT_A, GOAL_A, POST_A, BLOG_DRAFT } from './fixtures'

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

const LATE_POLICY = {
  id: 'policy-late',
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
}

/** capability 的 build 步骤计数；persist 可以被开关成「非可重试失败」。 */
function makeControllable() {
  const builds = vi.fn()
  const control = { failPersist: false }
  const capabilities = (sb: Parameters<typeof createCapabilities>[0]) => {
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
          persist: async (s: Parameters<(typeof impl.steps)['persist']>[0]) => {
            if (control.failPersist) {
              throw new KernelError('INVALID_STATE', '下游还没准备好')
            }
            return impl.steps.persist(s)
          },
        },
      },
    }
  }
  return { builds, control, capabilities }
}

describe('S1 · 并发恢复 denied', () => {
  it('🔴 两个人同时恢复 → 一个赢：capability 1 次、包 1 个、有效 allow 1 条', async () => {
    const { builds, capabilities } = makeControllable()
    // 没有政策 → 第一次提交必然 no_policy denied
    const f = makeFixture({ registry: ACTION_REGISTRY, capabilities })

    const denied = await runAction(f.kernel, submit())
    expect(denied.kind).toBe('denied')
    const denyDecisionId = String(f.tables.authorization_decisions[0].id)

    // 人把规则配好了
    f.tables.client_automation_policies.push({ ...LATE_POLICY })

    const settled = await Promise.allSettled([
      recoverDeniedRun(f.kernel, denied.run.id, 'ray@magiclab', '规则已配好'),
      recoverDeniedRun(f.kernel, denied.run.id, 'jayden@magiclab', '我也来恢复'),
    ])

    const fulfilled = settled.filter((s) => s.status === 'fulfilled')
    const rejected = settled.filter((s) => s.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(
      (fulfilled[0] as PromiseFulfilledResult<{ kind: string }>).value.kind,
    ).toBe('succeeded')
    // 输家拿到的是明确失败，不是静默、不是也「成功」
    expect(String((rejected[0] as PromiseRejectedResult).reason)).toMatch(
      /已经有人先恢复|状态在你操作期间变过|不是被拒绝的状态/,
    )

    // 🔴 核心不变量
    expect(builds).toHaveBeenCalledTimes(1)
    expect(f.tables.production_packages).toHaveLength(1)
    expect(
      f.tables.authorization_decisions.filter((d) => d.verdict === 'allow'),
      '只能有一个执行 owner',
    ).toHaveLength(1)
    expect(f.tables.action_runs[0].status).toBe('succeeded')
    // 原始 deny 证据原样保留
    const oldDeny = f.tables.authorization_decisions.find((d) => d.id === denyDecisionId)!
    expect(oldDeny.verdict).toBe('deny')
    expect(oldDeny.deny_code).toBe('no_policy')
  })

  it('🔴 已经跑完之后，拿旧快照的迟到恢复不许把 succeeded 拽回 queued', async () => {
    const { builds, capabilities } = makeControllable()
    const f = makeFixture({ registry: ACTION_REGISTRY, capabilities })

    const denied = await runAction(f.kernel, submit())
    f.tables.client_automation_policies.push({ ...LATE_POLICY })

    const ok = await recoverDeniedRun(f.kernel, denied.run.id, 'ray@magiclab', '规则已配好')
    expect(ok.kind).toBe('succeeded')

    // B 拿着**恢复发生之前**的旧快照（等价于并发里 B 先读到 denied 的那一刻）
    const staleSnapshot = { ...denied.run }
    const kernelB = {
      ...f.kernel,
      requireRun: async () => staleSnapshot,
    }

    await expect(
      recoverDeniedRun(kernelB, denied.run.id, 'jayden@magiclab', '我也来'),
    ).rejects.toThrow(/已经有人先恢复|正在跑|已经跑完/)

    expect(f.tables.action_runs[0].status).toBe('succeeded')
    expect(builds).toHaveBeenCalledTimes(1)
    expect(f.tables.production_packages).toHaveLength(1)
  })
})

describe('S1 · 并发恢复 dead_letter', () => {
  /** 造一条 build 成功、persist 死信的 run。 */
  async function deadLetterFixture() {
    const { builds, control, capabilities } = makeControllable()
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities,
      options: { policy: AUTO_POLICY },
    })
    control.failPersist = true
    const first = await runAction(f.kernel, submit())
    expect(first.kind).toBe('dead_letter')
    expect(builds).toHaveBeenCalledTimes(1)
    // build 成功、persist 死信
    const build = f.tables.action_run_steps.find((s) => s.step_key === 'build')!
    const persist = f.tables.action_run_steps.find((s) => s.step_key === 'persist')!
    expect(build.status).toBe('succeeded')
    expect(persist.status).toBe('dead_letter')
    control.failPersist = false
    return { f, builds, first }
  }

  it('🔴 两个人同时重跑 → 一个赢；已成功的步骤不被二次重置、不被重跑', async () => {
    const { f, builds, first } = await deadLetterFixture()

    const settled = await Promise.allSettled([
      resumeDeadLetterRun(f.kernel, first.run.id, 'ray@magiclab'),
      resumeDeadLetterRun(f.kernel, first.run.id, 'jayden@magiclab'),
    ])

    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1)
    expect(settled.filter((s) => s.status === 'rejected')).toHaveLength(1)

    // 🔴 build 已经成功过 —— 既没被重置也没被重跑（断点续跑）
    expect(builds).toHaveBeenCalledTimes(1)
    const build = f.tables.action_run_steps.find((s) => s.step_key === 'build')!
    expect(build.status).toBe('succeeded')
    expect(build.attempt).toBe(1)

    expect(f.tables.production_packages).toHaveLength(1)
    expect(f.tables.action_runs[0].status).toBe('succeeded')
    // 一次成功执行 = 一个执行 owner（第一次的授权 + 恢复后的授权，只有恢复那次跑成）
    expect(
      f.tables.authorization_decisions.filter((d) => d.verdict === 'allow' && d.consumed_at),
    ).toHaveLength(2) // 第一次（跑到死信）+ 恢复后那次
  })

  it('🔴 恢复请求跟正常执行赛跑：旧请求不许覆盖新状态', async () => {
    const { f, builds, first } = await deadLetterFixture()

    // A 正常重跑并跑完
    const done = await resumeDeadLetterRun(f.kernel, first.run.id, 'ray@magiclab')
    expect(done.kind).toBe('succeeded')

    // B 拿着死信时的旧快照来重跑
    const staleSnapshot = { ...first.run }
    const kernelB = { ...f.kernel, requireRun: async () => staleSnapshot }

    await expect(
      resumeDeadLetterRun(kernelB, first.run.id, 'jayden@magiclab'),
    ).rejects.toThrow(/已经有人先恢复|正在跑|已经跑完/)

    expect(f.tables.action_runs[0].status).toBe('succeeded')
    expect(f.tables.production_packages).toHaveLength(1)
    expect(builds).toHaveBeenCalledTimes(1)
  })

  it('恢复留痕：谁、什么时候、为什么、哪种恢复', async () => {
    const { f, first } = await deadLetterFixture()
    const done = await resumeDeadLetterRun(f.kernel, first.run.id, 'ray@magiclab', '下游修好了')
    expect(done.kind).toBe('succeeded')

    const evidence = f.tables.action_runs[0].evidence as Record<string, unknown>
    expect(evidence.last_recovered_by).toBe('ray@magiclab')
    expect(evidence.recovery_reason).toBe('下游修好了')
    expect(evidence.recovery_kind).toBe('dead_letter')
    expect(evidence.last_recovered_at).toBeTruthy()
  })
})
