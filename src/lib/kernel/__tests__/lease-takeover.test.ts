/**
 * T1 —— 进程崩在中间态之后，这件事必须还能被接手。
 *
 * 要防的形状：run 已经落库成 queued / authorizing / authorized，但推进它的进程没了。
 * 幂等唯一键让相同请求再也插不进来，于是调用方**永远**只拿到 in_progress ——
 * 一个本来用来防重复执行的约束，把这件事**永久锁死**。
 *
 * 所以「已经有人在做了」这句话必须有实质：当前真的存在一个没过期的 owner。
 * 否则必须允许显式接管。
 *
 * 🔴 这里的「崩溃」是直接把库里的行摆成崩溃后的样子（谁持着租约、租约什么时候到期），
 *    而不是造一个卡住的 promise —— 崩溃后的**库状态**才是接管逻辑真正面对的东西。
 */

import { describe, it, expect, vi } from 'vitest'
import { runAction, submitActionRun, approveAndRun } from '../runner'
import { authorizeRun } from '../authorize'
import { claimOrTakeoverRun, claimRunRecovery } from '../store'
import { ACTION_REGISTRY } from '../registry'
import { createCapabilities, computeBlogContentHash } from '@/lib/capabilities'
import type { BlogDraftRow } from '@/lib/capabilities/seo/build-publish-package'
import { makeFixture, CLIENT_A, GOAL_A, POST_A, BLOG_DRAFT } from './fixtures'

const KEY = 'seo.build_publish_package'
const HASH = computeBlogContentHash(BLOG_DRAFT as unknown as BlogDraftRow)
const AUTO_POLICY = { action_key: KEY, mode: 'auto_approve', spend_cap_per_run_usd: 0 }
const LEASE = 60
const T0 = '2026-08-08T02:00:00.000Z'
const DEAD = 'crashed-process#1'

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

function countingCapabilities(counter: () => void) {
  return (sb: Parameters<typeof createCapabilities>[0]) => {
    const real = createCapabilities(sb)
    const impl = real[KEY]
    return {
      [KEY]: {
        ...impl,
        steps: {
          ...impl.steps,
          build: async (s: Parameters<(typeof impl.steps)['build']>[0]) => {
            counter()
            return impl.steps.build(s)
          },
        },
      },
    }
  }
}

function fixture(builds?: () => void) {
  return makeFixture({
    registry: ACTION_REGISTRY,
    capabilities: builds ? countingCapabilities(builds) : createCapabilities,
    options: { policy: AUTO_POLICY },
    startAt: T0,
    leaseSeconds: LEASE,
  })
}

type F = ReturnType<typeof fixture>
const runRow = (f: F) => f.tables.action_runs[0]
const allowDecisions = (f: F) =>
  f.tables.authorization_decisions.filter((d) => d.verdict === 'allow')

/** 把库摆成「某个进程在这个状态崩了」的样子。 */
function simulateCrash(f: F, status: string, leaseRemainingMs: number) {
  const row = runRow(f)
  row.status = status
  row.claimed_by = DEAD
  row.claimed_at = f.clock.now.toISOString()
  row.heartbeat_at = row.claimed_at
  row.lease_expires_at = new Date(f.clock.now.getTime() + leaseRemainingMs).toISOString()
}

/** 把时钟推到租约过期之后。 */
function advancePastLease(f: F) {
  f.clock.now = new Date(f.clock.now.getTime() + (LEASE + 1) * 1000)
}

describe('T1 · 崩在中间态之后能被接管', () => {
  it('A · queued 崩溃 → 租约到期后被接走，最终跑成，capability 只跑一次', async () => {
    const builds = vi.fn()
    const f = fixture(builds)
    await submitActionRun(f.kernel, submit())
    simulateCrash(f, 'queued', LEASE * 1000)

    advancePastLease(f)
    const taken = await runAction(f.kernel, submit())

    expect(taken.kind).toBe('succeeded')
    expect(builds).toHaveBeenCalledTimes(1)
    expect(f.tables.production_packages).toHaveLength(1)
    // 接管留痕：从谁手里接的、接过几次
    expect(runRow(f).previous_claimed_by).toBe(DEAD)
    expect(Number(runRow(f).reclaim_count)).toBe(1)
    expect(runRow(f).last_reclaimed_at).toBeTruthy()
  })

  it('B · authorizing 崩溃 → 只有一个接管者重新授权（不会签出两份）', async () => {
    const builds = vi.fn()
    const f = fixture(builds)
    await submitActionRun(f.kernel, submit())
    simulateCrash(f, 'authorizing', LEASE * 1000)
    advancePastLease(f)

    const results = await Promise.all([
      runAction(f.kernel, submit()),
      runAction(f.kernel, submit()),
    ])

    expect(results.map((r) => r.kind).sort()).toEqual(['in_progress', 'succeeded'])
    expect(builds).toHaveBeenCalledTimes(1)
    expect(allowDecisions(f)).toHaveLength(1)
  })

  it('C · authorized 崩溃 → 接管者**复用**那份 allow，绝不重新签', async () => {
    const builds = vi.fn()
    const f = fixture(builds)
    const { run } = await submitActionRun(f.kernel, submit())
    const auth = await authorizeRun(f.kernel, run)
    expect(auth.verdict).toBe('allow')
    expect(runRow(f).status).toBe('authorized')
    expect(runRow(f).authorization_decision_id).toBe(auth.decision.id)

    simulateCrash(f, 'authorized', LEASE * 1000)
    // 崩溃并不会把已经签好的授权抹掉
    runRow(f).authorization_decision_id = auth.decision.id
    advancePastLease(f)

    const taken = await runAction(f.kernel, submit())

    expect(taken.kind).toBe('succeeded')
    expect(builds).toHaveBeenCalledTimes(1)
    // 🔴 关键：整条 run 从头到尾**只有一份** allow —— 接管不等于重新授权
    expect(allowDecisions(f)).toHaveLength(1)
    expect(allowDecisions(f)[0].id).toBe(auth.decision.id)
    expect(taken.decision?.id).toBe(auth.decision.id)
    // 而且那份授权是被这次执行兑换掉的
    expect(allowDecisions(f)[0].consumed_at).toBeTruthy()
  })

  it('D · 租约还没过期 → 只能拿到 in_progress，偷不走', async () => {
    const builds = vi.fn()
    const f = fixture(builds)
    await submitActionRun(f.kernel, submit())
    simulateCrash(f, 'queued', LEASE * 1000)

    // 时钟没动，租约还活着
    const blocked = await runAction(f.kernel, submit())

    expect(blocked.kind).toBe('in_progress')
    expect(builds).not.toHaveBeenCalled()
    expect(allowDecisions(f)).toHaveLength(0)
    // owner 没被换掉
    expect(runRow(f).claimed_by).toBe(DEAD)
    expect(Number(runRow(f).reclaim_count)).toBe(0)
  })

  it('E · 租约过期后两个人同时接管 → 只有一个 owner，capability 只跑一次', async () => {
    const builds = vi.fn()
    const f = fixture(builds)
    await submitActionRun(f.kernel, submit())
    simulateCrash(f, 'queued', LEASE * 1000)
    advancePastLease(f)

    const results = await Promise.allSettled([
      runAction(f.kernel, submit()),
      runAction(f.kernel, submit()),
      runAction(f.kernel, submit()),
    ])
    const kinds = results
      .map((r) => (r.status === 'fulfilled' ? r.value.kind : `rejected:${String(r.reason)}`))
      .sort()

    expect(kinds.filter((k) => k === 'succeeded')).toHaveLength(1)
    expect(kinds.filter((k) => k === 'in_progress')).toHaveLength(2)
    expect(builds).toHaveBeenCalledTimes(1)
    expect(f.tables.production_packages).toHaveLength(1)
    expect(allowDecisions(f)).toHaveLength(1)
    // 只被接管过一次 —— 输的那两个连 owner 都没写上
    expect(Number(runRow(f).reclaim_count)).toBe(1)
  })

  it('F · 终态拿不走；running 只有租约过期才拿得走（租约还活着就是「真的有人在跑」）', async () => {
    const f = fixture()
    const done = await runAction(f.kernel, submit())
    expect(done.kind).toBe('succeeded')

    const late = await claimOrTakeoverRun(f.supabase, {
      runId: done.run.id,
      ownerId: 'late-comer#9',
      leaseSeconds: LEASE,
    })
    expect(late.ok).toBe(false)
    expect(late.reason).toBe('not_claimable:succeeded')
    expect(runRow(f).status).toBe('succeeded')

    // running + 租约还活着 → 抢不走
    simulateCrash(f, 'running', LEASE * 1000)
    const duringRun = await claimOrTakeoverRun(f.supabase, {
      runId: done.run.id,
      ownerId: 'late-comer#9',
      leaseSeconds: LEASE,
    })
    expect(duringRun.ok).toBe(false)
    expect(duringRun.reason).toBe(`already_owned:${DEAD}`)
    expect(runRow(f).status).toBe('running')

    // 🔴 但租约过期之后**必须**拿得走 —— 否则崩在执行中的 run 永远没人能接手，
    //    正是租约要修的那个「永久锁死」，只是换了个状态待着。
    advancePastLease(f)
    const afterExpiry = await claimOrTakeoverRun(f.supabase, {
      runId: done.run.id,
      ownerId: 'late-comer#9',
      leaseSeconds: LEASE,
    })
    expect(afterExpiry.ok).toBe(true)
    expect(afterExpiry.resetSteps).toBe(true)
    // 接管一个 running 的 run = 放回可重新授权的状态（授权已被上一代兑换掉）
    expect(afterExpiry.runStatus).toBe('queued')
    expect(runRow(f).authorization_decision_id).toBeNull()
  })

  it('G · 恢复提交之后崩溃 → 那条 queued 仍然能被接走（不是僵尸）', async () => {
    const builds = vi.fn()
    const f = fixture(builds)
    const first = await runAction(f.kernel, submit())
    expect(first.kind).toBe('succeeded')

    // 造一条死信：把它摆成死信状态，模拟「跑到一半停手待查」
    const row = runRow(f)
    row.status = 'dead_letter'
    row.needs_human = true
    for (const s of f.tables.action_run_steps) {
      if (s.step_key === 'verify') s.status = 'dead_letter'
    }

    // 🔴 只领恢复权，不接着授权 —— 这就是「事务提交了，然后进程没了」
    const claimed = await claimRunRecovery(f.supabase, {
      runId: first.run.id,
      expectedDecisionId: (row.authorization_decision_id ?? null) as string | null,
      kind: 'dead_letter',
      actor: 'ray@magiclab',
      reason: '人工重跑',
    })
    expect(claimed.ok).toBe(true)
    expect(runRow(f).status).toBe('queued')
    // 恢复把租约清干净了 —— 否则这条 run 会带着一个死 owner 再也没人接得走
    expect(runRow(f).claimed_by).toBeNull()
    expect(runRow(f).lease_expires_at).toBeNull()

    // 时钟一动不动也能接走（无主 ≠ 要等租约过期）
    const taken = await runAction(f.kernel, submit())
    expect(taken.kind).toBe('succeeded')
    expect(runRow(f).claimed_by).not.toBe(null)
  })
})

describe('T1 · 接管 RPC 每一道闸单独可咬', () => {
  async function preparedRun() {
    const f = fixture()
    const { run } = await submitActionRun(f.kernel, submit())
    return { f, runId: run.id }
  }

  it('🔴 状态闸：终态和等审批一律领不到（各自单独可测）', async () => {
    const { f, runId } = await preparedRun()
    for (const status of ['succeeded', 'denied', 'dead_letter', 'pending_approval', 'superseded']) {
      runRow(f).status = status
      const r = await claimOrTakeoverRun(f.supabase, { runId, ownerId: 'x#1', leaseSeconds: LEASE })
      expect(r.ok, `${status} 不该能被领走`).toBe(false)
      expect(r.reason).toBe(`not_claimable:${status}`)
    }
  })

  it('🔴 状态闸：四个可接管状态都领得到（含 running）', async () => {
    const { f, runId } = await preparedRun()
    for (const status of ['queued', 'authorizing', 'authorized', 'running']) {
      runRow(f).claimed_by = null
      runRow(f).lease_expires_at = null
      runRow(f).status = status
      const r = await claimOrTakeoverRun(f.supabase, { runId, ownerId: 'x#1', leaseSeconds: LEASE })
      expect(r.ok, `${status} 该领得到`).toBe(true)
      // 接管一个 running 的 run 会把它放回 queued（授权已被上一代兑换掉，得重新签）
      expect(r.runStatus).toBe(status === 'running' ? 'queued' : status)
      expect(r.resetSteps).toBe(status === 'running')
    }
  })

  it('🔴 租约闸：活着的租约挡住别人（只有这一道能拦，状态是合法的）', async () => {
    const { f, runId } = await preparedRun()
    const mine = await claimOrTakeoverRun(f.supabase, { runId, ownerId: 'a#1', leaseSeconds: LEASE })
    expect(mine.ok).toBe(true)

    const theirs = await claimOrTakeoverRun(f.supabase, { runId, ownerId: 'b#1', leaseSeconds: LEASE })
    expect(theirs.ok).toBe(false)
    expect(theirs.reason).toBe('already_owned:a#1')
    expect(runRow(f).claimed_by).toBe('a#1')
  })

  it('租约到期之后同一个请求就能接走 —— 判据是时间，不是别的', async () => {
    const { f, runId } = await preparedRun()
    await claimOrTakeoverRun(f.supabase, { runId, ownerId: 'a#1', leaseSeconds: LEASE })
    advancePastLease(f)

    const theirs = await claimOrTakeoverRun(f.supabase, { runId, ownerId: 'b#1', leaseSeconds: LEASE })
    expect(theirs.ok).toBe(true)
    expect(theirs.reason).toBe('taken_over')
    expect(theirs.reclaimed).toBe(true)
    expect(theirs.reclaimCount).toBe(1)
    expect(runRow(f).previous_claimed_by).toBe('a#1')
  })

  it('同一个 owner 再来一次 = 续租，不算接管', async () => {
    const { f, runId } = await preparedRun()
    await claimOrTakeoverRun(f.supabase, { runId, ownerId: 'a#1', leaseSeconds: LEASE })
    const again = await claimOrTakeoverRun(f.supabase, { runId, ownerId: 'a#1', leaseSeconds: LEASE })

    expect(again.ok).toBe(true)
    expect(again.reason).toBe('claimed')
    expect(again.reclaimed).toBe(false)
    expect(Number(runRow(f).reclaim_count)).toBe(0)
    expect(runRow(f).previous_claimed_by).toBeNull()
  })

  it('参数不合法一律领不到（不许当成「领到了」）', async () => {
    const { f, runId } = await preparedRun()
    expect((await claimOrTakeoverRun(f.supabase, { runId, ownerId: '  ', leaseSeconds: LEASE })).reason)
      .toBe('owner_required')
    expect((await claimOrTakeoverRun(f.supabase, { runId, ownerId: 'a#1', leaseSeconds: 0 })).reason)
      .toBe('lease_seconds_required')
    expect((await claimOrTakeoverRun(f.supabase, { runId: 'no-such-run', ownerId: 'a#1', leaseSeconds: LEASE })).reason)
      .toBe('run_not_found')
    // 一条都没写进去
    expect(runRow(f).claimed_by).toBeNull()
  })

  it('🔴 领到时回报的是**领到那一刻**的状态和决策指针（接下来怎么走全靠它）', async () => {
    const { f, runId } = await preparedRun()
    runRow(f).status = 'authorized'
    runRow(f).authorization_decision_id = 'decision-xyz'

    const r = await claimOrTakeoverRun(f.supabase, { runId, ownerId: 'a#1', leaseSeconds: LEASE })
    expect(r.ok).toBe(true)
    expect(r.runStatus).toBe('authorized')
    expect(r.decisionId).toBe('decision-xyz')
  })
})

describe('T1 · 「已经有人在做了」只在两种情况下出现', () => {
  it('挂起等审批时租约被清空 —— 人来点头时不会被僵尸租约挡住', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: { ...AUTO_POLICY, mode: 'require_approval' } },
      startAt: T0,
      leaseSeconds: LEASE,
    })
    const out = await runAction(f.kernel, submit())
    expect(out.kind).toBe('pending_approval')
    // 等人点头 = 交接给人，没有任何进程在推进它
    expect(runRow(f as unknown as F).claimed_by).toBeNull()
    expect(runRow(f as unknown as F).lease_expires_at).toBeNull()
  })

  it('🔴 挂起期间残留一份活着的僵尸租约 → 批准之后照样推得动（交接会清掉它）', async () => {
    // 为什么要单独造这个场景：`authorizeRun` 挂起时已经清过一次租约，
    // 所以「批准 RPC 也清一次」在正常流程里是**被遮蔽的**（拆掉它没有任何测试会红）。
    // 两道防御互为影子时，必须给后面那道单独造出「只有它能救场」的库状态。
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: { ...AUTO_POLICY, mode: 'require_approval' } },
      startAt: T0,
      leaseSeconds: LEASE,
    }) as unknown as F
    const pending = await runAction(f.kernel, submit())
    expect(pending.kind).toBe('pending_approval')

    // 人为塞回一份还没到期的租约，owner 早已不存在
    const row = runRow(f)
    row.claimed_by = DEAD
    row.claimed_at = f.clock.now.toISOString()
    row.lease_expires_at = new Date(f.clock.now.getTime() + LEASE * 1000).toISOString()

    const approved = await approveAndRun(f.kernel, pending.run.id, 'ray@magiclab')

    // 不清租约的话，这里会被挡成 in_progress —— 人点了同意却什么都没发生
    expect(approved.kind).toBe('succeeded')
    expect(f.tables.production_packages).toHaveLength(1)
  })

  it('🔴 running + 租约还活着 → in_progress（真的有人在跑）', async () => {
    const builds = vi.fn()
    const f = fixture(builds)
    await submitActionRun(f.kernel, submit())
    simulateCrash(f, 'running', LEASE * 1000)

    const out = await runAction(f.kernel, submit())

    expect(out.kind).toBe('in_progress')
    expect(builds).not.toHaveBeenCalled()
    expect(runRow(f).claimed_by).toBe(DEAD) // owner 没被换掉
  })

  it('🔴 running + 租约已过期 → **必须**能被接走并跑完（否则崩在执行中就永久卡死）', async () => {
    // 这条是 P1-1：SQL 早就允许接管过期的 running，但 runAction 以前
    // 在进 takeover 判断之前就把 running 直接答成 in_progress ——
    // 接管入口形同虚设，run 永远卡在 running。
    const builds = vi.fn()
    const f = fixture(builds)
    await submitActionRun(f.kernel, submit())
    simulateCrash(f, 'running', LEASE * 1000)
    advancePastLease(f)

    const out = await runAction(f.kernel, submit())

    expect(out.kind).toBe('succeeded')
    expect(builds).toHaveBeenCalledTimes(1)
    expect(f.tables.production_packages).toHaveLength(1)
    expect(runRow(f).previous_claimed_by).toBe(DEAD)
  })

  it('🔴 running 过期后两个并发接管 → 只有一代赢，capability 只跑一次', async () => {
    const builds = vi.fn()
    const f = fixture(builds)
    await submitActionRun(f.kernel, submit())
    simulateCrash(f, 'running', LEASE * 1000)
    advancePastLease(f)
    const genBefore = Number(runRow(f).claim_generation)

    const results = await Promise.allSettled([
      runAction(f.kernel, submit()),
      runAction(f.kernel, submit()),
    ])
    const kinds = results.map((r) => (r.status === 'fulfilled' ? r.value.kind : 'rejected'))

    expect(kinds.filter((k) => k === 'succeeded')).toHaveLength(1)
    expect(kinds.filter((k) => k === 'in_progress')).toHaveLength(1)
    expect(builds).toHaveBeenCalledTimes(1)
    expect(Number(runRow(f).claim_generation)).toBe(genBefore + 1)
  })
})
