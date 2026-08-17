/**
 * K-WP01A —— 「内核没启用」和「没有待审批」必须分得开。
 *
 * 🔴 生产的 Kernel 表**今天还不存在**（WP00 §9.1 的只读勘查结论）。
 *    所以这条路上最容易出的错是：查询报「表不存在」→ 被 catch 吞掉 → 返回 `[]`
 *    → 界面显示「没有待办，一切正常」。
 *    那句「一切正常」是假的：这套东西整个没打开，任何等人点头的动作
 *    **永远不会出现在这里**，而且没有任何人看得出少了东西。
 *
 * 🔴 所以「空」的三条来路要各测一次：
 *      ① 表不存在        → 503 kernel_not_provisioned
 *      ② 表在、没有行    → `[]`
 *      ③ 其它查询错误    → 原样抛（→ 500），**绝不降级成 ①，也绝不吞成 ②**
 */

import { describe, it, expect } from 'vitest'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { makeFixture, CLIENT_A } from '@/lib/kernel/__tests__/fixtures'
import { ApprovalError, isKernelNotProvisioned } from '../errors'
import { listPendingApprovals, loadRunForApproval } from '../service'

function fixtureFailingWith(message: string) {
  return makeFixture({
    registry: ACTION_REGISTRY,
    capabilities: () => ({}),
    options: {
      supabaseOptions: {
        failOn: [
          { table: 'action_runs', op: 'select', message },
          { table: 'authorization_decisions', op: 'select', message },
        ],
      },
    },
  })
}

describe('isKernelNotProvisioned · 判据', () => {
  it('🔴 认 PostgreSQL / PostgREST 的那几个码', () => {
    for (const code of ['42P01', '42883', 'PGRST202', 'PGRST205']) {
      expect(isKernelNotProvisioned({ code, message: '随便什么话' }), code).toBe(true)
    }
  })

  it('🔴 没有码的时候认明确的文案', () => {
    const messages = [
      'relation "public.action_runs" does not exist',
      'function public.kernel_resolve_pending_approval(uuid, uuid, text) does not exist',
      "Could not find the table 'public.action_runs' in the schema cache",
      "Could not find the function public.kernel_resolve_pending_approval in the schema cache",
    ]
    for (const message of messages) {
      expect(isKernelNotProvisioned({ message }), message).toBe(true)
    }
  })

  it('🔴 别的失败一律不算「没启用」—— 一次数据库抖动不许被答成「系统还没打开」', () => {
    const others = [
      { code: '57014', message: 'canceling statement due to statement timeout' },
      { code: '53300', message: 'too many connections for role' },
      { code: '42501', message: 'permission denied for table action_runs' },
      { message: 'fetch failed' },
      { message: 'JWT expired' },
      { message: '' },
      null,
      undefined,
      'relation does not exist',
    ]
    for (const err of others) {
      expect(isKernelNotProvisioned(err), JSON.stringify(err)).toBe(false)
    }
  })
})

describe('🔴 列表：三条「空」的来路各走各的', () => {
  it('① 表不存在 → 503 kernel_not_provisioned，不是 200 []', async () => {
    const f = fixtureFailingWith('relation "public.action_runs" does not exist')
    const err = await listPendingApprovals(f.supabase, CLIENT_A).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApprovalError)
    expect((err as ApprovalError).code).toBe('kernel_not_provisioned')
    expect((err as ApprovalError).status).toBe(503)
  })

  it('① 换成 schema cache 那种说法也一样', async () => {
    const f = fixtureFailingWith("Could not find the table 'public.action_runs' in the schema cache")
    await expect(listPendingApprovals(f.supabase, CLIENT_A)).rejects.toMatchObject({
      code: 'kernel_not_provisioned',
    })
  })

  it('② 表在、这个客户没有等审批的 → 200 []', async () => {
    const f = makeFixture({ registry: ACTION_REGISTRY, capabilities: () => ({}) })
    await expect(listPendingApprovals(f.supabase, CLIENT_A)).resolves.toMatchObject({
      items: [],
      skippedRunIds: [],
      hasMore: false,
    })
  })

  it('🔴 ③ 别的查询错误原样抛（→ 500），不降级成 503，也不吞成 []', async () => {
    const f = fixtureFailingWith('canceling statement due to statement timeout')
    const err = await listPendingApprovals(f.supabase, CLIENT_A).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err, '超时被答成「系统还没启用」= 拿一句好听的话盖住真实故障').not.toBeInstanceOf(
      ApprovalError,
    )
    expect(String((err as Error).message)).toContain('statement timeout')
  })
})

describe('🔴 详情：同样三条来路', () => {
  it('① 表不存在 → 503，不是 404', async () => {
    const f = fixtureFailingWith('relation "public.action_runs" does not exist')
    const err = await loadRunForApproval(f.supabase, 'run-1').catch((e: unknown) => e)
    expect((err as ApprovalError).code).toBe('kernel_not_provisioned')
  })

  it('② 表在、这条 run 不存在 → 404 not_found（跟「没启用」是两回事）', async () => {
    const f = makeFixture({ registry: ACTION_REGISTRY, capabilities: () => ({}) })
    const err = await loadRunForApproval(f.supabase, 'run-does-not-exist').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApprovalError)
    expect((err as ApprovalError).code).toBe('not_found')
    expect((err as ApprovalError).status).toBe(404)
  })

  it('③ 别的错误原样抛', async () => {
    const f = fixtureFailingWith('too many connections for role')
    const err = await loadRunForApproval(f.supabase, 'run-1').catch((e: unknown) => e)
    expect(err).not.toBeInstanceOf(ApprovalError)
  })
})
