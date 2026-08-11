/**
 * P1 + P2-1 —— 人工批准 / 拒绝的原子性。
 *
 * 要防的形状：两个人（或一次双击）同时读到 pending_approval →
 * 各签一份 human allow → A 开跑把 run 推进 running → B 的无条件 update
 * 把它拽回 authorized 换上自己那份决策 → B 再领一次执行权 → **capability 执行两次**。
 *
 * 现在批准和拒绝都走 `kernel_resolve_pending_approval`：抢同一把 run 行锁，
 * 谁先锁到谁说了算，输家拿到机器可读原因，**绝不覆盖赢家写下的状态**。
 * 全部用 Promise.allSettled 真并发，不是顺序调用。
 */

import { describe, it, expect, vi } from 'vitest'
import { runAction, approveAndRun, rejectPendingRun } from '../runner'
import { ACTION_REGISTRY } from '../registry'
import { createCapabilities, computeBlogContentHash } from '@/lib/capabilities'
import type { BlogDraftRow } from '@/lib/capabilities/seo/build-publish-package'
import { makeFixture, CLIENT_A, GOAL_A, POST_A, BLOG_DRAFT } from './fixtures'

const KEY = 'seo.build_publish_package'
const HASH = computeBlogContentHash(BLOG_DRAFT as unknown as BlogDraftRow)
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

async function pendingFixture() {
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
    options: { policy: APPROVAL_POLICY },
  })
  const pending = await runAction(f.kernel, submit())
  expect(pending.kind).toBe('pending_approval')
  return { f, pending, builds }
}

describe('P1 · 两个人同时批准', () => {
  it('🔴 只有一个赢家：capability 1 次、包 1 个、human allow 1 条、run 不被拽回', async () => {
    const { f, pending, builds } = await pendingFixture()

    const settled = await Promise.allSettled([
      approveAndRun(f.kernel, pending.run.id, 'ray@magiclab'),
      approveAndRun(f.kernel, pending.run.id, 'jayden@magiclab'),
    ])

    // 一个成功、一个被明确拒掉（不是静默、不是双赢）
    const fulfilled = settled.filter((s) => s.status === 'fulfilled')
    const rejected = settled.filter((s) => s.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    const winner = (fulfilled[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof approveAndRun>>>).value
    expect(winner.kind).toBe('succeeded')
    // 输家拿到的是「已被处理 / 状态变了」，机器可读原因带在信息里
    expect(String((rejected[0] as PromiseRejectedResult).reason)).toMatch(
      /已经被别人处理了|not_pending|decision_not_current|不是在等人点头/,
    )

    // 🔴 核心不变量
    expect(builds).toHaveBeenCalledTimes(1)
    expect(f.tables.production_packages).toHaveLength(1)
    const humanAllows = f.tables.authorization_decisions.filter(
      (d) => d.verdict === 'allow' && d.decided_by === 'human',
    )
    expect(humanAllows).toHaveLength(1)
    // run 停在 succeeded —— 没有被输家拽回 authorized / denied
    expect(f.tables.action_runs[0].status).toBe('succeeded')
    expect(f.tables.action_runs[0].authorization_decision_id).toBe(humanAllows[0].id)
  })

  it('双击（同一个人两次批准）→ 同样只执行一次', async () => {
    const { f, pending, builds } = await pendingFixture()

    const settled = await Promise.allSettled([
      approveAndRun(f.kernel, pending.run.id, 'ray@magiclab'),
      approveAndRun(f.kernel, pending.run.id, 'ray@magiclab'),
    ])

    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1)
    expect(builds).toHaveBeenCalledTimes(1)
    expect(f.tables.production_packages).toHaveLength(1)
  })
})

describe('P1 · 迟到批准人的失败落地守卫', () => {
  it('🔴 A 已跑完、政策又被删，拿着旧快照的 B 批不了 → 失败落地不许把 succeeded 拽回 denied', async () => {
    // 这条盯的是 recordDeny 的状态守卫，跟 RPC 的两道 CAS **可区分**：
    // B 的批准流程在 preflight（政策没了）就失败了，根本走不到 RPC ——
    // 没有守卫的话，B 的「批不了」落地会无条件把 run 写成 denied，
    // 覆盖掉 A 赢来的 succeeded。用「旧快照」把这场赛跑做成确定性的。
    const { f, pending, builds } = await pendingFixture()

    // A 正常批准并跑完
    const done = await approveAndRun(f.kernel, pending.run.id, 'ray@magiclab')
    expect(done.kind).toBe('succeeded')

    // 之后政策被删了
    f.tables.client_automation_policies.length = 0

    // B 拿着**赛跑开始前的旧快照**来批（等价于并发里 B 先读到 pending 的那一刻）
    const staleSnapshot = { ...pending.run } // status: 'pending_approval'，指针还是旧 pending
    const kernelB = {
      ...f.kernel,
      requireRun: async (id: string) => {
        expect(id).toBe(pending.run.id)
        return staleSnapshot
      },
    }

    await expect(
      approveAndRun(kernelB, pending.run.id, 'jayden@magiclab'),
    ).rejects.toThrow(/已经被别人处理了/)

    // 🔴 赢家的状态一个字都没被动
    expect(f.tables.action_runs[0].status).toBe('succeeded')
    expect(f.tables.production_packages).toHaveLength(1)
    expect(builds).toHaveBeenCalledTimes(1)
    // B 留下的那条 deny 是 append-only 的尝试记录，但 run 的指针没有指向它
    const lastDeny = f.tables.authorization_decisions.filter((d) => d.verdict === 'deny').at(-1)
    if (lastDeny) {
      expect(f.tables.action_runs[0].authorization_decision_id).not.toBe(lastDeny.id)
    }
  })
})

describe('P2-1 · 批准 vs 拒绝赛跑', () => {
  it('🔴 只能一个赢；输家不覆盖赢家的状态', async () => {
    const { f, pending, builds } = await pendingFixture()

    const settled = await Promise.allSettled([
      approveAndRun(f.kernel, pending.run.id, 'ray@magiclab'),
      rejectPendingRun(f.kernel, pending.run.id, 'jayden@magiclab', '先不做'),
    ])

    const fulfilled = settled.filter((s) => s.status === 'fulfilled')
    const rejected = settled.filter((s) => s.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)

    const finalStatus = String(f.tables.action_runs[0].status)
    if (finalStatus === 'succeeded') {
      // 批准赢了：包做出来了，拒绝没生效
      expect(builds).toHaveBeenCalledTimes(1)
      expect(f.tables.production_packages).toHaveLength(1)
      expect(
        f.tables.authorization_decisions.filter((d) => d.verdict === 'deny'),
      ).toHaveLength(0)
    } else {
      // 拒绝赢了：一步都没跑
      expect(finalStatus).toBe('denied')
      expect(builds).not.toHaveBeenCalled()
      expect(f.tables.production_packages).toHaveLength(0)
      expect(
        f.tables.authorization_decisions.filter((d) => d.verdict === 'allow' && d.decided_by === 'human'),
      ).toHaveLength(0)
    }
  })

  it('两次拒绝 → 第一次生效，第二次被明确拒掉，理由是第一次那条', async () => {
    const { f, pending } = await pendingFixture()

    const first = await rejectPendingRun(f.kernel, pending.run.id, 'ray@magiclab', '这周不做')
    expect(first.kind).toBe('denied')

    await expect(
      rejectPendingRun(f.kernel, pending.run.id, 'jayden@magiclab', '我也不做'),
    ).rejects.toThrow(/不是在等审批/)

    expect(f.tables.action_runs[0].status).toBe('denied')
    expect(String(f.tables.action_runs[0].last_error)).toContain('这周不做')
    // 只有一条 human deny
    expect(
      f.tables.authorization_decisions.filter((d) => d.verdict === 'deny' && d.decided_by === 'human'),
    ).toHaveLength(1)
  })

  it('🔴 已经 succeeded 之后迟到的拒绝 → 不生效，状态不被覆盖', async () => {
    const { f, pending, builds } = await pendingFixture()
    const done = await approveAndRun(f.kernel, pending.run.id, 'ray@magiclab')
    expect(done.kind).toBe('succeeded')

    await expect(
      rejectPendingRun(f.kernel, pending.run.id, 'jayden@magiclab', '等等我反对'),
    ).rejects.toThrow(/不是在等审批.*已经被批准/)

    expect(f.tables.action_runs[0].status).toBe('succeeded')
    expect(f.tables.production_packages).toHaveLength(1)
    expect(builds).toHaveBeenCalledTimes(1)
  })

  it('🔴 running 状态下迟到的拒绝 → 不生效（用卡住的 capability 造出真 running 窗口）', async () => {
    // capability 挂起不返回 → run 停在 running —— 这时拒绝必须被拒
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
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
                await gate
                return impl.steps.build(s)
              },
            },
          },
        }
      },
      options: { policy: APPROVAL_POLICY },
    })
    const pending = await runAction(f.kernel, submit())
    const approvePromise = approveAndRun(f.kernel, pending.run.id, 'ray@magiclab')
    // 等 run 真的进入 running（capability 卡在 gate 上）
    await vi.waitFor(() => {
      expect(f.tables.action_runs[0].status).toBe('running')
    })

    await expect(
      rejectPendingRun(f.kernel, pending.run.id, 'jayden@magiclab', '停下'),
    ).rejects.toThrow(/不是在等审批/)
    expect(f.tables.action_runs[0].status).toBe('running')

    release()
    const done = await approvePromise
    expect(done.kind).toBe('succeeded')
    expect(f.tables.action_runs[0].status).toBe('succeeded')
  })
})
