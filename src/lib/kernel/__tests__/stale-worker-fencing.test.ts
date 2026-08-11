/**
 * F1 —— 租约过期之后，**旧执行者必须被真正隔离**。
 *
 * 危险时序（Codex review 5 点名的那个）：
 *   ① A 领到租约和授权；② A 开始推进某一步但卡住；③ A 的租约到期；
 *   ④ B 接管；⑤ **A 醒过来**；⑥ A 不能再写 step / cost / decision / run 状态。
 *
 * 🔴 光有 owner 字符串不够。A 手里握着的 `step_id` / `run_id` / `decision_id`
 *    在接管之后**依然有效** —— 任何「按 id 更新」的语句它照写不误。
 *    所以每一次推进性写入都要出示**单调递增的代际**（fencing token）：
 *    `WHERE id = ? AND claim_generation = ?`，过期的那一代影响 0 行。
 *
 * 🔴 代际单调 ⇒ 不存在 ABA：A 那一代一旦被跳过就永远回不来
 *    （哪怕 A 后来重新领到，那也是更大的一代）。
 *
 * 🔴 关于外部副作用：fencing 拦得住**记账**，拦不住 A 已经发出去的那个
 *    provider 调用。端到端只靠一样东西收敛 —— 稳定的 step 级幂等键。
 *    见本文件最后一组用例，以及 spec 里「我们到底保证什么」。
 */

import { describe, it, expect, vi } from 'vitest'
import { runAction, submitActionRun } from '../runner'
import { authorizeRun } from '../authorize'
import { executeAuthorizedRun } from '../gateway'
import {
  claimOrTakeoverRun,
  updateStepFenced,
  updateRunFenced,
  beginAuthorizedRun,
  listSteps,
} from '../store'
import { ACTION_REGISTRY } from '../registry'
import { createCapabilities, computeBlogContentHash } from '@/lib/capabilities'
import type { BlogDraftRow } from '@/lib/capabilities/seo/build-publish-package'
import type { CapabilityStepContext } from '../types'
import { makeFixture, CLIENT_A, GOAL_A, POST_A, BLOG_DRAFT } from './fixtures'

const KEY = 'seo.build_publish_package'
const HASH = computeBlogContentHash(BLOG_DRAFT as unknown as BlogDraftRow)
const AUTO_POLICY = { action_key: KEY, mode: 'auto_approve', spend_cap_per_run_usd: 0 }
const LEASE = 60
const T0 = '2026-08-08T02:00:00.000Z'

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

function fixture(capabilities = createCapabilities) {
  return makeFixture({
    registry: ACTION_REGISTRY,
    capabilities,
    options: { policy: AUTO_POLICY },
    startAt: T0,
    leaseSeconds: LEASE,
  })
}
type F = ReturnType<typeof fixture>

const runRow = (f: F) => f.tables.action_runs[0]
const advancePastLease = (f: F) => {
  f.clock.now = new Date(f.clock.now.getTime() + (LEASE + 1) * 1000)
}

/** A 领到租约并签好授权，但还没开跑。返回 A 手里那份（很快就会过期的）围栏。 */
async function aHoldsAuthorization(f: F) {
  const { run } = await submitActionRun(f.kernel, submit())
  const claimA = await claimOrTakeoverRun(f.supabase, {
    runId: run.id,
    ownerId: 'worker-A#1',
    leaseSeconds: LEASE,
  })
  expect(claimA.ok).toBe(true)
  const auth = await authorizeRun(f.kernel, await f.kernel.requireRun(run.id), {
    generation: claimA.claimGeneration,
  })
  expect(auth.verdict).toBe('allow')
  return {
    runId: run.id,
    auth,
    fenceA: { ownerId: 'worker-A#1', generation: claimA.claimGeneration },
  }
}

describe('F1 · 接管之后，旧执行者的每一种晚到写入都被挡住', () => {
  it('🔴 ② A 过期后想兑换原来那份授权 → 失败，授权一个字没动', async () => {
    const f = fixture()
    const { runId, auth, fenceA } = await aHoldsAuthorization(f)

    advancePastLease(f)
    const claimB = await claimOrTakeoverRun(f.supabase, {
      runId,
      ownerId: 'worker-B#1',
      leaseSeconds: LEASE,
    })
    expect(claimB.ok).toBe(true)
    expect(claimB.claimGeneration).toBe(fenceA.generation + 1)

    // A 醒过来，拿着自己那一代去开跑
    await expect(executeAuthorizedRun(f.kernel, auth.ctx!, fenceA)).rejects.toThrow(/接管/)

    // 🔴 授权没有被消费掉 —— 兑换是不可逆的，绝不能让过期的执行者用掉它
    const decision = f.tables.authorization_decisions.find((d) => d.id === auth.decision.id)!
    expect(decision.consumed_at ?? null).toBeNull()
    expect(decision.consumed_by ?? null).toBeNull()
    // run 也没被推进
    expect(runRow(f).status).not.toBe('running')
    expect(f.tables.production_packages).toHaveLength(0)
  })

  it('🔴 ① A 晚到写 step → 影响 0 行，什么状态都没改变', async () => {
    const f = fixture()
    const { runId, fenceA } = await aHoldsAuthorization(f)
    const stepsBefore = await listSteps(f.supabase, runId)
    // 造一行步骤给 A 去写（正常执行里它是 ensureSteps 建的）
    await f.supabase.from('action_run_steps').insert({
      run_id: runId,
      client_id: CLIENT_A,
      step_key: 'build',
      step_index: 0,
      status: 'pending',
      claim_generation: fenceA.generation,
    })
    const [step] = await listSteps(f.supabase, runId)
    expect(stepsBefore).toHaveLength(0)

    advancePastLease(f)
    await claimOrTakeoverRun(f.supabase, { runId, ownerId: 'worker-B#1', leaseSeconds: LEASE })

    // A 晚到，想把自己那一步写成 succeeded
    const wrote = await updateStepFenced(f.supabase, step.id, fenceA.generation, {
      status: 'succeeded',
      output: { hijacked: true },
      cost_actual_usd: 999,
    })

    expect(wrote).toBeNull() // 🔴 影响 0 行
    const after = (await listSteps(f.supabase, runId))[0]
    expect(after.status).toBe('pending')
    expect(after.output).toEqual({})
    expect(Number(after.cost_actual_usd)).toBe(0)
  })

  it('🔴 ① A 晚到写 run 终态（succeeded / dead_letter）→ 影响 0 行', async () => {
    const f = fixture()
    const { runId, fenceA } = await aHoldsAuthorization(f)
    advancePastLease(f)
    await claimOrTakeoverRun(f.supabase, { runId, ownerId: 'worker-B#1', leaseSeconds: LEASE })
    const statusBefore = String(runRow(f).status)

    for (const status of ['succeeded', 'dead_letter'] as const) {
      const wrote = await updateRunFenced(f.supabase, runId, fenceA.generation, {
        status,
        last_error: 'A 以为自己还在跑',
      })
      expect(wrote, `${status} 不该写得进去`).toBeNull()
    }
    expect(runRow(f).status).toBe(statusBefore)
    expect(runRow(f).last_error ?? null).toBeNull()
  })

  it('🔴 ⑤ A 用过期的代际续租 → 领不到；也清不掉 B 的租约', async () => {
    const f = fixture()
    const { runId, fenceA } = await aHoldsAuthorization(f)
    advancePastLease(f)
    const claimB = await claimOrTakeoverRun(f.supabase, {
      runId,
      ownerId: 'worker-B#1',
      leaseSeconds: LEASE,
    })

    // 带着旧代际来续租 → 代际闸拦住
    const renew = await claimOrTakeoverRun(f.supabase, {
      runId,
      ownerId: 'worker-A#1',
      leaseSeconds: LEASE,
      expectedGeneration: fenceA.generation,
    })
    expect(renew.ok).toBe(false)
    expect(renew.reason).toBe(`stale_generation:${claimB.claimGeneration}`)

    // 就算不带代际，B 的租约还活着 → 一样抢不走
    const steal = await claimOrTakeoverRun(f.supabase, {
      runId,
      ownerId: 'worker-A#1',
      leaseSeconds: LEASE,
    })
    expect(steal.ok).toBe(false)
    expect(steal.reason).toBe('already_owned:worker-B#1')

    // B 的 owner / 租约 / 代际一个字都没被动过
    expect(runRow(f).claimed_by).toBe('worker-B#1')
    expect(Number(runRow(f).claim_generation)).toBe(claimB.claimGeneration)
  })

  it('🔴 ④ 三方并发接管 → 只有一代赢，输的两个既没换 owner 也没换代', async () => {
    const f = fixture()
    const { runId } = await aHoldsAuthorization(f)
    const genBefore = Number(runRow(f).claim_generation)
    advancePastLease(f)

    const results = await Promise.all(
      ['B#1', 'C#1', 'D#1'].map((owner) =>
        claimOrTakeoverRun(f.supabase, { runId, ownerId: owner, leaseSeconds: LEASE }),
      ),
    )

    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok && r.reason.startsWith('already_owned'))).toHaveLength(2)
    // 🔴 代际只 +1（不是每个尝试者都推一次）
    expect(Number(runRow(f).claim_generation)).toBe(genBefore + 1)
    expect(Number(runRow(f).reclaim_count)).toBe(1)

    // 只有赢家那一代写得动
    const winner = results.find((r) => r.ok)!
    const [step] = await listSteps(f.supabase, runId).then(async (ss) => {
      if (ss.length > 0) return ss
      await f.supabase.from('action_run_steps').insert({
        run_id: runId, client_id: CLIENT_A, step_key: 'build', step_index: 0,
        status: 'pending', claim_generation: winner.claimGeneration,
      })
      return listSteps(f.supabase, runId)
    })
    expect(await updateStepFenced(f.supabase, step.id, genBefore, { status: 'running' })).toBeNull()
    expect(await updateStepFenced(f.supabase, step.id, winner.claimGeneration, { status: 'running' })).not.toBeNull()
  })
})

describe('F1 · 端到端：A 真的卡在某一步的中间，B 接管', () => {
  it('🔴 A 卡在 build 里 → 租约到期 → B 接管 → A 醒来写回：抛 STALE_CLAIM，一行都没改', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    const buildCalls: string[] = []

    const f = fixture((sb) => {
      const real = createCapabilities(sb)
      const impl = real[KEY]
      return {
        [KEY]: {
          ...impl,
          steps: {
            ...impl.steps,
            build: async (s: CapabilityStepContext) => {
              buildCalls.push(s.idempotencyKey)
              if (buildCalls.length === 1) await gate // A 卡在这里
              return impl.steps.build(s)
            },
          },
        },
      }
    })

    // A 开跑（不 await）—— 它会领租约、授权、begin（run → running），然后卡在 build 里
    const aPromise = runAction(f.kernel, submit()).then(
      (v) => ({ ok: true as const, v }),
      (e) => ({ ok: false as const, e: e as Error }),
    )
    await Promise.resolve() // 让 A 跑到闸门前
    await new Promise((r) => setTimeout(r, 0))
    expect(buildCalls).toHaveLength(1)
    expect(runRow(f).status).toBe('running')
    const genA = Number(runRow(f).claim_generation)

    // A 的租约到期，B 接管这条**正在跑**的 run
    advancePastLease(f)
    const claimB = await claimOrTakeoverRun(f.supabase, {
      runId: runRow(f).id as string,
      ownerId: 'worker-B#1',
      leaseSeconds: LEASE,
    })
    expect(claimB.ok).toBe(true)
    expect(claimB.claimGeneration).toBe(genA + 1)
    expect(claimB.runStatus).toBe('queued') // 放回去重新授权

    // A 醒过来继续写
    release()
    const aResult = await aPromise

    expect(aResult.ok).toBe(false)
    expect((aResult as { e: Error }).e.message).toMatch(/接管/)
    // 🔴 A 没能把 run 推成任何终态，也没能把步骤写成 succeeded
    expect(runRow(f).status).toBe('queued')
    expect(Number(runRow(f).claim_generation)).toBe(claimB.claimGeneration)
    const steps = await listSteps(f.supabase, runRow(f).id as string)
    expect(steps.every((st) => st.status !== 'succeeded')).toBe(true)
    expect(steps.every((st) => st.claim_generation === claimB.claimGeneration)).toBe(true)

    // B 接着把它跑完。（上面那次接管是直接调 RPC 模拟 B 的，它的租约还占着；
    //  这里再推一次时钟让它到期，好让下一次 runAction 能正常领到。）
    advancePastLease(f)
    const done = await runAction(f.kernel, submit())
    expect(done.kind).toBe('succeeded')
    expect(f.tables.production_packages).toHaveLength(1)
  })
})

describe('F1 · 三个可接管状态分别覆盖（不是只测其中一个）', () => {
  for (const status of ['queued', 'authorizing', 'authorized'] as const) {
    it(`🔴 ${status} 崩溃 → B 接管后换代，A 的旧代际写不进任何一行`, async () => {
      const f = fixture()
      const { run } = await submitActionRun(f.kernel, submit())
      const claimA = await claimOrTakeoverRun(f.supabase, {
        runId: run.id, ownerId: 'worker-A#1', leaseSeconds: LEASE,
      })
      runRow(f).status = status
      await f.supabase.from('action_run_steps').insert({
        run_id: run.id, client_id: CLIENT_A, step_key: 'build', step_index: 0,
        status: 'pending', claim_generation: claimA.claimGeneration,
      })
      const [step] = await listSteps(f.supabase, run.id)

      advancePastLease(f)
      const claimB = await claimOrTakeoverRun(f.supabase, {
        runId: run.id, ownerId: 'worker-B#1', leaseSeconds: LEASE,
      })
      expect(claimB.ok).toBe(true)
      expect(claimB.claimGeneration).toBe(claimA.claimGeneration + 1)

      // A 的每一路写入都被挡住
      expect(await updateStepFenced(f.supabase, step.id, claimA.claimGeneration, { status: 'succeeded' })).toBeNull()
      expect(await updateRunFenced(f.supabase, run.id, claimA.claimGeneration, { status: 'succeeded' })).toBeNull()
      const begun = await beginAuthorizedRun(
        f.supabase, run.id, 'whatever-decision', 'worker-A#1', claimA.claimGeneration,
      )
      expect(begun.ok).toBe(false)
    })
  }

  it('🔴 running 崩溃也能被接管（否则崩在执行中的 run 永远没人接得手）', async () => {
    const f = fixture()
    const { run } = await submitActionRun(f.kernel, submit())
    const claimA = await claimOrTakeoverRun(f.supabase, {
      runId: run.id, ownerId: 'worker-A#1', leaseSeconds: LEASE,
    })
    runRow(f).status = 'running'
    runRow(f).authorization_decision_id = 'consumed-by-A'

    advancePastLease(f)
    const claimB = await claimOrTakeoverRun(f.supabase, {
      runId: run.id, ownerId: 'worker-B#1', leaseSeconds: LEASE,
    })

    expect(claimB.ok).toBe(true)
    expect(claimB.resetSteps).toBe(true)
    // 授权已被上一代兑换掉 → 放回 queued 重新签，而不是拿一份用过的授权接着跑
    expect(claimB.runStatus).toBe('queued')
    expect(runRow(f).authorization_decision_id).toBeNull()
    expect(claimB.claimGeneration).toBe(claimA.claimGeneration + 1)
  })
})

describe('F1 · 外部副作用靠稳定的 step 幂等键收敛（不是靠 fencing）', () => {
  /**
   * 造一个「provider 认幂等键」的 capability：
   * 同一个键第二次进来，直接返回上一次的结果，**不再产生副作用**。
   * 这就是真实 provider 支持幂等键时的行为。
   */
  function idempotentCapabilities(externalCalls: string[], seenKeys: string[]) {
    const done = new Map<string, Record<string, unknown>>()
    return (sb: Parameters<typeof createCapabilities>[0]) => {
      const real = createCapabilities(sb)
      const impl = real[KEY]
      return {
        [KEY]: {
          ...impl,
          steps: {
            ...impl.steps,
            build: async (s: CapabilityStepContext) => {
              seenKeys.push(s.idempotencyKey)
              const cached = done.get(s.idempotencyKey)
              if (cached) return cached as never
              // 「真正的外部副作用」就发生在这里
              externalCalls.push(s.idempotencyKey)
              const out = await impl.steps.build(s)
              done.set(s.idempotencyKey, out as never)
              return out
            },
          },
        },
      }
    }
  }

  it('🔴 ③ A 发起了外部动作但没落库就崩 → B 接管重试，副作用只发生一次，两次用同一把键', async () => {
    const externalCalls: string[] = []
    const seenKeys: string[] = []
    const f = fixture(idempotentCapabilities(externalCalls, seenKeys))

    // A：领租约 → 授权 → 开跑，但在**写库之前**就当作崩了
    const { run } = await submitActionRun(f.kernel, submit())
    const claimA = await claimOrTakeoverRun(f.supabase, {
      runId: run.id, ownerId: 'worker-A#1', leaseSeconds: LEASE,
    })
    const auth = await authorizeRun(f.kernel, await f.kernel.requireRun(run.id), {
      generation: claimA.claimGeneration,
    })
    // A 手动调一次 build —— 模拟「外部动作已经成功、数据库还没记上」
    const capability = f.kernel.capabilities[KEY]
    await capability.steps.build({
      ctx: auth.ctx!,
      stepKey: 'build',
      attempt: 1,
      priorOutputs: {},
      idempotencyKey: `${CLIENT_A}:${run.idempotency_key}:build`,
    })
    expect(externalCalls).toHaveLength(1)

    // A 没了。租约过期，B 接管并把整件事跑完。
    advancePastLease(f)
    const taken = await runAction(f.kernel, submit())

    expect(taken.kind).toBe('succeeded')
    // 🔴 外部副作用只发生了一次
    expect(externalCalls).toHaveLength(1)
    // 🔴 而且两次尝试出示的是**同一把键**
    expect(seenKeys.length).toBeGreaterThanOrEqual(2)
    expect(new Set(seenKeys).size).toBe(1)
    expect(seenKeys[0]).toBe(`${CLIENT_A}:${run.idempotency_key}:build`)
  })

  it('🔴 幂等键跨重试 / 跨死信重跑都不变（含 attempt 就等于每次换一张收据）', async () => {
    const seenKeys: string[] = []
    let calls = 0
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: (sb) => {
        const real = createCapabilities(sb)
        const impl = real[KEY]
        return {
          [KEY]: {
            ...impl,
            steps: {
              ...impl.steps,
              build: async (s: CapabilityStepContext) => {
                seenKeys.push(s.idempotencyKey)
                calls += 1
                if (calls === 1) throw new Error('第一次崩了')
                return impl.steps.build(s)
              },
            },
          },
        }
      },
      options: { policy: AUTO_POLICY },
      startAt: T0,
      leaseSeconds: LEASE,
    })

    const first = await runAction(f.kernel, submit())
    expect(first.kind).toBe('dead_letter')
    const resumed = await runAction(f.kernel, submit()) // 撞死信 → 拿回死信结果
    expect(resumed.kind).toBe('dead_letter')

    const { resumeDeadLetterRun } = await import('../runner')
    const done = await resumeDeadLetterRun(f.kernel, first.run.id, 'ray@magiclab')
    expect(done.kind).toBe('succeeded')

    // 🔴 从头到尾只有一把键
    expect(seenKeys.length).toBeGreaterThanOrEqual(2)
    expect(new Set(seenKeys).size).toBe(1)
  })

  it('幂等键的构成：客户 + 这件事 + 这一步，不含 attempt / 代际', async () => {
    const seenKeys: string[] = []
    const f = fixture((sb) => {
      const real = createCapabilities(sb)
      const impl = real[KEY]
      return {
        [KEY]: {
          ...impl,
          steps: {
            ...impl.steps,
            build: async (s: CapabilityStepContext) => {
              seenKeys.push(s.idempotencyKey)
              return impl.steps.build(s)
            },
          },
        },
      }
    })

    const out = await runAction(f.kernel, submit())
    expect(out.kind).toBe('succeeded')
    expect(seenKeys[0]).toBe(`${CLIENT_A}:${out.run.idempotency_key}:build`)
    expect(seenKeys[0]).not.toMatch(/attempt|generation|#/)
  })
})
