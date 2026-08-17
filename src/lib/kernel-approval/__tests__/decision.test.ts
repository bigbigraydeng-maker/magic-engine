/**
 * K-WP01A —— 审批层的行为闸。
 *
 * 要防的形状（按 Issue #881 的验收条件逐条）：
 *   · 批准之后**只**进 `authorized` —— 一个 capability 都没跑、一个步骤都没开、
 *     一个产物都没落。审批不是执行。
 *   · 拒绝之后只进 `denied`。
 *   · 审批人手里那份审批请求过期了 → 409，且**零新决策、run 一个字没动**。
 *   · 两个人抢 → 只有一个赢；批准 vs 拒绝抢 → 只有一个赢。
 *   · 已经有结论的 run 不能再处理。
 *   · 跨客户的东西不出现在列表里。
 *
 * 全部对着仓库现成的内存假件跑 —— 生产的 Kernel 表还没建（见 PR 描述）。
 */

import { describe, it, expect, vi } from 'vitest'
import { runAction } from '@/lib/kernel/runner'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { createCapabilities, computeBlogContentHash } from '@/lib/capabilities'
import type { BlogDraftRow } from '@/lib/capabilities/seo/build-publish-package'
import { makeFixture, CLIENT_A, CLIENT_B, GOAL_A, POST_A, BLOG_DRAFT } from '@/lib/kernel/__tests__/fixtures'
import { ApprovalError } from '../errors'
import { decideApproval, listPendingApprovals, buildApprovalDetail, loadRunForApproval } from '../service'

const KEY = 'seo.build_publish_package'
const HASH = computeBlogContentHash(BLOG_DRAFT as unknown as BlogDraftRow)
const APPROVAL_POLICY = { action_key: KEY, mode: 'require_approval', spend_cap_per_run_usd: 0 }
const ACTOR = 'ray@magiclab'

function submit(clientId: string = CLIENT_A) {
  return {
    clientId,
    actionKey: KEY,
    purpose: 'growth' as const,
    goalId: GOAL_A,
    triggeredBy: 'schedule' as const,
    input: { blog_post_id: POST_A, content_hash: HASH },
  }
}

/**
 * 一个停在「等人点头」的 run，**并且带着真实的 capability 实现 + 计数器**。
 *
 * 🔴 计数器是这套测试的核心：审批层如果哪天误接了执行入口
 *    （`approveRun` 被换成 `approveAndRun`），这里会当场被数出来。
 *    用空的 capability 表测「没执行」是自证 —— 那样什么都跑不起来。
 */
async function pendingFixture(supabaseOptions: Record<string, unknown> = {}) {
  const capabilityCalls = vi.fn()
  const f = makeFixture({
    registry: ACTION_REGISTRY,
    capabilities: (sb) => {
      const impl = createCapabilities(sb)[KEY]
      return {
        [KEY]: {
          ...impl,
          steps: Object.fromEntries(
            Object.entries(impl.steps).map(([k, h]) => [
              k,
              async (s: Parameters<typeof h>[0]) => {
                capabilityCalls()
                return h(s)
              },
            ]),
          ),
        },
      }
    },
    options: { policy: APPROVAL_POLICY, supabaseOptions },
  })
  const pending = await runAction(f.kernel, submit())
  expect(pending.kind).toBe('pending_approval')
  expect(capabilityCalls).not.toHaveBeenCalled()

  const run = f.tables.action_runs[0]
  return {
    f,
    capabilityCalls,
    runId: String(run.id),
    expectedDecisionId: String(run.authorization_decision_id),
  }
}

/** 「什么都没跑」的完整断言 —— 四条一起看，缺一条都可能被单独绕过去。 */
function expectNothingExecuted(
  f: Awaited<ReturnType<typeof pendingFixture>>['f'],
  capabilityCalls: ReturnType<typeof vi.fn>,
) {
  expect(capabilityCalls, 'capability 一次都不许被调用').not.toHaveBeenCalled()
  expect(f.tables.action_run_steps, '一个执行步骤都不许开始').toHaveLength(0)
  expect(f.tables.production_packages, '一个产物都不许落地').toHaveLength(0)
  expect(
    f.tables.action_runs[0].started_at,
    '批准不是开跑 —— started_at 必须还是空的',
  ).toBeFalsy()
}

describe('K-WP01A · 批准的终点只能是 authorized', () => {
  it('🔴 同意 → run 进 authorized，签下一条人签放行，**什么都没执行**', async () => {
    const { f, capabilityCalls, runId, expectedDecisionId } = await pendingFixture()

    const result = await decideApproval(f.kernel, {
      run: await loadRunForApproval(f.supabase, runId),
      actorEmail: ACTOR,
      input: { resolution: 'approve', expectedDecisionId },
    })

    expect(result.finalStatus).toBe('authorized')
    expect(result.decidedBy).toBe(ACTOR)
    expect(f.tables.action_runs[0].status).toBe('authorized')

    // append-only：新签一条，不是把原来那条改掉
    const humanAllows = f.tables.authorization_decisions.filter(
      (d) => d.verdict === 'allow' && d.decided_by === 'human',
    )
    expect(humanAllows).toHaveLength(1)
    expect(humanAllows[0].decided_by_user).toBe(ACTOR)
    expect(f.tables.action_runs[0].authorization_decision_id).toBe(humanAllows[0].id)
    // 原来那条 require_approval 一个字都没被改
    const original = f.tables.authorization_decisions.find((d) => d.id === expectedDecisionId)!
    expect(original.verdict).toBe('require_approval')

    expectNothingExecuted(f, capabilityCalls)
  })

  it('🔴 不做 → run 进 denied，理由记下来，同样什么都没执行', async () => {
    const { f, capabilityCalls, runId, expectedDecisionId } = await pendingFixture()

    const result = await decideApproval(f.kernel, {
      run: await loadRunForApproval(f.supabase, runId),
      actorEmail: ACTOR,
      input: { resolution: 'reject', expectedDecisionId, reason: '这周先不发' },
    })

    expect(result.finalStatus).toBe('denied')
    expect(f.tables.action_runs[0].status).toBe('denied')
    const humanDenies = f.tables.authorization_decisions.filter(
      (d) => d.verdict === 'deny' && d.decided_by === 'human',
    )
    expect(humanDenies).toHaveLength(1)
    expect(String(humanDenies[0].reason)).toContain('这周先不发')
    expect(String(humanDenies[0].decided_by_user)).toBe(ACTOR)

    expectNothingExecuted(f, capabilityCalls)
  })

  it('🔴 操作者身份来自参数（= 会话），落库的 decided_by_user 就是它，不是别的东西', async () => {
    const { f, runId, expectedDecisionId } = await pendingFixture()
    await decideApproval(f.kernel, {
      run: await loadRunForApproval(f.supabase, runId),
      actorEmail: 'jayden@magiclab',
      input: { resolution: 'approve', expectedDecisionId },
    })
    const allow = f.tables.authorization_decisions.find(
      (d) => d.verdict === 'allow' && d.decided_by === 'human',
    )!
    expect(allow.decided_by_user).toBe('jayden@magiclab')
  })
})

describe('K-WP01A · expectedDecisionId 过期', () => {
  it('🔴 拿一个别的 decision id 来批 → 409 stale_decision，且零新决策、run 一个字没动', async () => {
    // 🔴 这条**还要**证明应用层那道闸是独立生效的 —— 见下面的 rpcCalls 断言。
    //    数据库那道 CAS 也拦得住同样的输入，所以只断言「被拒了」的话，
    //    应用层这道就算整个删掉也照样绿（实测变异探针 MISSED）。
    //    两道闸的可观察差别只有一个：应用层这道**一次库都不打**。
    const rpcCalls: string[] = []
    const { f, capabilityCalls, runId, expectedDecisionId } = await pendingFixture({
      beforeRpc: (name: string) => rpcCalls.push(name),
    })
    const before = f.tables.authorization_decisions.length
    const runBefore = { ...f.tables.action_runs[0] }

    const err = await decideApproval(f.kernel, {
      run: await loadRunForApproval(f.supabase, runId),
      actorEmail: ACTOR,
      input: { resolution: 'approve', expectedDecisionId: '0d000000-0000-4000-8000-00000000fa9e' },
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApprovalError)
    expect((err as ApprovalError).code).toBe('stale_decision')
    expect((err as ApprovalError).status).toBe(409)
    expect(
      rpcCalls,
      '🔴 明显过期的 id 必须在**打库之前**就被拒 —— 一次原子 RPC 都不许发出去',
    ).not.toContain('kernel_resolve_pending_approval_v2')

    // 🔴 「什么都没被改动」不是一句安慰话 —— 逐条比
    expect(f.tables.authorization_decisions).toHaveLength(before)
    expect(f.tables.action_runs[0].status).toBe(runBefore.status)
    expect(f.tables.action_runs[0].authorization_decision_id).toBe(expectedDecisionId)
    expect(f.tables.action_runs[0].updated_at).toBe(runBefore.updated_at)
    expectNothingExecuted(f, capabilityCalls)
  })

  it('🔴 拒绝也一样：过期的 id 拒不掉，零新决策，且一次库都不打', async () => {
    const rpcCalls: string[] = []
    const { f, runId, expectedDecisionId } = await pendingFixture({
      beforeRpc: (name: string) => rpcCalls.push(name),
    })
    const before = f.tables.authorization_decisions.length

    const err = await decideApproval(f.kernel, {
      run: await loadRunForApproval(f.supabase, runId),
      actorEmail: ACTOR,
      input: { resolution: 'reject', expectedDecisionId: '0d000000-0000-4000-8000-00000000ba1d', reason: '不做' },
    }).catch((e: unknown) => e)

    expect((err as ApprovalError).code).toBe('stale_decision')
    expect(
      rpcCalls,
      '🔴 拒绝那条路的应用层闸同样要在打库之前拦下来',
    ).not.toContain('kernel_resolve_pending_approval_v2')
    expect(f.tables.authorization_decisions).toHaveLength(before)
    expect(f.tables.action_runs[0].status).toBe('pending_approval')
    expect(f.tables.action_runs[0].authorization_decision_id).toBe(expectedDecisionId)
  })

  it('🔴 交给数据库的 p_pending_decision_id 就是调用方带上来的那个', async () => {
    // 🔴 这条盯的是**数据来源**：审批的锚必须一路从调用方传到数据库的行锁那里，
    //    而不是在服务端重读一遍。
    //    诚实地说：应用层那道 CAS 保证了两个值在能走到这里的每条路径上必然相等，
    //    所以这条断言**分不出**两种实现 —— 它记录契约，不冒充原子性证明。
    //    真正的原子保证是数据库那道 CAS（`kernel_resolve_pending_approval` 第 ③ 步）。
    const seen: Array<Record<string, unknown>> = []
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: () => ({}),
      options: {
        policy: APPROVAL_POLICY,
        supabaseOptions: {
          beforeRpc: (name, args) => {
            if (name === 'kernel_resolve_pending_approval_v2') seen.push(args)
          },
        },
      },
    })
    const pending = await runAction(f.kernel, submit())
    expect(pending.kind).toBe('pending_approval')
    const runId = String(f.tables.action_runs[0].id)
    const expectedDecisionId = String(f.tables.action_runs[0].authorization_decision_id)

    await decideApproval(f.kernel, {
      run: await loadRunForApproval(f.supabase, runId),
      actorEmail: ACTOR,
      input: { resolution: 'approve', expectedDecisionId },
    })

    expect(seen, '必须真的走到那个原子 RPC —— 不许绕过它自己 update').toHaveLength(1)
    expect(seen[0].p_pending_decision_id).toBe(expectedDecisionId)
    expect(seen[0].p_resolved_by).toBe(ACTOR)
  })

  it('🔴 比完之后、RPC 之前 run 换了另一份审批请求 → 数据库那道 CAS 接住，仍然零新决策', async () => {
    // 这条盯的是**第二层**：应用层那道闸已经放行了（比的时候还是对的），
    // 真正拦住它的是数据库拿到行锁之后再比一次。
    // 用 beforeRpc 精确制造这个缝 —— 没有它，这条分支只能靠「大概等价」的构造糊过去。
    const capabilityCalls = vi.fn()
    let swapped = false
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: (sb) => {
        const impl = createCapabilities(sb)[KEY]
        return {
          [KEY]: {
            ...impl,
            steps: Object.fromEntries(
              Object.entries(impl.steps).map(([k, h]) => [
                k,
                async (s: Parameters<typeof h>[0]) => {
                  capabilityCalls()
                  return h(s)
                },
              ]),
            ),
          },
        }
      },
      options: {
        policy: APPROVAL_POLICY,
        supabaseOptions: {
          beforeRpc: (name) => {
            if (name !== 'kernel_resolve_pending_approval_v2' || swapped) return
            swapped = true
            // 系统在这一瞬间重新排了一次：run 换上了另一份审批请求
            const run = f.tables.action_runs[0]
            const replacement = {
              ...f.tables.authorization_decisions.find(
                (d) => d.id === run.authorization_decision_id,
              )!,
              id: '0d000000-0000-4000-8000-0000000e1550',
            }
            f.tables.authorization_decisions.push(replacement)
            run.authorization_decision_id = '0d000000-0000-4000-8000-0000000e1550'
          },
        },
      },
    })
    const pending = await runAction(f.kernel, submit())
    expect(pending.kind).toBe('pending_approval')
    const runId = String(f.tables.action_runs[0].id)
    const expectedDecisionId = String(f.tables.action_runs[0].authorization_decision_id)
    const decisionsBefore = f.tables.authorization_decisions.length

    const err = await decideApproval(f.kernel, {
      run: await loadRunForApproval(f.supabase, runId),
      actorEmail: ACTOR,
      input: { resolution: 'approve', expectedDecisionId },
    }).catch((e: unknown) => e)

    expect(swapped, '这条测试必须真的走到 RPC —— 否则它测的不是数据库那道闸').toBe(true)
    expect(err).toBeInstanceOf(ApprovalError)
    // 🔴 必须是 stale_decision，**不能**是 not_pending：run 这时仍然停在
    //    pending_approval，只是被重新挂到了另一份请求上 —— 对人来说是
    //    「刷新一下还能决定」，不是「已经有结论了」。压成后者，界面会告诉他
    //    这件事已经定了，而它其实还等着他点。
    expect((err as ApprovalError).code).toBe('stale_decision')

    // 🔴 只多了我们自己塞进去的那一条替身，**没有任何新签的决策**
    expect(f.tables.authorization_decisions).toHaveLength(decisionsBefore + 1)
    expect(
      f.tables.authorization_decisions.filter((d) => d.decided_by === 'human'),
    ).toHaveLength(0)
    expect(f.tables.action_runs[0].status).toBe('pending_approval')
    expect(capabilityCalls).not.toHaveBeenCalled()
  })
})

describe('K-WP01A · 并发', () => {
  it('🔴 两个人同时点同意 → 只有一次生效，只有一条人签放行', async () => {
    const { f, capabilityCalls, runId, expectedDecisionId } = await pendingFixture()
    const run = await loadRunForApproval(f.supabase, runId)

    const settled = await Promise.allSettled([
      decideApproval(f.kernel, {
        run,
        actorEmail: 'ray@magiclab',
        input: { resolution: 'approve', expectedDecisionId },
      }),
      decideApproval(f.kernel, {
        run,
        actorEmail: 'jayden@magiclab',
        input: { resolution: 'approve', expectedDecisionId },
      }),
    ])

    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1)
    expect(settled.filter((s) => s.status === 'rejected')).toHaveLength(1)
    expect(
      f.tables.authorization_decisions.filter(
        (d) => d.verdict === 'allow' && d.decided_by === 'human',
      ),
    ).toHaveLength(1)
    expect(f.tables.action_runs[0].status).toBe('authorized')
    expectNothingExecuted(f, capabilityCalls)
  })

  it('🔴 同意与不做同时点 → 只有一个赢，输的一方不覆盖赢家', async () => {
    const { f, capabilityCalls, runId, expectedDecisionId } = await pendingFixture()
    const run = await loadRunForApproval(f.supabase, runId)

    const settled = await Promise.allSettled([
      decideApproval(f.kernel, {
        run,
        actorEmail: 'ray@magiclab',
        input: { resolution: 'approve', expectedDecisionId },
      }),
      decideApproval(f.kernel, {
        run,
        actorEmail: 'jayden@magiclab',
        input: { resolution: 'reject', expectedDecisionId, reason: '先不做' },
      }),
    ])

    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1)
    const finalStatus = String(f.tables.action_runs[0].status)
    expect(['authorized', 'denied']).toContain(finalStatus)
    expect(
      f.tables.authorization_decisions.filter((d) => d.decided_by === 'human'),
      '只允许留下一条人签的决策',
    ).toHaveLength(1)
    expectNothingExecuted(f, capabilityCalls)
  })
})

describe('K-WP01A · 已经有结论的 run 不能再处理', () => {
  it.each([
    ['authorized', 'authorized'],
    ['running', 'running'],
    ['succeeded', 'succeeded'],
    ['denied', 'denied'],
  ])('🔴 状态是 %s 时，同意与不做都被拒（not_pending）', async (_label, status) => {
    const { f, runId, expectedDecisionId } = await pendingFixture()
    f.tables.action_runs[0].status = status

    for (const resolution of ['approve', 'reject'] as const) {
      const err = await decideApproval(f.kernel, {
        run: { ...(await loadRunForApproval(f.supabase, runId)) },
        actorEmail: ACTOR,
        input: {
          resolution,
          expectedDecisionId,
          ...(resolution === 'reject' ? { reason: '不做' } : {}),
        },
      }).catch((e: unknown) => e)

      expect(err).toBeInstanceOf(ApprovalError)
      expect((err as ApprovalError).code).toBe('not_pending')
      expect((err as ApprovalError).status).toBe(409)
    }
    // 状态没被这两次尝试改掉
    expect(f.tables.action_runs[0].status).toBe(status)
    expect(
      f.tables.authorization_decisions.filter((d) => d.decided_by === 'human'),
    ).toHaveLength(0)
  })

  it('详情接口对已经有结论的 run 同样答 not_pending，不假装还在等', async () => {
    const { f, runId } = await pendingFixture()
    f.tables.action_runs[0].status = 'succeeded'
    const run = await loadRunForApproval(f.supabase, runId)
    await expect(buildApprovalDetail(f.supabase, run)).rejects.toMatchObject({
      code: 'not_pending',
    })
  })
})

describe('K-WP01A · 跨客户隔离', () => {
  it('🔴 A 客户的待审批不出现在 B 客户的列表里', async () => {
    const { f } = await pendingFixture()

    const forA = await listPendingApprovals(f.supabase, CLIENT_A)
    expect(forA.items).toHaveLength(1)
    expect(forA.items[0].clientId).toBe(CLIENT_A)

    const forB = await listPendingApprovals(f.supabase, CLIENT_B)
    expect(forB.items, 'B 客户看不到 A 客户的东西').toEqual([])
    expect(forB.skippedRunIds).toEqual([])
  })

  it('列表里每条都带着提交决定要用的 expectedDecisionId 和词汇表字段', async () => {
    const { f, expectedDecisionId } = await pendingFixture()
    const { items } = await listPendingApprovals(f.supabase, CLIENT_A)
    const item = items[0]
    expect(item.expectedDecisionId).toBe(expectedDecisionId)
    expect(item.actionKey).toBe(KEY)
    expect(item.title).toBe(ACTION_REGISTRY.get(KEY)!.title)
    expect(item.sideEffect).toBe('internal_write')
    expect(item.requiredCapabilityTier).toBe('paid_client')
  })

  it('🔴 内核已启用但这个客户没有待审批 → 空列表（这跟「没启用」是两回事）', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: () => ({}),
      options: { policy: APPROVAL_POLICY },
    })
    const { items, skippedRunIds } = await listPendingApprovals(f.supabase, CLIENT_A)
    expect(items).toEqual([])
    expect(skippedRunIds).toEqual([])
  })

  it('🔴 指针指着的审批请求读不回来的 run 进 skipped，不冒充一条能点的待办', async () => {
    const { f } = await pendingFixture()
    // 决策行没了（数据不一致）——这条不能带着一个编出来的 id 出现在列表里
    f.tables.authorization_decisions.length = 0
    const { items, skippedRunIds } = await listPendingApprovals(f.supabase, CLIENT_A)
    expect(items).toEqual([])
    expect(skippedRunIds).toHaveLength(1)
  })
})
