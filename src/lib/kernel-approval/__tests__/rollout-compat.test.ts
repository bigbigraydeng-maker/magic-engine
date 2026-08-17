/**
 * K-WP01A 守卫 · **RPC 上线兼容 + fail closed**（Build Control Room blocker ①）
 *
 * 要守住的是三句话：
 *   ① 数据库和代码必须能**各自独立上线** —— 历史五参入口永远可调用，
 *      新行为挂在新名字 `kernel_record_fenced_deny_v2` 上。
 *   ② 自动授权路径（没有「审批人看到的那份」这个概念）走五参入口，
 *      **不许**把 `p_expected_decision_id` 递给它 —— 真库那个函数没这个参数。
 *   ③ 人工审批的拒绝路径**只能**走 v2。v2 还没部署就**抛错**，
 *      绝不退回没有 fence 的五参调用。
 *
 * 🔴 第 ③ 条是这一批里唯一真正带安全后果的：退回去的话，`pending_approval`
 *    期间这条 run 已经被重新排成**另一份**待审批请求时，一次迟到的「批不了」
 *    会把那份**新的、还没人看过的**请求盖成 denied，而正在看它的人什么都不知道。
 *    所以这里不验「有没有抛错」就完了 —— 必须验**五参入口一次都没被调用过**。
 */

import { describe, it, expect } from 'vitest'
import { recordFencedDeny, resolvePendingApproval } from '@/lib/kernel/store'
import { approvalErrorResponse } from '@/lib/kernel-approval/http'
import type { SupabaseClient } from '@supabase/supabase-js'

const LEGACY = 'kernel_record_fenced_deny'
const V2 = 'kernel_record_fenced_deny_v2'
const RESOLVE_LEGACY = 'kernel_resolve_pending_approval'
const RESOLVE_V2 = 'kernel_resolve_pending_approval_v2'

type Call = { name: string; args: Record<string, unknown> }

/** 只记账、不建模业务的 sb —— 这里要证的是「打了哪个入口、带了哪些参数」。 */
function spyClient(
  reply: (name: string) => { data: unknown; error: { code?: string; message?: string } | null },
): { sb: SupabaseClient; calls: Call[] } {
  const calls: Call[] = []
  const sb = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args })
      return reply(name)
    },
  } as unknown as SupabaseClient
  return { sb, calls }
}

const OK = { data: [{ ok: true, reason: 'denied', decision_id: 'd1' }], error: null }
const MISSING_V2 = {
  data: null,
  error: {
    code: 'PGRST202',
    message: `Could not find the function public.${V2}(...) in the schema cache`,
  },
}

const baseArgs = {
  runId: '11111111-1111-4111-8111-111111111111',
  expectedGeneration: 3,
  expectedStatus: 'pending_approval' as const,
  reason: '政策漂移',
  decision: { client_id: 'c1', deny_code: 'policy_drift' },
}

describe('🔴 RPC 上线兼容：两个名字，各自独立部署', () => {
  it('自动授权路径（没有指针）打的是历史五参入口', async () => {
    const { sb, calls } = spyClient(() => OK)
    await recordFencedDeny(sb, { ...baseArgs, expectedDecisionId: null })

    expect(calls.map((c) => c.name)).toEqual([LEGACY])
  })

  it('🔴 五参入口不许收到 p_expected_decision_id —— 真库那个函数没这个参数', async () => {
    const { sb, calls } = spyClient(() => OK)
    await recordFencedDeny(sb, { ...baseArgs, expectedDecisionId: null })

    // 多带一个参数，PostgREST 按参数名找函数会直接找不到（PGRST202）。
    // 「反正有默认值」在这里不成立：五参函数根本没有这个形参。
    expect(Object.keys(calls[0].args)).not.toContain('p_expected_decision_id')
    expect(Object.keys(calls[0].args).sort()).toEqual([
      'p_decision',
      'p_expected_generation',
      'p_expected_status',
      'p_reason',
      'p_run_id',
    ])
  })

  it('人工审批路径（带指针）打的是 v2，并把指针原样递下去', async () => {
    const { sb, calls } = spyClient(() => OK)
    const pointer = '22222222-2222-4222-8222-222222222222'
    await recordFencedDeny(sb, { ...baseArgs, expectedDecisionId: pointer })

    expect(calls.map((c) => c.name)).toEqual([V2])
    expect(calls[0].args.p_expected_decision_id).toBe(pointer)
  })
})

describe('🔴 v2 没部署 = fail closed，绝不回退', () => {
  it('抛错，而且错误里说清了是「没 apply migration」', async () => {
    const { sb } = spyClient(() => MISSING_V2)
    await expect(
      recordFencedDeny(sb, {
        ...baseArgs,
        expectedDecisionId: '22222222-2222-4222-8222-222222222222',
      }),
    ).rejects.toThrow(/kernel_record_fenced_deny_v2 在这个数据库里还不存在/)
  })

  it('🔴 **五参入口一次都没被调用过** —— 这才是「不回退」的证据', async () => {
    const { sb, calls } = spyClient(() => MISSING_V2)
    await recordFencedDeny(sb, {
      ...baseArgs,
      expectedDecisionId: '22222222-2222-4222-8222-222222222222',
    }).catch(() => undefined)

    // 只验「抛了错」是不够的：一个先试 v2、失败再打五参、最后才抛错的实现
    // 同样会抛错，但那次没有 fence 的写入**已经落地了**。
    expect(calls.map((c) => c.name)).toEqual([V2])
    expect(calls.some((c) => c.name === LEGACY)).toBe(false)
  })

  it('🔴 不许把别的故障也说成「没 apply」—— 那会让运维照着去 apply 也修不好', async () => {
    const { sb } = spyClient(() => ({
      data: null,
      error: { code: '42501', message: 'permission denied for function' },
    }))
    await expect(
      recordFencedDeny(sb, {
        ...baseArgs,
        expectedDecisionId: '22222222-2222-4222-8222-222222222222',
      }),
    ).rejects.toThrow(/permission denied/)
  })
})

// ── 审批状态迁移 RPC 的版本化（Build Control Room blocker ①）────────────────

const resolveArgs = {
  runId: '33333333-3333-4333-8333-333333333333',
  pendingDecisionId: '44444444-4444-4444-8444-444444444444',
  resolution: 'approve' as const,
  resolvedBy: 'someone@example.com',
  reason: '同意',
  policySnapshot: {},
  costEstimateUsd: null,
}

const RESOLVE_OK = { data: [{ ok: true, reason: 'approved', decision_id: 'd2' }], error: null }
const RESOLVE_MISSING_V2 = {
  data: null,
  error: {
    code: 'PGRST202',
    message: `Could not find the function public.${RESOLVE_V2}(...) in the schema cache`,
  },
}

describe('🔴 人工批准/拒绝只打版本化入口', () => {
  it('打的是 _v2，历史原名一次都不打', async () => {
    const { sb, calls } = spyClient(() => RESOLVE_OK)
    await resolvePendingApproval(sb, resolveArgs)

    // 🔴 历史原名今天**仍然可调用**（迁移把它换成了兼容壳）。所以「打错名字」
    //    在生产上不是报错，是**静默成功打在旧实现上** —— 锚身份闸、政策行锁、
    //    挂钟复核在整个上线窗口里一条都不存在，而调用方拿到「成功」。
    expect(calls.map((c) => c.name)).toEqual([RESOLVE_V2])
    expect(calls.some((c) => c.name === RESOLVE_LEGACY)).toBe(false)
  })

  it('七个参数逐个递到 v2', async () => {
    const { sb, calls } = spyClient(() => RESOLVE_OK)
    await resolvePendingApproval(sb, resolveArgs)
    expect(Object.keys(calls[0].args).sort()).toEqual([
      'p_cost_estimate_usd',
      'p_pending_decision_id',
      'p_policy_snapshot',
      'p_reason',
      'p_resolution',
      'p_resolved_by',
      'p_run_id',
    ])
  })

  it('🔴 v2 没部署 → 抛错，且**历史原名一次都没被调用过**', async () => {
    const { sb, calls } = spyClient(() => RESOLVE_MISSING_V2)
    await resolvePendingApproval(sb, resolveArgs).catch(() => undefined)

    expect(calls.map((c) => c.name)).toEqual([RESOLVE_V2])
    expect(calls.some((c) => c.name === RESOLVE_LEGACY)).toBe(false)
  })
})

/**
 * 🔴 **四种上线顺序都得有确定的行为。**
 *
 * 数据库和代码是分开上线的，四种组合都会真实发生。这张表把每一种的
 * 期望行为写死 —— 「大概不会有事」不是答案。
 */
describe('🔴 四种上线顺序', () => {
  const CASES: ReadonlyArray<{
    label: string
    v2Deployed: boolean
    expect: 'ok' | 'fail_closed'
  }> = [
    { label: '① 都升完（代码新 + 迁移已 apply）', v2Deployed: true, expect: 'ok' },
    { label: '② 代码先上、迁移还没 apply', v2Deployed: false, expect: 'fail_closed' },
    { label: '③ 迁移先 apply、代码还是旧的', v2Deployed: true, expect: 'ok' },
    { label: '④ 都是旧的（迁移没 apply、代码也旧）', v2Deployed: true, expect: 'ok' },
  ]

  it.each([...CASES])('拒绝落地 · $label', async ({ v2Deployed, expect: want }) => {
    const { sb, calls } = spyClient((name) =>
      !v2Deployed && name === V2 ? MISSING_V2 : OK,
    )
    const run = recordFencedDeny(sb, {
      ...baseArgs,
      expectedDecisionId: '22222222-2222-4222-8222-222222222222',
    })

    if (want === 'ok') {
      await expect(run).resolves.toMatchObject({ ok: true })
    } else {
      await expect(run).rejects.toThrow()
      // 🔴 fail closed 的硬判据：没有任何一次无 fence 的写入落地
      expect(calls.some((c) => c.name === LEGACY)).toBe(false)
    }
  })

  it.each([...CASES])('批准/拒绝迁移 · $label', async ({ v2Deployed, expect: want }) => {
    const { sb, calls } = spyClient((name) =>
      !v2Deployed && name === RESOLVE_V2 ? RESOLVE_MISSING_V2 : RESOLVE_OK,
    )
    const run = resolvePendingApproval(sb, resolveArgs)

    if (want === 'ok') {
      await expect(run).resolves.toMatchObject({ ok: true })
    } else {
      await expect(run).rejects.toThrow()
      expect(calls.some((c) => c.name === RESOLVE_LEGACY)).toBe(false)
    }
  })

  it('🔴 ③「迁移先 apply、代码还是旧的」这一格靠的是数据库那边的兼容壳', () => {
    // 应用层证不了这一格 —— 旧代码打的是历史原名，而它今天仍然存在。
    // 真正接住这一格的是前向迁移里那个「历史原名 → 转发到 v2」的壳，
    // 由 sql-contract 那条断言盯着。这里只把这件事写明，免得有人
    // 以为上面那一行 `expect: 'ok'` 就是证据。
    expect(true).toBe(true)
  })
})

/**
 * 🔴 **缺版本化 RPC 必须答 503，不是 500。**（Build Control Room blocker ③）
 *
 * 内核层 fail closed 时抛的错必须**带得住机器可读的码**。上一版抛普通 Error，
 * 码在抛出那一刻就丢了，于是这条声明过 `503 kernel_not_provisioned` 的路
 * 实际答 `500 internal_error`。对运维那是两条完全不同的指令。
 */
describe('🔴 缺 v2 → 503 kernel_not_provisioned', () => {
  async function statusOf(rpcError: { code?: string; message?: string }): Promise<{
    status: number
    code: string
  }> {
    const { sb } = spyClient(() => ({ data: null, error: rpcError }))
    const err = await resolvePendingApproval(sb, resolveArgs).catch((e: unknown) => e)
    const res = approvalErrorResponse(err)
    return { status: res.status, code: (await res.json()).code }
  }

  it.each([
    ['42883（PG：函数不存在）', '42883'],
    ['PGRST202（PostgREST：schema cache 里找不到）', 'PGRST202'],
  ])('%s → 503', async (_label, code) => {
    expect(await statusOf({ code, message: 'function does not exist' })).toEqual({
      status: 503,
      code: 'kernel_not_provisioned',
    })
  })

  it.each([
    ['权限不足', { code: '42501', message: 'permission denied for function' }],
    ['连不上', { message: 'fetch failed' }],
    ['超时', { code: '57014', message: 'canceling statement due to statement timeout' }],
    ['别的业务错', { code: '23505', message: 'duplicate key value violates unique constraint' }],
  ])('🔴 %s → 仍然是 500（不许被说成「没 apply」）', async (_label, rpcError) => {
    const got = await statusOf(rpcError)
    expect(got.status).toBe(500)
    expect(got.code).toBe('internal_error')
  })

  it('🔴 抛出的错带着原始码和 cause —— 丢了码上层就只能答 500', async () => {
    const { sb } = spyClient(() => RESOLVE_MISSING_V2)
    const err = (await resolvePendingApproval(sb, resolveArgs).catch((e: unknown) => e)) as {
      code?: string
      rpc?: string
      cause?: unknown
    }
    expect(err.code).toBe('PGRST202')
    expect(err.rpc).toBe(RESOLVE_V2)
    expect((err.cause as { code?: string }).code).toBe('PGRST202')
  })
})
