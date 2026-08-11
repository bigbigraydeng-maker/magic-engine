/**
 * 第八轮 —— fencing 上剩下的三个洞 + 两条「结果要说真话」。
 *
 * F2（P1-2）：`recordDeny` 没有围栏 —— A 卡在授权前置校验里，租约过期，
 *   B 接管并跑完，A 醒来把 succeeded 改成 denied，**当场毁掉一次成功的执行**。
 *
 * F3（P1-3）：建步骤没有围栏 —— A 卡在建步骤之前，B 接管（代际 +1），
 *   A 醒来仍能插一批**带旧代际**的步骤行，然后拿着自己造的行继续调 handler。
 *   步骤写入的守卫只看 step 自己那一列，整套 fencing 被绕过。
 *
 * P2-1：政策在 TTL 内变了还复用旧授权 —— Gateway 会抛错，但 run 卡在
 *   authorized、租约也没清，于是反复报同一个错**一直到 TTL 自己到期**。
 *
 * P2-2：`approveAndRun` 领不到租约就一律答 in_progress —— 事情其实已经
 *   跑完 / 死信了，点了同意的人拿不到产物也拿不到失败原因。
 */

import { describe, it, expect, vi } from 'vitest'
import { runAction, submitActionRun, approveAndRun } from '../runner'
import { authorizeRun } from '../authorize'
import { claimOrTakeoverRun, ensureSteps, listSteps, recordFencedDeny } from '../store'
import { ACTION_REGISTRY } from '../registry'
import { createCapabilities, computeBlogContentHash } from '@/lib/capabilities'
import type { BlogDraftRow } from '@/lib/capabilities/seo/build-publish-package'
import { makeFixture, CLIENT_A, GOAL_A, POST_A, BLOG_DRAFT } from './fixtures'

const KEY = 'seo.build_publish_package'
const HASH = computeBlogContentHash(BLOG_DRAFT as unknown as BlogDraftRow)
const AUTO_POLICY = { action_key: KEY, mode: 'auto_approve', spend_cap_per_run_usd: 0 }
const LEASE = 60
const T0 = '2026-08-08T02:00:00.000Z'

const submit = () => ({
  clientId: CLIENT_A,
  actionKey: KEY,
  purpose: 'growth' as const,
  goalId: GOAL_A,
  triggeredBy: 'schedule' as const,
  input: { blog_post_id: POST_A, content_hash: HASH },
})

function fixture(mode: 'auto_approve' | 'require_approval' = 'auto_approve') {
  return makeFixture({
    registry: ACTION_REGISTRY,
    capabilities: createCapabilities,
    options: { policy: { ...AUTO_POLICY, mode } },
    startAt: T0,
    leaseSeconds: LEASE,
  })
}
type F = ReturnType<typeof fixture>
const runRow = (f: F) => f.tables.action_runs[0]
const advancePastLease = (f: F) => {
  f.clock.now = new Date(f.clock.now.getTime() + (LEASE + 1) * 1000)
}

describe('F2 · 落拒绝也要过围栏（P1-2）', () => {
  it('🔴 A 卡在授权校验里，B 接管并跑完 → A 醒来落不了 deny，run 保持 succeeded', async () => {
    const f = fixture()
    const { run } = await submitActionRun(f.kernel, submit())
    const claimA = await claimOrTakeoverRun(f.supabase, {
      runId: run.id,
      ownerId: 'worker-A#1',
      leaseSeconds: LEASE,
    })

    // B 接管并把整件事跑完
    advancePastLease(f)
    const done = await runAction(f.kernel, submit())
    expect(done.kind).toBe('succeeded')
    expect(runRow(f).status).toBe('succeeded')

    // A 醒过来，拿着自己那一代去落拒绝
    const late = await recordFencedDeny(f.supabase, {
      runId: run.id,
      expectedGeneration: claimA.claimGeneration,
      reason: 'A 以为这条不能做',
      decision: {
        client_id: CLIENT_A,
        action_key: KEY,
        action_version: 1,
        deny_code: 'no_policy',
        idempotency_key: run.idempotency_key,
      },
    })

    expect(late.ok).toBe(false)
    expect(late.reason).toMatch(/^stale_generation/)
    // 🔴 run 保持成功 —— 一次已经做成的事不会被过期的执行者写成「被拒」
    expect(runRow(f).status).toBe('succeeded')
    expect(f.tables.production_packages).toHaveLength(1)
  })

  /**
   * 🔴 **唯一能单独测出 recordDeny 那道围栏的时序。**
   *
   * 前两种写法都测不到它，因为会被更早的闸抢先挡住：
   *   · 「一开始代际就对不上」→ `authorizeRun` 写 `authorizing` 那一步先抛；
   *   · 「直接调 recordFencedDeny」→ 测的是 RPC 自己，不是调用点有没有把围栏传下去。
   *
   * 真实时序必须是：
   *   ① A **成功**把 run 写成 `authorizing`（此刻代际还对得上）；
   *   ② A 进 preflight，卡在一个可控 barrier 上；
   *   ③ 这之后租约才过期；④ B 接管（代际 +1）并继续推进；
   *   ⑤ 放开 barrier；⑥ A 的 preflight 判成 deny；⑦ A 进 recordDeny。
   * 到第 ⑦ 步，**唯一还能拦住 A 的就是 recordDeny 的代际围栏**。
   */
  function barrierFixture() {
    const gate: { release: () => void; promise: Promise<void> } = {
      release: () => {},
      promise: Promise.resolve(),
    }
    gate.promise = new Promise<void>((r) => { gate.release = r })
    let tripped = false
    const builds = vi.fn()

    const f: F = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: (sb) => {
        const real = createCapabilities(sb)
        const impl = real[KEY]
        return {
          [KEY]: {
            ...impl,
            steps: {
              ...impl.steps,
              build: async (st: Parameters<(typeof impl.steps)['build']>[0]) => {
                builds()
                return impl.steps.build(st)
              },
            },
          },
        }
      },
      options: {
        policy: AUTO_POLICY,
        supabaseOptions: {
          // A 第一次读政策时挂住 —— 那时 `authorizing` 已经写成功了
          beforeOp: (table, op) => {
            if (tripped || table !== 'client_automation_policies' || op !== 'select') return
            if (f.tables.action_runs[0]?.status !== 'authorizing') return
            tripped = true
            return gate.promise
          },
        },
      },
      startAt: T0,
      leaseSeconds: LEASE,
    })
    return { f, gate, builds, isTripped: () => tripped }
  }

  it('🔴 A 跨过 authorizing 写入后才被接管 → 只有 recordDeny 那道围栏能拦住它（B 已 succeeded）', async () => {
    const { f, gate, builds, isTripped } = barrierFixture()
    const { run } = await submitActionRun(f.kernel, submit())
    const claimA = await claimOrTakeoverRun(f.supabase, {
      runId: run.id, ownerId: 'worker-A#1', leaseSeconds: LEASE,
    })

    // ① + ② A 开始授权，卡在 preflight 读政策那一刻
    const aPromise = authorizeRun(f.kernel, await f.kernel.requireRun(run.id), {
      generation: claimA.claimGeneration,
    }).then(() => null, (e: Error) => e)
    await new Promise((r) => setTimeout(r, 0))
    expect(isTripped()).toBe(true)
    // 🔴 关键前提：authorizing 那一次写**已经成功了**，所以前面那道围栏不会再响
    expect(runRow(f).status).toBe('authorizing')

    // ③ 现在租约才过期；④ B 接管并把整件事跑完
    advancePastLease(f)
    const b = await runAction(f.kernel, submit())
    expect(b.kind).toBe('succeeded')
    expect(Number(runRow(f).claim_generation)).toBe(claimA.claimGeneration + 1)

    // ⑥ 让 A 的 preflight 判成 deny（政策没了）；⑤ 放开 barrier
    f.tables.client_automation_policies.length = 0
    gate.release()
    const aError = await aPromise

    // ⑦ 只剩 recordDeny 那道围栏能拦
    expect(aError).toBeInstanceOf(Error)
    expect((aError as Error).message).toMatch(/接管/)
    // A 没能覆盖 B：状态还是成功，也没多出一条 deny
    expect(runRow(f).status).toBe('succeeded')
    expect(f.tables.authorization_decisions.filter((d) => d.verdict === 'deny')).toHaveLength(0)
    // capability 没被 A 的晚到影响
    expect(builds).toHaveBeenCalledTimes(1)
    expect(f.tables.production_packages).toHaveLength(1)
  })

  it('🔴 同一时序，但 B 还在 running → A 的晚到 deny 同样进不来，run 仍是 running', async () => {
    const { f, gate, isTripped } = barrierFixture()
    const { run } = await submitActionRun(f.kernel, submit())
    const claimA = await claimOrTakeoverRun(f.supabase, {
      runId: run.id, ownerId: 'worker-A#1', leaseSeconds: LEASE,
    })

    const aPromise = authorizeRun(f.kernel, await f.kernel.requireRun(run.id), {
      generation: claimA.claimGeneration,
    }).then(() => null, (e: Error) => e)
    await new Promise((r) => setTimeout(r, 0))
    expect(isTripped()).toBe(true)
    expect(runRow(f).status).toBe('authorizing')

    // B 接管；它正在跑（持着活租约）
    advancePastLease(f)
    const claimB = await claimOrTakeoverRun(f.supabase, {
      runId: run.id, ownerId: 'worker-B#1', leaseSeconds: LEASE,
    })
    expect(claimB.claimGeneration).toBe(claimA.claimGeneration + 1)
    runRow(f).status = 'running'

    f.tables.client_automation_policies.length = 0
    gate.release()
    const aError = await aPromise

    expect(aError).toBeInstanceOf(Error)
    expect((aError as Error).message).toMatch(/接管/)
    expect(runRow(f).status).toBe('running') // B 的执行没被打断
    expect(f.tables.authorization_decisions.filter((d) => d.verdict === 'deny')).toHaveLength(0)
  })

  it('🔴 代际对不上时，连那条 deny 决策都不许留下（不是先插后发现 stale）', async () => {
    const f = fixture()
    const { run } = await submitActionRun(f.kernel, submit())
    const before = f.tables.authorization_decisions.length

    const late = await recordFencedDeny(f.supabase, {
      runId: run.id,
      expectedGeneration: 999, // 一个不可能对得上的代际
      reason: '过期的执行者来落拒绝',
      decision: {
        client_id: CLIENT_A,
        action_key: KEY,
        action_version: 1,
        deny_code: 'no_policy',
        idempotency_key: run.idempotency_key,
      },
    })

    expect(late.ok).toBe(false)
    // 🔴 没有孤立的 deny 决策：run 状态没变，审计表也没多一条说不清归属的记录
    expect(f.tables.authorization_decisions).toHaveLength(before)
    expect(runRow(f).status).toBe('queued')
  })

  it('代际对得上时照常落拒绝（围栏不误伤正常路径）', async () => {
    // ⚠️ 这条**不是**在测「没有围栏的调用方」——`runAction` 永远会传 fence，
    //    `p_expected_generation IS NULL` 那条分支端到端走不到。它测的是不误伤。
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: {}, // 没有政策 → 一定 deny
      startAt: T0,
    })
    const out = await runAction(f.kernel, submit())
    expect(out.kind).toBe('denied')
    expect(f.tables.authorization_decisions[0].deny_code).toBe('no_policy')
    expect(runRow(f as unknown as F).status).toBe('denied')
  })

  it('🔴 落拒绝也要挡跨客户（决策必须属于这条 run 的客户）', async () => {
    // ensureSteps 那个 RPC 有这道闸，落拒绝那个以前没有 —— 同一类漏洞要一起堵，
    // 否则一条串台的拒绝决策会静静写进审计表。
    const f = fixture()
    const { run } = await submitActionRun(f.kernel, submit())
    const before = f.tables.authorization_decisions.length

    const wrong = await recordFencedDeny(f.supabase, {
      runId: run.id,
      reason: '拿别的客户的身份来落拒绝',
      decision: {
        client_id: '99999999-9999-9999-9999-999999999999', // 不是这条 run 的客户
        action_key: KEY,
        action_version: 1,
        deny_code: 'no_policy',
        idempotency_key: run.idempotency_key,
      },
    })

    expect(wrong.ok).toBe(false)
    expect(wrong.reason).toBe('cross_client')
    expect(f.tables.authorization_decisions).toHaveLength(before)
    expect(runRow(f).status).toBe('queued')
  })
})

describe('F3 · 建步骤也要过围栏（P1-3）', () => {
  it('🔴 A 卡在建步骤之前，B 接管 → A 再建步骤拿到 null（不是插一批旧代际的行）', async () => {
    const f = fixture()
    const { run } = await submitActionRun(f.kernel, submit())
    const claimA = await claimOrTakeoverRun(f.supabase, {
      runId: run.id,
      ownerId: 'worker-A#1',
      leaseSeconds: LEASE,
    })

    advancePastLease(f)
    const claimB = await claimOrTakeoverRun(f.supabase, {
      runId: run.id,
      ownerId: 'worker-B#1',
      leaseSeconds: LEASE,
    })
    expect(claimB.claimGeneration).toBe(claimA.claimGeneration + 1)

    // A 醒过来建步骤
    const stepsForA = await ensureSteps(
      f.supabase, run.id, CLIENT_A, ['build', 'persist', 'verify'], claimA.claimGeneration,
    )

    expect(stepsForA).toBeNull() // 🔴 被 fence 掉了
    expect(await listSteps(f.supabase, run.id)).toHaveLength(0) // 一行都没插进去
  })

  it('🔴 领到执行权**之后**、建步骤**之前**被接管 → 挡住它的必须是 ensureSteps 那道闸', async () => {
    // 🔴 之前这条用例是「A 拿到授权 → B 接管 → A 继续执行」，测不到 ensureSteps ——
    //    B 接管的是一条 authorized 的 run，代际 +1 之后 A 在 `beginAuthorizedRun`
    //    的代际闸就被挡死了，根本走不到建步骤。两处抛的错误码和人话还完全一样
    //    （都是 STALE_CLAIM /接管/），所以断言分不开。实测：拆掉 gateway 里
    //    `if (!steps) throw` 那三行，老用例照样全绿。
    //
    //    真实窗口是「已经领到执行权、还没建步骤」。用 beforeRpc 精确卡在那一刻，
    //    并且断言 detail.at === 'ensureSteps' —— 只有这样才分得清是哪道闸。
    const builds = vi.fn()
    let hijacked = false
    const f: F = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: (sb) => {
        const real = createCapabilities(sb)
        const impl = real[KEY]
        return {
          [KEY]: {
            ...impl,
            steps: {
              ...impl.steps,
              build: async (st: Parameters<(typeof impl.steps)['build']>[0]) => {
                builds()
                return impl.steps.build(st)
              },
            },
          },
        }
      },
      options: {
        policy: AUTO_POLICY,
        supabaseOptions: {
          beforeRpc: (name) => {
            // 执行权已经领到了（run 现在是 running）；就在要建步骤的这一刻被接管
            if (name !== 'kernel_ensure_run_steps' || hijacked) return
            hijacked = true
            const row = f.tables.action_runs[0]
            row.claim_generation = Number(row.claim_generation ?? 0) + 1
            row.claimed_by = 'worker-B#1'
          },
        },
      },
      startAt: T0,
      leaseSeconds: LEASE,
    })

    const { run } = await submitActionRun(f.kernel, submit())
    const claimA = await claimOrTakeoverRun(f.supabase, {
      runId: run.id, ownerId: 'worker-A#1', leaseSeconds: LEASE,
    })
    const auth = await authorizeRun(f.kernel, await f.kernel.requireRun(run.id), {
      generation: claimA.claimGeneration,
    })
    expect(auth.verdict).toBe('allow')

    const { executeAuthorizedRun } = await import('../gateway')
    const err = await executeAuthorizedRun(f.kernel, auth.ctx!, {
      ownerId: 'worker-A#1',
      generation: claimA.claimGeneration,
    }).then(() => null, (e: Error) => e)

    expect(hijacked).toBe(true)
    expect(err).toBeInstanceOf(Error)
    // 🔴 关键：确认是**建步骤**那道闸拦的，不是领执行权那道
    const detail = (err as unknown as { detail?: Record<string, unknown> }).detail ?? {}
    expect(detail.at).toBe('ensureSteps')
    // 一行步骤都没建成，handler 一次都没被调
    expect(await listSteps(f.supabase, run.id)).toHaveLength(0)
    expect(builds).not.toHaveBeenCalled()
  })

  it('当前那一代建步骤照常成功，且步骤带的是当前代际', async () => {
    const f = fixture()
    const { run } = await submitActionRun(f.kernel, submit())
    const claim = await claimOrTakeoverRun(f.supabase, {
      runId: run.id, ownerId: 'worker-A#1', leaseSeconds: LEASE,
    })

    const steps = await ensureSteps(
      f.supabase, run.id, CLIENT_A, ['build', 'persist', 'verify'], claim.claimGeneration,
    )

    expect(steps).toHaveLength(3)
    expect(steps!.every((s) => s.claim_generation === claim.claimGeneration)).toBe(true)
  })
})

describe('P2-1 · 政策变了就不复用旧授权（不等 TTL 到期）', () => {
  /** 让 run 停在 authorized（签好授权、还没开跑），然后把租约放掉。 */
  async function authorizedThenAbandoned(f: F) {
    const { run } = await submitActionRun(f.kernel, submit())
    const claim = await claimOrTakeoverRun(f.supabase, {
      runId: run.id, ownerId: 'worker-A#1', leaseSeconds: LEASE,
    })
    const auth = await authorizeRun(f.kernel, await f.kernel.requireRun(run.id), {
      generation: claim.claimGeneration,
    })
    expect(auth.verdict).toBe('allow')
    expect(runRow(f).status).toBe('authorized')
    advancePastLease(f) // A 没了
    return { runId: run.id, decisionId: auth.decision.id }
  }

  const allowCount = (f: F) =>
    f.tables.authorization_decisions.filter((d) => d.verdict === 'allow').length

  it('🔴 政策被删 → 立刻重新判定成 denied，不是卡在 authorized 反复报错', async () => {
    const f = fixture()
    await authorizedThenAbandoned(f)
    f.tables.client_automation_policies.length = 0

    const out = await runAction(f.kernel, submit())

    expect(out.kind).toBe('denied')
    expect(runRow(f).status).toBe('denied')
    expect(out.humanReason).toBeTruthy()
  })

  it('🔴 政策模式从 auto 改成 require_approval → 立刻停在等人点头', async () => {
    // 🔴 **只改模式，不动版本号和行 id。**
    //    带上版本号的话，版本闸会先咬 —— 模式复核那道闸就被遮蔽了，
    //    拆掉它没有任何测试会红（实测过）。
    //    「触发器失灵 / 有人绕过设置页直接改库」正是这个形状。
    const f = fixture()
    await authorizedThenAbandoned(f)
    const policy = f.tables.client_automation_policies[0]
    const versionBefore = policy.policy_version
    const idBefore = policy.id
    policy.mode = 'require_approval'
    expect(policy.policy_version).toBe(versionBefore) // 版本没动
    expect(policy.id).toBe(idBefore) // 行也没换

    const out = await runAction(f.kernel, submit())

    expect(out.kind).toBe('pending_approval')
    expect(f.tables.production_packages).toHaveLength(0)
  })

  it('🔴 政策版本变了 → 重新签一份新授权（不拿旧的去撞墙）', async () => {
    const f = fixture()
    await authorizedThenAbandoned(f)
    const before = allowCount(f)
    const policy = f.tables.client_automation_policies[0]
    policy.policy_version = Number(policy.policy_version) + 1

    const out = await runAction(f.kernel, submit())

    expect(out.kind).toBe('succeeded')
    expect(allowCount(f)).toBe(before + 1) // 重新签了，不是复用
  })

  it('🔴 政策被删掉重建（版本号一样、行不是同一行）→ 也算不可复用', async () => {
    const f = fixture()
    await authorizedThenAbandoned(f)
    const before = allowCount(f)
    const old = f.tables.client_automation_policies[0]
    f.tables.client_automation_policies.length = 0
    f.tables.client_automation_policies.push({ ...old, id: 'policy-rebuilt' })

    const out = await runAction(f.kernel, submit())

    expect(out.kind).toBe('succeeded')
    expect(allowCount(f)).toBe(before + 1)
  })

  it('✅ 政策一个字没变 → 照旧复用那份授权，不重新签', async () => {
    const f = fixture()
    await authorizedThenAbandoned(f)
    const before = allowCount(f)

    const out = await runAction(f.kernel, submit())

    expect(out.kind).toBe('succeeded')
    expect(allowCount(f)).toBe(before) // 复用，审计表里仍然只有一个「谁批的」
  })
})

describe('P2-2 · 批准之后要说真话（不是一律 in_progress）', () => {
  async function pendingRun(f: F) {
    const out = await runAction(f.kernel, submit())
    expect(out.kind).toBe('pending_approval')
    return out.run.id
  }

  /**
   * 🔴 这条分支只在「两句之间别人插了一脚」时才走得到，所以用 `beforeRpc`
   *    精确制造那个交错 —— 不靠「大概等价」的间接测试糊过去。
   *
   *    注意能被造出来的终态：批准发生在**建步骤之前**，所以那一刻现实里
   *    可达的终态是 `dead_letter` / `denied`（`succeeded` 一定带着步骤行，
   *    在这个时点伪造出来是假的 —— 那种情况由 runAction 那条 idempotent_hit
   *    用例覆盖）。
   */
  function hijackAtClaim(terminal: 'dead_letter' | 'denied', lastError: string) {
    const state = { hijacked: false }
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: {
        policy: { ...AUTO_POLICY, mode: 'require_approval' },
        supabaseOptions: {
          beforeRpc: (name) => {
            if (name !== 'kernel_claim_or_takeover_run' || state.hijacked) return
            const row = f.tables.action_runs[0]
            if (row.status !== 'authorized') return
            state.hijacked = true
            row.status = terminal
            row.last_error = lastError
          },
        },
      },
      startAt: T0,
      leaseSeconds: LEASE,
    })
    return { f, state }
  }

  it('🔴 批准之后、领租约之前被别人跑成死信 → 返回死信原因，不是 in_progress', async () => {
    const { f, state } = hijackAtClaim('dead_letter', '下游一直不通')
    const pending = await runAction(f.kernel, submit())
    expect(pending.kind).toBe('pending_approval')

    const out = await approveAndRun(f.kernel, pending.run.id, 'ray@magiclab')

    expect(state.hijacked).toBe(true)
    expect(out.kind).toBe('dead_letter')
    expect(out.humanReason).toBe('下游一直不通')
    // 决策还是那条人签的放行 —— 同意本身是生效了的，只是执行由别人推进
    expect(out.decision?.decided_by).toBe('human')
  })

  it('🔴 同样的交错，但赢家把它判成了拒绝 → 返回拒绝原因', async () => {
    const { f, state } = hijackAtClaim('denied', '客户把规则改成了禁止')
    const pending = await runAction(f.kernel, submit())

    const out = await approveAndRun(f.kernel, pending.run.id, 'ray@magiclab')

    expect(state.hijacked).toBe(true)
    expect(out.kind).toBe('denied')
    expect(out.humanReason).toBe('客户把规则改成了禁止')
  })

  it('🔴 claim 失败且 run 已经是终态 → 按真实终态回答（succeeded / dead_letter）', async () => {
    const f = fixture('require_approval')
    const runId = await pendingRun(f)

    // 人点同意 → 跑完
    const done = await approveAndRun(f.kernel, runId, 'ray@magiclab')
    expect(done.kind).toBe('succeeded')

    // 再点一次同意：approveRun 会拒（已经不是 pending），这是另一条路。
    // 这里直接验共用件：run 是终态时 claim 失败必须如实回答。
    const late = await claimOrTakeoverRun(f.supabase, {
      runId, ownerId: 'late#1', leaseSeconds: LEASE,
    })
    expect(late.ok).toBe(false)
    expect(late.reason).toBe('not_claimable:succeeded')

    // 同一把共用件在 runAction 上的表现：拿到的是真实终态 + 真实产物
    const again = await runAction(f.kernel, submit())
    expect(again.kind).toBe('idempotent_hit')
    expect(again.execution?.output).toBeTruthy()
    expect(again.execution?.verification?.passed).toBe(true)
  })

  it('🔴 run 是 dead_letter 时 → 返回死信原因，不是「正在做」', async () => {
    const f = fixture()
    const out = await runAction(f.kernel, submit())
    expect(out.kind).toBe('succeeded')

    runRow(f).status = 'dead_letter'
    runRow(f).last_error = '验证没过'
    runRow(f).claimed_by = null
    runRow(f).lease_expires_at = null

    const again = await runAction(f.kernel, submit())
    expect(again.kind).toBe('dead_letter')
    expect(again.humanReason).toBe('验证没过')
  })

  it('✅ 真的还有活着的 owner → 才答 in_progress', async () => {
    const f = fixture()
    const { run } = await submitActionRun(f.kernel, submit())
    await claimOrTakeoverRun(f.supabase, {
      runId: run.id, ownerId: 'someone-alive#1', leaseSeconds: LEASE,
    })

    const out = await runAction(f.kernel, submit())
    expect(out.kind).toBe('in_progress')
  })
})
