/**
 * Caller 的行为单元测试 —— fail-closed 前置检查 + Kernel outcome 分派。
 *
 * 🔴 用注入的 mock deps（不跑真 Kernel、不接 supabase）。
 *    真 Kernel 集成验证在 `kernel-progression.test.ts` 里。
 */

import { describe, it, expect, vi } from 'vitest'
import { submitPageOptimizationRequest } from '..'
import type {
  PageOptimizationRequestCallerDeps,
  SubmitPageOptimizationRequestInput,
} from '../types'
import { KernelError } from '@/lib/kernel/errors'
import type { ActionRunOutcome, SubmitActionInput } from '@/lib/kernel/runner'
import type { ActionRun } from '@/lib/kernel/types'
import type { KernelDeps } from '@/lib/kernel/deps'
import type { PageOptimizationRequest } from '@/lib/page-optimization'
import type { CandidateMappingResult } from '@/lib/action-bridge'

const CLIENT_A = 'c11e0000-0000-4000-8000-00000000000a'
const CLIENT_B = 'c11e0000-0000-4000-8000-00000000000b'
const GOAL_A = '90a10000-0000-4000-8000-00000000000a'

// —— 造夹具 ────────────────────────────────────────────────────────────────

function makeRequest(
  overrides: Partial<PageOptimizationRequest> = {},
): PageOptimizationRequest {
  return {
    clientId: CLIENT_A,
    page: { url: 'https://client.example/page/x' },
    intents: [
      {
        field: 'meta_title',
        proposedValue: 'A better title',
        semanticIntent: { known: true, value: 'clarify intent' },
      },
    ],
    lineage: { findingRefs: ['finding-1'] },
    verification: {
      // GrowthVerificationDefinition —— shape 由 growth 契约保证，本 caller 不 assert 内容
      kind: 'assertion',
      description: 'test verification',
    } as unknown as PageOptimizationRequest['verification'],
    constraints: { doNotTouch: [] },
    basedOnVersion: { known: true, value: 'v-1' },
    ...overrides,
  }
}

function makeInput(
  overrides: Partial<SubmitPageOptimizationRequestInput> = {},
): SubmitPageOptimizationRequestInput {
  return {
    candidateIdentity: { domain: 'test-domain', intent: 'test-intent' },
    request: makeRequest(),
    kernelMeta: {
      clientId: CLIENT_A,
      purpose: 'growth',
      goalId: GOAL_A,
      triggeredBy: 'human',
      rationale: 'unit test',
    },
    precomputed: { validatedDiffHash: 'sha256:precomputed-by-trigger' },
    ...overrides,
  }
}

/** 一个能被 vitest spy 观测的 ActionRun 桩 —— 只填分派路径要用的字段。 */
function fakeRun(overrides: Partial<ActionRun> = {}): ActionRun {
  return {
    id: 'run-abc',
    client_id: CLIENT_A,
    purpose: 'growth',
    goal_id: GOAL_A,
    execution_item_id: null,
    triggered_by: 'human',
    triggered_by_ref: null,
    action_key: 'test.stub',
    action_version: 1,
    input: {},
    rationale: null,
    evidence: {},
    idempotency_key: 'key-1',
    status: 'pending_approval',
    authorization_decision_id: 'decision-xyz',
    correlation_id: 'corr-1',
    cost_cap_usd: null,
    cost_estimate_usd: null,
    needs_human: true,
    last_error: null,
    claimed_by: null,
    claimed_at: null,
    heartbeat_at: null,
    lease_expires_at: null,
    previous_claimed_by: null,
    reclaim_count: 0,
    last_reclaimed_at: null,
    claim_generation: 1,
    created_at: '2026-08-19T00:00:00.000Z',
    updated_at: '2026-08-19T00:00:00.000Z',
    started_at: null,
    finished_at: null,
    ...overrides,
  }
}

const dummyKernelDeps = {} as KernelDeps

interface MakeDepsArgs {
  mapping?: CandidateMappingResult
  outcome?: ActionRunOutcome
  runActionImpl?: (kd: KernelDeps, i: SubmitActionInput) => Promise<ActionRunOutcome>
}

function makeDeps(args: MakeDepsArgs = {}): {
  deps: PageOptimizationRequestCallerDeps
  mapCandidate: ReturnType<typeof vi.fn>
  runAction: ReturnType<typeof vi.fn>
} {
  const mapping: CandidateMappingResult =
    args.mapping ?? { outcome: 'mapped', actionKey: 'test.stub' as never, actionVersion: 7 }
  const defaultOutcome: ActionRunOutcome = args.outcome ?? {
    kind: 'pending_approval',
    run: fakeRun(),
    decision: null,
    execution: null,
    humanReason: '等你点头',
  }
  const mapCandidate = vi.fn(() => mapping)
  const runAction = vi.fn(args.runActionImpl ?? (async () => defaultOutcome))
  return {
    deps: { kernelDeps: dummyKernelDeps, mapCandidate, runAction },
    mapCandidate,
    runAction,
  }
}

// —— fail-closed 前置检查 ─────────────────────────────────────────────────

describe('caller: fail-closed 前置检查', () => {
  it('client id 不一致 → 不调 bridge、不调 kernel', async () => {
    const { deps, mapCandidate, runAction } = makeDeps()
    const input = makeInput({
      request: makeRequest({ clientId: CLIENT_B }),
      kernelMeta: { ...makeInput().kernelMeta, clientId: CLIENT_A },
    })

    const result = await submitPageOptimizationRequest(deps, input)

    expect(result).toEqual({
      ok: false,
      reason: 'client_id_mismatch',
      requestClientId: CLIENT_B,
      kernelMetaClientId: CLIENT_A,
    })
    expect(mapCandidate).not.toHaveBeenCalled()
    expect(runAction).not.toHaveBeenCalled()
  })

  it('basedOnVersion.known === false → 不调 bridge、不调 kernel', async () => {
    const { deps, mapCandidate, runAction } = makeDeps()
    const input = makeInput({
      request: makeRequest({
        basedOnVersion: { known: false, reason: 'not_recorded_by_source' },
      }),
    })

    const result = await submitPageOptimizationRequest(deps, input)

    expect(result).toEqual({ ok: false, reason: 'basedOnVersion_unknown' })
    expect(mapCandidate).not.toHaveBeenCalled()
    expect(runAction).not.toHaveBeenCalled()
  })
})

// —— Bridge rejection ─────────────────────────────────────────────────────

describe('caller: bridge rejected → 结构化拒绝，不调 kernel', () => {
  const cases: Array<{ label: string; code: 'malformed_identity' | 'unmapped_identity' | 'registry_drift' }> = [
    { label: 'malformed_identity', code: 'malformed_identity' },
    { label: 'unmapped_identity', code: 'unmapped_identity' },
    { label: 'registry_drift', code: 'registry_drift' },
  ]

  it.each(cases)('$label → bridge_rejected 透传 code + reason', async ({ code }) => {
    const { deps, runAction } = makeDeps({
      mapping: { outcome: 'rejected', code, reason: `bridge says ${code}` },
    })

    const result = await submitPageOptimizationRequest(deps, makeInput())

    expect(result).toEqual({
      ok: false,
      reason: 'bridge_rejected',
      bridgeCode: code,
      bridgeReason: `bridge says ${code}`,
    })
    expect(runAction).not.toHaveBeenCalled()
  })
})

// —— submit shape 绑定 ────────────────────────────────────────────────────

describe('caller: SubmitActionInput 构造', () => {
  it('ActionKey 从 bridge 拿，不 hardcode（mapper 返回什么，submit 就带什么）', async () => {
    const { deps, runAction } = makeDeps({
      mapping: { outcome: 'mapped', actionKey: 'anything.the.mapper.gives' as never, actionVersion: 42 },
    })

    await submitPageOptimizationRequest(deps, makeInput())

    expect(runAction).toHaveBeenCalledTimes(1)
    const submit = runAction.mock.calls[0][1] as SubmitActionInput
    expect(submit.actionKey).toBe('anything.the.mapper.gives')
  })

  it('precomputed.validatedDiffHash 原样绑定，不重算', async () => {
    const { deps, runAction } = makeDeps()
    const hash = 'sha256:trigger-computed-this'
    await submitPageOptimizationRequest(deps, makeInput({ precomputed: { validatedDiffHash: hash } }))

    const submit = runAction.mock.calls[0][1] as SubmitActionInput
    expect(submit.input.validated_diff_hash).toBe(hash)
  })

  it('input 里带 spec §7 的五个字段，且 intents 引用未 mutate', async () => {
    const { deps, runAction } = makeDeps()
    const req = makeRequest()
    await submitPageOptimizationRequest(deps, makeInput({ request: req }))

    const submit = runAction.mock.calls[0][1] as SubmitActionInput
    expect(submit.input).toEqual({
      page_url: req.page.url,
      page_version_token: (req.basedOnVersion as { known: true; value: string }).value,
      validated_diff_hash: 'sha256:precomputed-by-trigger',
      intents: req.intents,
      do_not_touch: req.constraints.doNotTouch,
    })
    // 引用相等 —— 没被复制、没被改写
    expect(submit.input.intents).toBe(req.intents)
  })

  it('kernelMeta 里的 clientId / purpose / goalId / triggeredBy 原样透传', async () => {
    const { deps, runAction } = makeDeps()
    await submitPageOptimizationRequest(deps, makeInput())

    const submit = runAction.mock.calls[0][1] as SubmitActionInput
    expect(submit.clientId).toBe(CLIENT_A)
    expect(submit.purpose).toBe('growth')
    expect(submit.goalId).toBe(GOAL_A)
    expect(submit.triggeredBy).toBe('human')
  })
})

// —— Kernel outcome 分派 ──────────────────────────────────────────────────

describe('caller: Kernel outcome 分派', () => {
  it('pending_approval + authorization_decision_id 非空 → ok:true + id 透传', async () => {
    const run = fakeRun({ authorization_decision_id: 'decision-42' })
    const { deps } = makeDeps({
      outcome: { kind: 'pending_approval', run, decision: null, execution: null, humanReason: '等' },
    })

    const result = await submitPageOptimizationRequest(deps, makeInput())

    expect(result).toEqual({
      ok: true,
      outcome: 'pending_approval',
      runId: run.id,
      authorizationDecisionId: 'decision-42',
    })
  })

  it('🔴 pending_approval + authorization_decision_id === null → fail closed（Queue 会静默跳过这种 run）', async () => {
    // Kernel 报 pending_approval 但 run 上没有 decision id，是库里状态不一致。
    // 如果 caller 报 ok:true，触发端去看 Approval Queue 时根本看不到这条
    // （queries.ts:283 的 listPendingApprovals 会把它记进 skippedRunIds、不放
    // 进 items）—— 这是隐形失败：承诺"能被人点头"却根本没进队列。
    const run = fakeRun({ authorization_decision_id: null })
    const { deps } = makeDeps({
      outcome: { kind: 'pending_approval', run, decision: null, execution: null, humanReason: '等' },
    })

    const result = await submitPageOptimizationRequest(deps, makeInput())

    expect(result).toEqual({
      ok: false,
      reason: 'kernel_inconsistent_pending_approval',
      runId: run.id,
    })
  })

  it('denied → kernel_denied + humanReason 透传', async () => {
    const run = fakeRun({ status: 'denied' })
    const { deps } = makeDeps({
      outcome: {
        kind: 'denied',
        run,
        decision: null,
        execution: null,
        humanReason: '客户没配规则',
      },
    })

    const result = await submitPageOptimizationRequest(deps, makeInput())

    expect(result).toEqual({
      ok: false,
      reason: 'kernel_denied',
      runId: run.id,
      humanReason: '客户没配规则',
    })
  })

  it('dead_letter → kernel_dead_letter', async () => {
    const run = fakeRun({ status: 'dead_letter' })
    const { deps } = makeDeps({
      outcome: {
        kind: 'dead_letter',
        run,
        decision: null,
        execution: null,
        humanReason: '崩了',
      },
    })

    const result = await submitPageOptimizationRequest(deps, makeInput())

    expect(result).toEqual({
      ok: false,
      reason: 'kernel_dead_letter',
      runId: run.id,
      humanReason: '崩了',
    })
  })

  const unexpectedCases: Array<{ kind: ActionRunOutcome['kind'] }> = [
    { kind: 'succeeded' },
    { kind: 'idempotent_hit' },
    { kind: 'in_progress' },
  ]

  it.each(unexpectedCases)(
    '$kind → kernel_unexpected_outcome（对 outward+require_approval 不该出现，不粉饰成 ok:true）',
    async ({ kind }) => {
      const run = fakeRun()
      const { deps } = makeDeps({
        outcome: {
          kind,
          run,
          decision: null,
          execution: null,
          humanReason: null,
        },
      })

      const result = await submitPageOptimizationRequest(deps, makeInput())

      expect(result).toEqual({
        ok: false,
        reason: 'kernel_unexpected_outcome',
        runId: run.id,
        outcomeKind: kind,
      })
    },
  )
})

// —— KernelError 原样抛 ──────────────────────────────────────────────────

describe('caller: KernelError 不吞', () => {
  it('runAction 抛 KernelError → 原样抛给触发端，不吞不改', async () => {
    const err = new KernelError('INVALID_INPUT', '目标不存在')
    const { deps } = makeDeps({
      runActionImpl: async () => {
        throw err
      },
    })

    await expect(submitPageOptimizationRequest(deps, makeInput())).rejects.toBe(err)
  })
})
