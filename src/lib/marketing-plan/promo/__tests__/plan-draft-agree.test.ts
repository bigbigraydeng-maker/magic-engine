import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KernelDeps } from '@/lib/kernel/deps'
import type { ApprovalVerdict, GateResult } from '../gates'

const mockApprove = vi.fn()
vi.mock('@/lib/marketing-plan/approve-plan', () => ({
  approvePlan: (...args: unknown[]) => mockApprove(...args),
}))

const mockIssue = vi.fn()
vi.mock('@/lib/confirmation-card', () => ({
  issueConfirmationCard: (...args: unknown[]) => mockIssue(...args),
}))

import { hardNotGreen } from '@/lib/marketing-plan/approve-plan-gates'
import {
  approvePlanWithAgree,
  draftPlanIdOf,
  noPlanDraftOutcome,
  PLAN_AGREE_NOT_ALLOWED,
  planAgreeFromMeta,
  storePlanAgreeOutcome,
} from '../plan-draft-agree'

const META = { plan_draft: { status: 'created', plan_id: 'plan-1' } }
const deps = {} as KernelDeps
const OPC = { kind: 'opc', email: 'ray@magiclab.example' } as const

function gate(over: Partial<GateResult>): GateResult {
  return {
    key: 'ads.account_usable', group: 'tool', label: '广告账户可用', hard: true, light: 'green',
    reason: '正常', how: '', evidence: 'unvalidated_default', as_of: null, ...over,
  }
}

function run(clicker: Parameters<typeof approvePlanWithAgree>[0]['clicker'] = OPC, meta: unknown = META) {
  return approvePlanWithAgree({
    clientId: 'client-1', generationMeta: meta, approvedBy: 'ray@magiclab.example', clicker, deps,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIssue.mockResolvedValue({ id: 'card-1' })
})

describe('plan rides along with agree', () => {
  it('approves the plan when every hard check is green, and asks for all-green', async () => {
    mockApprove.mockResolvedValue({ kind: 'approved', receipt: { content_hash: 'hash-1' } })
    const out = await run()
    expect(out.status).toBe('approved')
    expect(out.content_hash).toBe('hash-1')
    expect(mockApprove).toHaveBeenCalledWith(expect.objectContaining({ planId: 'plan-1', requireAllGreen: true }))
    expect(mockIssue).not.toHaveBeenCalled()
  })

  it('does not approve on yellow or red; issues the card instead', async () => {
    mockApprove.mockResolvedValue({
      kind: 'needs_confirmation',
      planStart: '2026-11-01',
      planEnd: '2026-11-30',
      checks: [gate({ light: 'yellow', reason: '预算快到上限' }), gate({ key: 'ads.cap_set', light: 'red', reason: '没设上限' })],
      contentHash: 'abc123abc123abcd',
    })
    const out = await run()
    expect(out.status).toBe('needs_confirmation')
    expect(out.card).toEqual({ id: 'card-1' })
    const facts = mockIssue.mock.calls[0][1].facts
    expect(facts.subjectKey).toBe('plan-approve:plan-1:abc123abc123abcd')
    expect(facts.hardChecks.map((c: { state: string }) => c.state)).toEqual(['unread', 'red'])
  })

  it('a hard red from the gates also goes to the card, never to approved', async () => {
    mockApprove.mockResolvedValue({
      kind: 'blocked', blockers: [gate({ light: 'red', reason: '账户停用' })],
      planStart: '2026-11-01', planEnd: '2026-11-30', contentHash: 'abc123abc123abcd',
    })
    const out = await run()
    expect(out.status).toBe('needs_confirmation')
    expect(mockIssue).toHaveBeenCalledTimes(1)
  })

  it('a second agree does not approve twice', async () => {
    mockApprove.mockResolvedValue({ kind: 'already_approved', plan: {}, existingTaskCount: 0 })
    const out = await run()
    expect(out.status).toBe('already_approved')
    expect(out.content_hash).toBeNull()
    expect(mockIssue).not.toHaveBeenCalled()
  })

  it.each([
    ['agent', { kind: 'agent', email: 'bot@x.example' }],
    ['fde', { kind: 'fde', email: 'fde@x.example', clientId: 'client-1' }],
    ['client staff', { kind: 'client_staff', email: 'c@x.example' }],
    ['unknown', { kind: 'unknown' }],
  ] as const)('refuses %s: no approve, no card', async (_name, clicker) => {
    const out = await run(clicker)
    expect(out.status).toBe('not_allowed')
    expect(out.text).toBe(PLAN_AGREE_NOT_ALLOWED)
    expect(mockApprove).not.toHaveBeenCalled()
    expect(mockIssue).not.toHaveBeenCalled()
  })

  it('no draft: nothing to approve', async () => {
    const out = await run(OPC, { plan_draft: { status: 'failed', reason_code: 'x' } })
    expect(out.status).toBe('no_draft')
    expect(mockApprove).not.toHaveBeenCalled()
  })

  it('a plan approval error is returned, not thrown', async () => {
    mockApprove.mockRejectedValue(new Error('db down'))
    const out = await run()
    expect(out.status).toBe('failed')
    expect(out.text).toContain('处方已批准')
  })

  it('a card that cannot be issued still leaves the plan unapproved', async () => {
    mockApprove.mockResolvedValue({ kind: 'needs_confirmation', planStart: 'a', planEnd: 'b', checks: [gate({ light: 'gray', reason: '读不到' })] })
    mockIssue.mockRejectedValue(new Error('rule'))
    const out = await run()
    expect(out.status).toBe('needs_confirmation')
    expect(out.card).toBeNull()
  })
})

describe('helpers', () => {
  it('draftPlanIdOf only trusts created / already_exists receipts', () => {
    expect(draftPlanIdOf(META)).toBe('plan-1')
    expect(draftPlanIdOf({ plan_draft: { status: 'already_exists', plan_id: 'p2' } })).toBe('p2')
    expect(draftPlanIdOf({ plan_draft: { status: 'failed', plan_id: 'p3' } })).toBeNull()
    expect(draftPlanIdOf(null)).toBeNull()
  })

  it('a failed read does not overwrite the prescription record', async () => {
    const update = vi.fn()
    const sb = {
      from: () => ({
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'down' } }) }) }) }),
        update,
      }),
    }
    await storePlanAgreeOutcome(sb as never, 'client-1', 'presc-1', noPlanDraftOutcome(new Date('2026-10-27T00:00:00Z')))
    expect(update).not.toHaveBeenCalled()
  })

  it('planAgreeFromMeta reads the stored outcome back', () => {
    const meta = { plan_approval: { status: 'approved', text: 'ok', plan_id: 'p', content_hash: 'h', at: 't' } }
    expect(planAgreeFromMeta(meta)).toEqual({ status: 'approved', text: 'ok', plan_id: 'p', content_hash: 'h', at: 't' })
    expect(planAgreeFromMeta({})).toBeNull()
  })

  it('hardNotGreen counts every non-green applicable check on every phase', () => {
    const green = gate({})
    const softYellow = gate({ key: 'social.cadence_scheduled', hard: false, light: 'yellow' })
    const softGray = gate({ key: 'content.wording_permission', hard: false, light: 'gray' })
    const laterYellow = gate({ key: 'ads.budget_within_caps', light: 'yellow', phase_id: 'p2' })
    const verdict = {
      per_phase: [
        { phase_id: 'p1', phase_name: 'one', due: true, results: [green, softYellow, softGray] },
        { phase_id: 'p2', phase_name: 'two', due: false, results: [laterYellow, gate({ phase_id: 'p2' })] },
      ],
      deferred_blockers: [],
    } as unknown as ApprovalVerdict
    expect(hardNotGreen(verdict)).toEqual([softYellow, softGray, laterYellow])
  })
})
