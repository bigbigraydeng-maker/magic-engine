/**
 * POST /api/clients/[id]/ad-health/auto-pause/[runId]/decision
 *
 * 🔴 锁住三件事：
 *   ① 没带 / 带歪「页面上看到的那份审批请求 id」→ 400，**连 Kernel 都不建**；
 *   ② 带上了 → 原样（归一小写）交给批准 / 驳回；
 *   ③ 批准过注册表定的档次闸 —— 这里是这个动作唯一的批准入口，门槛必须跟着
 *      注册表走（注册表提到 admin 时付费客户账号拿 403），不能靠
 *      `requirePaidClientAccess` 碰巧一样。驳回不过这道。
 * 档次闸用真的 `kernel-approval/service`，不 mock —— mock 掉就测不到它。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { KernelError } from '@/lib/kernel/errors'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const RUN_ID = 'aaaaaaaa-0000-4000-8000-000000000001'
const SEEN = '11111111-2222-4333-8444-555555555555'

const ledgerWrites: string[] = vi.hoisted(() => [])

const m = vi.hoisted(() => ({
  access: vi.fn(),
  createKernel: vi.fn(),
  requireRun: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({ requirePlanApproverAccess: m.access }))
vi.mock('@/lib/kernel', () => ({ createKernel: m.createKernel }))
vi.mock('@/lib/action-submission/ads-auto-pause', () => ({
  ADS_AUTO_PAUSE_ACTION_KEY: 'ads.auto_pause_on_d3',
  approveAndExecuteAdsAutoPause: m.approve,
  rejectAdsAutoPause: m.reject,
}))
vi.mock('@/lib/supabase', () => {
  // 账表回写：有一行账；update 收到的 payload 记进 ledgerWrites，好断言记了什么
  const chain: Record<string, unknown> = {}
  for (const k of ['select', 'eq']) chain[k] = () => chain
  chain.update = (patch: { payload: { status: string } }) => {
    ledgerWrites.push(patch.payload.status)
    return chain
  }
  chain.maybeSingle = async () => ({ data: { id: 'fa-1', payload: {} }, error: null })
  return { supabaseAdmin: { from: () => chain } }
})

import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { POST } from './route'

const kernel = { requireRun: m.requireRun }

function post(body: unknown) {
  return POST(
    new NextRequest(`http://localhost/api/clients/${CLIENT}/ad-health/auto-pause/${RUN_ID}/decision`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: { id: CLIENT, runId: RUN_ID } },
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
  for (const fn of Object.values(m)) fn.mockReset()
  m.access.mockResolvedValue({ ok: true, tier: 'paid_client', user: { email: 'fde@magicengine.cloud' } })
  m.createKernel.mockReturnValue(kernel)
  m.requireRun.mockResolvedValue({
    id: RUN_ID, client_id: CLIENT, action_key: 'ads.auto_pause_on_d3',
    action_version: ACTION_REGISTRY.get('ads.auto_pause_on_d3')!.version,
  })
  m.approve.mockResolvedValue({ runId: RUN_ID, kind: 'succeeded', humanReason: null })
  m.reject.mockResolvedValue({ runId: RUN_ID, kind: 'denied', humanReason: '不批准' })
  ledgerWrites.length = 0
})

describe('① 没带看到的那份 → 400，连 Kernel 都不建', () => {
  it.each([
    ['缺字段', { resolution: 'approve' }],
    ['空字符串', { resolution: 'approve', expectedDecisionId: '' }],
    ['不是 uuid', { resolution: 'approve', expectedDecisionId: 'dec-1' }],
    ['驳回也要带', { resolution: 'reject', reason: '不要' }],
  ])('%s', async (_label, body) => {
    const res = await post(body)
    expect(res.status).toBe(400)
    expect(m.createKernel).not.toHaveBeenCalled()
    expect(m.approve).not.toHaveBeenCalled()
    expect(m.reject).not.toHaveBeenCalled()
  })
})

describe('② 带上了 → 原样交下去', () => {
  it('批准：带着看到的那份（归一小写）', async () => {
    const res = await post({ resolution: 'approve', expectedDecisionId: SEEN.toUpperCase() })
    expect(res.status).toBe(200)
    expect(m.approve).toHaveBeenCalledWith(kernel, RUN_ID, 'fde@magicengine.cloud', SEEN)
  })

  it('驳回：带着看到的那份', async () => {
    const res = await post({ resolution: 'reject', expectedDecisionId: SEEN, reason: '数据是暂时的' })
    expect(res.status).toBe(200)
    expect(m.reject).toHaveBeenCalledWith(kernel, RUN_ID, 'fde@magicengine.cloud', '数据是暂时的', SEEN)
  })

  it('Kernel 说「你看的不是最新的」→ 409 + code，页面据此重拉', async () => {
    m.approve.mockRejectedValueOnce(new KernelError('STALE_DECISION', '看到的那份已经不是最新的了'))
    const res = await post({ resolution: 'approve', expectedDecisionId: SEEN })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('STALE_DECISION')
  })
})

describe('S2 非内部账号：批准和驳回都挡', () => {
  it.each(['approve', 'reject'] as const)('🔴 %s → 403，连 Kernel 都不建', async (resolution) => {
    m.access.mockResolvedValue({ ok: false, status: 403, error: '批准和修改推广计划需要 Magic Lab 内部账号', reason: 'approver_only' })
    const res = await post({ resolution, expectedDecisionId: SEEN, reason: '不要' })
    expect(res.status).toBe(403)
    expect(m.createKernel).not.toHaveBeenCalled()
    expect(m.approve).not.toHaveBeenCalled()
    expect(m.reject).not.toHaveBeenCalled()
  })
})

describe('③ 批准过注册表定的档次闸', () => {
  function requireAdmin() {
    const real = ACTION_REGISTRY.get('ads.auto_pause_on_d3')!
    vi.spyOn(ACTION_REGISTRY, 'get').mockImplementation((key: string) =>
      key === 'ads.auto_pause_on_d3' ? { ...real, requiredCapabilityTier: 'admin' } : null,
    )
  }

  it('🔴 注册表门槛提到 admin → 付费客户账号批准拿 403，一步都不执行', async () => {
    requireAdmin()
    const res = await post({ resolution: 'approve', expectedDecisionId: SEEN })
    expect(res.status).toBe(403)
    expect(m.approve).not.toHaveBeenCalled()
  })

  it('同样门槛下驳回照常（不授权任何执行）', async () => {
    requireAdmin()
    const res = await post({ resolution: 'reject', expectedDecisionId: SEEN, reason: '不要' })
    expect(res.status).toBe(200)
    expect(m.reject).toHaveBeenCalled()
  })

  it('admin 账号在 admin 门槛下能批', async () => {
    requireAdmin()
    m.access.mockResolvedValue({ ok: true, tier: 'admin', user: { email: 'ray@magiclab' } })
    const res = await post({ resolution: 'approve', expectedDecisionId: SEEN })
    expect(res.status).toBe(200)
    expect(m.approve).toHaveBeenCalled()
  })
})

describe('账表只记确定的结果', () => {
  it.each([
    ['succeeded', 'paused', true],
    ['idempotent_hit', 'paused', true],
    ['dead_letter', 'failed', false],
  ])('%s → 记 %s', async (kind, status, ok) => {
    m.approve.mockResolvedValueOnce({ runId: RUN_ID, kind, humanReason: null })
    const res = await post({ resolution: 'approve', expectedDecisionId: SEEN })
    expect(ledgerWrites).toEqual([status])
    expect((await res.json()).ok).toBe(ok)
  })

  it('🔴 in_progress（别人刚批了、正在执行）→ 不记「失败」，账一个字不动', async () => {
    m.approve.mockResolvedValueOnce({ runId: RUN_ID, kind: 'in_progress', humanReason: null })
    const res = await post({ resolution: 'approve', expectedDecisionId: SEEN })
    expect((await res.json()).kind).toBe('in_progress')
    expect(ledgerWrites).toEqual([])
  })
})
