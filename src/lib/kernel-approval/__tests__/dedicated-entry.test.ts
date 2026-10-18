/**
 * 通用审批面 × 专属审批入口。
 *
 * 🔴 有专属入口的动作（登记在 `kernel/dedicated-approval-entries.ts`），通用面：
 *    · 不给批（它只签不执行 —— 批了广告也不会停，专属页那条反而再也批不了）；
 *    · 给去专属页的链接；
 *    · 拒绝照旧允许（「拒绝永远允许」不变量）。
 *    服务端两道都要站得住：`assertActorMayApprove`（路由那一行）+ `decideApproval` 自己。
 *
 * 🔴 专属入口自己的批准只过「版本 + 档次」（`assertActorMayApproveAction`），
 *    门槛读注册表 —— 注册表提到 admin 时，付费客户账号就必须批不了。
 *
 * 🔴 T8 用**满权限**（admin）账号断言 `reason==='dedicated_entry'`：用低档账号的话，
 *    忘写专属入口那一层也会因为「档次不够」被挡，测试绿得毫无意义（魏征 2026-09-26）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ActionRun } from '@/lib/kernel/types'
import type { KernelDeps } from '@/lib/kernel/deps'

const { approveRun, rejectRun } = vi.hoisted(() => ({ approveRun: vi.fn(), rejectRun: vi.fn() }))
vi.mock('@/lib/kernel/human-approval', () => ({ approveRun, rejectRun }))

import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import {
  approvalPermissionsFor,
  assertActorMayApprove,
  assertActorMayApproveAction,
  decideApproval,
} from '../service'
import { ApprovalError } from '../errors'

const D3 = 'ads.auto_pause_on_d3'
const OTHER = 'seo.build_publish_package'
const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const SEEN = '11111111-2222-4333-8444-555555555555'

function runOf(actionKey: string, overrides: Partial<ActionRun> = {}): ActionRun {
  return {
    id: 'aaaaaaaa-0000-4000-8000-000000000001', client_id: CLIENT, purpose: 'maintenance', goal_id: null,
    execution_item_id: null, triggered_by: 'signal', triggered_by_ref: null,
    action_key: actionKey, action_version: ACTION_REGISTRY.get(actionKey)!.version, input: {}, rationale: null,
    evidence: {}, idempotency_key: 'k1', status: 'pending_approval',
    authorization_decision_id: SEEN, correlation_id: 'c1', cost_cap_usd: null,
    cost_estimate_usd: null, needs_human: true, last_error: null, claimed_by: null,
    claimed_at: null, heartbeat_at: null, lease_expires_at: null, previous_claimed_by: null,
    reclaim_count: 0, last_reclaimed_at: null, claim_generation: 1,
    created_at: '2026-09-21T00:00:00Z', updated_at: '2026-09-21T00:00:00Z',
    started_at: null, finished_at: null,
    ...overrides,
  }
}

function caught(fn: () => void): ApprovalError {
  try {
    fn()
  } catch (e) {
    return e as ApprovalError
  }
  throw new Error('应该抛错却没抛')
}

beforeEach(() => {
  approveRun.mockReset()
  rejectRun.mockReset()
  vi.restoreAllMocks()
})

describe('通用面：有专属入口的动作不给批、给链接', () => {
  it('🔴 满权限账号看 D3 → 批不了，原因是 dedicated_entry，并给出专属页', () => {
    expect(approvalPermissionsFor(runOf(D3), 'admin')).toEqual({
      canApprove: false,
      canReject: true,
      approveBlockedReason: 'dedicated_entry',
      dedicatedEntry: { label: '广告门 ·「等你点头」', path: `/dashboard/clients/${CLIENT}/ads-health?tab=approvals` },
    })
  })

  it('🔴 满权限账号在通用面批 D3 → 服务端抛，文案说清去哪批', () => {
    const err = caught(() => assertActorMayApprove(runOf(D3), 'admin'))
    expect(err).toBeInstanceOf(ApprovalError)
    expect(err.code).toBe('forbidden_tier')
    expect(err.detail?.reason).toBe('dedicated_entry')
    expect(err.humanReason).toContain('广告门 ·「等你点头」')
  })

  it('没登记的动作 → 通用面照常能批，dedicatedEntry 为 null', () => {
    expect(approvalPermissionsFor(runOf(OTHER), 'admin')).toEqual({
      canApprove: true, canReject: true, approveBlockedReason: null, dedicatedEntry: null,
    })
  })
})

describe('decideApproval 自己也挡（不只靠路由那一行）', () => {
  const deps = {} as KernelDeps

  it('🔴 批 D3 → 抛 forbidden_tier，一步都不进 Kernel', async () => {
    await expect(
      decideApproval(deps, { run: runOf(D3), actorEmail: 'ray@magiclab', input: { resolution: 'approve', expectedDecisionId: SEEN } }),
    ).rejects.toMatchObject({ code: 'forbidden_tier' })
    expect(approveRun).not.toHaveBeenCalled()
  })

  it('拒 D3 → 照常交给 Kernel（拒绝永远允许）', async () => {
    rejectRun.mockResolvedValueOnce({ verdict: 'deny', decision: { id: 'd2', reason: '不做' } })
    await decideApproval(deps, {
      run: runOf(D3), actorEmail: 'ray@magiclab', input: { resolution: 'reject', expectedDecisionId: SEEN, reason: '不做' },
    })
    expect(rejectRun).toHaveBeenCalledWith(deps, runOf(D3).id, 'ray@magiclab', '不做', { expectedDecisionId: SEEN })
  })

  it('批没登记的动作 → 照常交给 Kernel 并带上看到的那份', async () => {
    approveRun.mockResolvedValueOnce({ verdict: 'allow', decision: { id: 'd2', reason: 'ok' } })
    await decideApproval(deps, {
      run: runOf(OTHER), actorEmail: 'ray@magiclab', input: { resolution: 'approve', expectedDecisionId: SEEN },
    })
    expect(approveRun).toHaveBeenCalledWith(deps, runOf(OTHER).id, 'ray@magiclab', {
      expectedDecisionId: SEEN, reason: undefined,
    })
  })
})

describe('专属入口的批准闸：版本 + 档次，读注册表', () => {
  it('付费客户账号 + 注册表门槛 paid_client → 放行', () => {
    expect(() => assertActorMayApproveAction(runOf(D3), 'paid_client')).not.toThrow()
  })

  it('自助档账号 → insufficient_tier', () => {
    expect(caught(() => assertActorMayApproveAction(runOf(D3), 'self_serve')).detail?.reason).toBe('insufficient_tier')
  })

  it('run 按旧版契约排的 → unknown_action_version', () => {
    const stale = runOf(D3, { action_version: runOf(D3).action_version + 1 })
    expect(caught(() => assertActorMayApproveAction(stale, 'admin')).detail?.reason).toBe('unknown_action_version')
  })

  it('🔴 注册表把门槛提到 admin → 付费客户账号批不了，admin 能批', () => {
    const real = ACTION_REGISTRY.get(D3)!
    vi.spyOn(ACTION_REGISTRY, 'get').mockImplementation((key: string) =>
      key === D3 ? { ...real, requiredCapabilityTier: 'admin' } : null,
    )
    expect(caught(() => assertActorMayApproveAction(runOf(D3), 'paid_client')).detail?.reason).toBe('insufficient_tier')
    expect(() => assertActorMayApproveAction(runOf(D3), 'admin')).not.toThrow()
  })
})
