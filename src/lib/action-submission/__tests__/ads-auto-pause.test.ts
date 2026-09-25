/**
 * `ads-auto-pause.ts` caller —— submit / approve+execute / reject 的 outcome 分派。
 *
 * mock `@/lib/kernel/runner` 的三个 progression 函数（不跑真 Kernel），
 * 只验证这一层的分派逻辑（跟 `action-submission/__tests__/caller.test.ts`
 * 对 GEO caller 的验证同一个层次）。
 */
import { describe, it, expect, vi } from 'vitest'
import type { KernelDeps } from '@/lib/kernel/deps'
import type { ActionRunOutcome } from '@/lib/kernel/runner'
import type { ActionRun } from '@/lib/kernel/types'

const { runAction, approveAndRun, rejectPendingRun } = vi.hoisted(() => ({
  runAction: vi.fn(),
  approveAndRun: vi.fn(),
  rejectPendingRun: vi.fn(),
}))
vi.mock('@/lib/kernel/runner', () => ({ runAction, approveAndRun, rejectPendingRun }))

import { submitAdsAutoPauseCandidate, approveAndExecuteAdsAutoPause, rejectAdsAutoPause } from '../ads-auto-pause'

const dummyDeps = {} as KernelDeps

function fakeRun(overrides: Partial<ActionRun> = {}): ActionRun {
  return {
    id: 'run-1', client_id: 'client-1', purpose: 'maintenance', goal_id: null,
    execution_item_id: null, triggered_by: 'signal', triggered_by_ref: null,
    action_key: 'ads.auto_pause_on_d3', action_version: 1, input: {}, rationale: null,
    evidence: {}, idempotency_key: 'k1', status: 'pending_approval',
    authorization_decision_id: 'dec-1', correlation_id: 'c1', cost_cap_usd: null,
    cost_estimate_usd: null, needs_human: true, last_error: null, claimed_by: null,
    claimed_at: null, heartbeat_at: null, lease_expires_at: null, previous_claimed_by: null,
    reclaim_count: 0, last_reclaimed_at: null, claim_generation: 1,
    created_at: '2026-09-21T00:00:00Z', updated_at: '2026-09-21T00:00:00Z',
    started_at: null, finished_at: null,
    ...overrides,
  }
}

const baseInput = {
  clientId: 'client-1', adAccountId: '123456', adsetId: 'adset-1',
  diagnosisCode: 'D3', insightDate: '2026-09-21', triggeredByRef: 'narrative-1',
  rationale: '花钱没结果', evidence: {},
}

describe('submitAdsAutoPauseCandidate', () => {
  it('构造的 SubmitActionInput：purpose=maintenance（不是 growth，不挂 goalId）', async () => {
    runAction.mockResolvedValueOnce({
      kind: 'pending_approval', run: fakeRun(), decision: null, execution: null, humanReason: null,
    } satisfies ActionRunOutcome)
    await submitAdsAutoPauseCandidate(dummyDeps, baseInput)
    const submit = runAction.mock.calls.at(-1)![1]
    expect(submit.purpose).toBe('maintenance')
    expect(submit.goalId).toBeUndefined()
    expect(submit.actionKey).toBe('ads.auto_pause_on_d3')
    expect(submit.input).toEqual({
      ad_account_id: '123456', adset_id: 'adset-1', diagnosis_code: 'D3', insight_date: '2026-09-21',
    })
  })

  it('pending_approval + decision id 非空 → ok:true', async () => {
    runAction.mockResolvedValueOnce({
      kind: 'pending_approval', run: fakeRun({ authorization_decision_id: 'dec-42' }),
      decision: null, execution: null, humanReason: null,
    } satisfies ActionRunOutcome)
    const result = await submitAdsAutoPauseCandidate(dummyDeps, baseInput)
    expect(result).toEqual({ ok: true, outcome: 'pending_approval', runId: 'run-1', authorizationDecisionId: 'dec-42' })
  })

  it('🔴 pending_approval 但 decision id 为空 → fail closed（跟 GEO caller 同一条判据）', async () => {
    runAction.mockResolvedValueOnce({
      kind: 'pending_approval', run: fakeRun({ authorization_decision_id: null }),
      decision: null, execution: null, humanReason: null,
    } satisfies ActionRunOutcome)
    const result = await submitAdsAutoPauseCandidate(dummyDeps, baseInput)
    expect(result).toEqual({ ok: false, reason: 'kernel_inconsistent_pending_approval', runId: 'run-1' })
  })

  it('idempotent_hit → ok:true（同一天重复提交是正常事件，consumer 靠这个跳过）', async () => {
    runAction.mockResolvedValueOnce({
      kind: 'idempotent_hit', run: fakeRun({ status: 'succeeded' }), decision: null, execution: null, humanReason: null,
    } satisfies ActionRunOutcome)
    const result = await submitAdsAutoPauseCandidate(dummyDeps, baseInput)
    expect(result).toEqual({ ok: true, outcome: 'idempotent_hit', runId: 'run-1' })
  })

  it('denied → kernel_denied + humanReason 透传', async () => {
    runAction.mockResolvedValueOnce({
      kind: 'denied', run: fakeRun({ status: 'denied' }), decision: null, execution: null, humanReason: '没配规则',
    } satisfies ActionRunOutcome)
    const result = await submitAdsAutoPauseCandidate(dummyDeps, baseInput)
    expect(result).toEqual({ ok: false, reason: 'kernel_denied', runId: 'run-1', humanReason: '没配规则' })
  })

  it('succeeded（不该在提交阶段出现，因为动作要求 require_approval）→ kernel_unexpected_outcome', async () => {
    runAction.mockResolvedValueOnce({
      kind: 'succeeded', run: fakeRun({ status: 'succeeded' }), decision: null, execution: null, humanReason: null,
    } satisfies ActionRunOutcome)
    const result = await submitAdsAutoPauseCandidate(dummyDeps, baseInput)
    expect(result).toEqual({ ok: false, reason: 'kernel_unexpected_outcome', runId: 'run-1', outcomeKind: 'succeeded' })
  })
})

describe('approveAndExecuteAdsAutoPause', () => {
  it('一次调用签批准 + 执行（走 approveAndRun，不是先 approveRun 再另外触发）', async () => {
    approveAndRun.mockResolvedValueOnce({
      kind: 'succeeded', run: fakeRun({ status: 'succeeded' }), decision: null, execution: null, humanReason: null,
    } satisfies ActionRunOutcome)
    const result = await approveAndExecuteAdsAutoPause(dummyDeps, 'run-1', 'fde@magicengine.cloud')
    expect(approveAndRun).toHaveBeenCalledWith(dummyDeps, 'run-1', 'fde@magicengine.cloud')
    expect(result).toEqual({ runId: 'run-1', kind: 'succeeded', humanReason: null })
  })

  it('执行失败 → dead_letter 原样透传，不粉饰成成功', async () => {
    approveAndRun.mockResolvedValueOnce({
      kind: 'dead_letter', run: fakeRun({ status: 'dead_letter' }), decision: null, execution: null, humanReason: '暂停调用失败',
    } satisfies ActionRunOutcome)
    const result = await approveAndExecuteAdsAutoPause(dummyDeps, 'run-1', 'fde@magicengine.cloud')
    expect(result.kind).toBe('dead_letter')
  })
})

describe('rejectAdsAutoPause', () => {
  it('只签拒绝，不执行任何东西', async () => {
    rejectPendingRun.mockResolvedValueOnce({
      kind: 'denied', run: fakeRun({ status: 'denied' }), decision: null, execution: null, humanReason: '不批准',
    } satisfies ActionRunOutcome)
    const result = await rejectAdsAutoPause(dummyDeps, 'run-1', 'fde@magicengine.cloud', '数据看起来是暂时的')
    expect(rejectPendingRun).toHaveBeenCalledWith(dummyDeps, 'run-1', 'fde@magicengine.cloud', '数据看起来是暂时的')
    expect(result.kind).toBe('denied')
  })
})
