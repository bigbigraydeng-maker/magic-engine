/**
 * K-WP01A 回归闸 · **写路径的 CAS、竞态与失败落地**。
 *
 *   · 锁内政策竞态 → 非终态（run 还停在等审批，那件事还等着人点）
 *   · 表在但 RPC 不在 → 仍然是 503，不是 500（读写两条路的契约必须同向）
 *   · 批准时人写的备注 → 必须落库，不许静默丢弃
 *   · 批准的**失败落地**也要过指针闸 → 不许盖掉一份新的待审批请求
 *   · 一条保险：上面这些没把正常路径测坏
 */

import { describe, it, expect, vi } from 'vitest'
import { runAction } from '@/lib/kernel/runner'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { createCapabilities } from '@/lib/capabilities'
import { makeFixture } from '@/lib/kernel/__tests__/fixtures'
import { ApprovalError } from '../errors'
import { decideApproval, loadRunForApproval } from '../service'
import { ACTOR, APPROVAL_POLICY, KEY, pendingFixture, submit } from './_fixtures'


describe('🔴 Codex round 6 · 锁内政策竞态不是终态', () => {
  it.each([
    'no_active_policy',
    'policy_identity_changed',
    'stale_policy_version',
    'policy_mode_changed',
    // 🔴 政策在**等锁那段时间里过期**（挂钟复核出来的）。加这条 RPC 返回码时
    //    差点漏了这张映射表 —— 漏掉就会掉进 INVALID_STATE → 接口答终态的
    //    `not_pending`，界面把一条还等着人点的待办抹掉。
    'policy_expired_before_signing',
  ])('RPC 报「%s」→ stale_decision（不是「已经有结论了」），且 run 还停在等审批', async (reason) => {
    // 🔴 这几条 RPC 分支都是**只读返回、一个字不写** —— run 仍然停在
    //    pending_approval，那件事还等着人点。报成 not_pending 的话，
    //    界面会把一条还活着的待办从列表里抹掉。
    const { f, runId, expectedDecisionId } = await pendingFixture()
    const kernel = {
      ...f.kernel,
      supabase: {
        ...f.supabase,
        rpc: async (name: string) =>
          name === 'kernel_resolve_pending_approval_v2'
            ? { data: [{ ok: false, reason, decision_id: null }], error: null }
            : { data: [], error: null },
      },
    } as unknown as typeof f.kernel

    const err = await decideApproval(kernel, {
      run: await loadRunForApproval(f.supabase, runId),
      actorEmail: ACTOR,
      input: { resolution: 'approve', expectedDecisionId },
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApprovalError)
    expect((err as ApprovalError).code, `${reason} 不该被说成「已经有结论了」`).toBe(
      'stale_decision',
    )
    expect(f.tables.action_runs[0].status, 'run 必须还停在等审批').toBe('pending_approval')
    expect(
      f.tables.authorization_decisions.filter((d) => d.decided_by === 'human'),
    ).toHaveLength(0)
  })

  it('🔴 真正的终态仍然是 not_pending（判据不是把所有失败都说成「刷新一下」）', async () => {
    const { f, runId, expectedDecisionId } = await pendingFixture()
    const kernel = {
      ...f.kernel,
      supabase: {
        ...f.supabase,
        rpc: async () => ({
          data: [{ ok: false, reason: 'not_pending:succeeded', decision_id: null }],
          error: null,
        }),
      },
    } as unknown as typeof f.kernel
    const err = await decideApproval(kernel, {
      run: await loadRunForApproval(f.supabase, runId),
      actorEmail: ACTOR,
      input: { resolution: 'approve', expectedDecisionId },
    }).catch((e: unknown) => e)
    expect((err as ApprovalError).code).toBe('not_pending')
  })
})

// ── P2-3 ─────────────────────────────────────────────────────────────────────

describe('🔴 Codex P2-3 · 表在但 RPC 不在 → 仍然是 503，不是 500', () => {
  it('提交决定时 RPC 缺失 → kernel_not_provisioned', async () => {
    const { f, runId, expectedDecisionId } = await pendingFixture()
    // 表全都读得到（前面的 loadRun 就是证据），只有这个函数不存在
    const kernel = {
      ...f.kernel,
      supabase: {
        ...f.supabase,
        rpc: async () => ({
          data: null,
          error: {
            code: '42883',
            message:
              'function public.kernel_resolve_pending_approval(uuid, uuid, text, text, text, jsonb, numeric) does not exist',
          },
        }),
      },
    } as unknown as typeof f.kernel

    const run = await loadRunForApproval(f.supabase, runId)
    const err = await decideApproval(kernel, {
      run,
      actorEmail: ACTOR,
      input: { resolution: 'approve', expectedDecisionId },
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApprovalError)
    expect((err as ApprovalError).code).toBe('kernel_not_provisioned')
    expect((err as ApprovalError).status).toBe(503)
    // 什么都没被改动
    expect(f.tables.action_runs[0].status).toBe('pending_approval')
    expect(
      f.tables.authorization_decisions.filter((d) => d.decided_by === 'human'),
    ).toHaveLength(0)
  })

  it('🔴 别的 RPC 失败仍然是 500 —— 不许把任意故障都说成「还没启用」', async () => {
    const { f, runId, expectedDecisionId } = await pendingFixture()
    const kernel = {
      ...f.kernel,
      supabase: {
        ...f.supabase,
        rpc: async () => ({
          data: null,
          error: { code: '57014', message: 'canceling statement due to statement timeout' },
        }),
      },
    } as unknown as typeof f.kernel

    const err = await decideApproval(kernel, {
      run: await loadRunForApproval(f.supabase, runId),
      actorEmail: ACTOR,
      input: { resolution: 'approve', expectedDecisionId },
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(ApprovalError)
    expect(String((err as Error).message)).toContain('statement timeout')
  })
})

// ── Codex 对 #961 那一轮另外两条（机器人已发现，这里按正确方式修 + 盯住） ──────

describe('🔴 批准时写的备注不许被静默丢弃', () => {
  it('approve 带 reason → 落进 append-only 决策记录', async () => {
    const { f, runId, expectedDecisionId } = await pendingFixture()
    await decideApproval(f.kernel, {
      run: await loadRunForApproval(f.supabase, runId),
      actorEmail: ACTOR,
      input: { resolution: 'approve', expectedDecisionId, reason: '跟客户电话确认过了' },
    })
    const allow = f.tables.authorization_decisions.find(
      (d) => d.verdict === 'allow' && d.decided_by === 'human',
    )!
    expect(
      String(allow.reason),
      '接口按契约收下了这段话，审计表里必须找得到它 —— 否则就是静默丢弃',
    ).toContain('跟客户电话确认过了')
  })

  it('approve 不带 reason 时照常有自动生成的理由（不因此变空）', async () => {
    const { f, runId, expectedDecisionId } = await pendingFixture()
    await decideApproval(f.kernel, {
      run: await loadRunForApproval(f.supabase, runId),
      actorEmail: ACTOR,
      input: { resolution: 'approve', expectedDecisionId },
    })
    const allow = f.tables.authorization_decisions.find(
      (d) => d.verdict === 'allow' && d.decided_by === 'human',
    )!
    expect(String(allow.reason)).toContain(ACTOR)
    expect(String(allow.reason).length).toBeGreaterThan(10)
  })
})

describe('🔴 批准的**失败落地**也要过指针闸（不许盖掉一份新的待审批请求）', () => {
  it('preflight 期间这条 run 被重新排成另一份请求 → 失败落地被 CAS 挡住，新请求毫发无损', async () => {
    // 形状：人点了同意 → preflight 读政策时发现政策没了（会走 recordDeny）——
    // 但就在这中间，系统把这条 run 重新排了一次，挂上了**另一份**待审批请求。
    // 只有状态闸的话，状态仍是 pending_approval，于是那份**新的、还没人看过的**
    // 请求会被这次迟到的「批不了」直接盖成 denied。
    // 🔴 钩子必须**等这条 run 真的挂起之后**才上膛：`runAction` 自己也要读政策，
    //    不上膛的话第一次触发发生在挂起之前，整条 run 直接被拒，测的就不是这件事了。
    let armed = false
    let swapped = false
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: (sb) => ({ [KEY]: createCapabilities(sb)[KEY] }),
      options: {
        policy: APPROVAL_POLICY,
        supabaseOptions: {
          beforeOp: (table, op) => {
            // 政策被读之后、落拒绝之前，插一脚把 run 重新排一次
            if (!armed || swapped || table !== 'client_automation_policies' || op !== 'select') return
            swapped = true
            f.tables.client_automation_policies.length = 0 // 让 preflight 失败
            const run = f.tables.action_runs[0]
            f.tables.authorization_decisions.push({
              ...f.tables.authorization_decisions.find(
                (d) => d.id === run.authorization_decision_id,
              )!,
              id: '0d000000-0000-4000-8000-0000000e1550',
            })
            run.authorization_decision_id = '0d000000-0000-4000-8000-0000000e1550'
          },
        },
      },
    })
    const pending = await runAction(f.kernel, submit())
    expect(pending.kind).toBe('pending_approval')
    const runId = String(f.tables.action_runs[0].id)
    const expectedDecisionId = String(f.tables.action_runs[0].authorization_decision_id)
    armed = true

    const err = await decideApproval(f.kernel, {
      run: await loadRunForApproval(f.supabase, runId),
      actorEmail: ACTOR,
      input: { resolution: 'approve', expectedDecisionId },
    }).catch((e: unknown) => e)

    expect(swapped, '这条测试必须真的走到那个缝 —— 否则它什么都没验').toBe(true)
    expect(err).toBeInstanceOf(ApprovalError)
    expect((err as ApprovalError).code).toBe('stale_decision')

    // 🔴 那份新排的请求**毫发无损**：run 还停在等审批，指针还指着它
    expect(f.tables.action_runs[0].status).toBe('pending_approval')
    expect(f.tables.action_runs[0].authorization_decision_id).toBe('0d000000-0000-4000-8000-0000000e1550')
    expect(
      f.tables.authorization_decisions.filter((d) => d.verdict === 'deny'),
      '一条 deny 都不许落 —— 落了就等于把别人正在看的那件事替他否了',
    ).toHaveLength(0)
  })
})

// ── 一条保险：上面这些没把「正常路径」测坏 ───────────────────────────────────

describe('回归：正常审批链路仍然通', () => {
  it('同意 → authorized，一步都没跑', async () => {
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
      options: { policy: APPROVAL_POLICY },
    })
    await runAction(f.kernel, submit())
    const runId = String(f.tables.action_runs[0].id)
    const expectedDecisionId = String(f.tables.action_runs[0].authorization_decision_id)

    const result = await decideApproval(f.kernel, {
      run: await loadRunForApproval(f.supabase, runId),
      actorEmail: ACTOR,
      input: { resolution: 'approve', expectedDecisionId },
    })
    expect(result.finalStatus).toBe('authorized')
    expect(capabilityCalls).not.toHaveBeenCalled()
    expect(f.tables.action_run_steps).toHaveLength(0)
  })
})
