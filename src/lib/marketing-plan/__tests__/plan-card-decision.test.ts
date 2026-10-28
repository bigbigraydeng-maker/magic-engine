import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCapabilities } from '@/lib/capabilities'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { CLIENT_A, makeFixture, type Fixture } from '@/lib/kernel/__tests__/fixtures'
import { issueConfirmationCard, listConfirmationCards, type CardClicker } from '@/lib/confirmation-card'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import type { CardFacts } from '@/lib/confirmation-card/facts'
import { applyConfirmationDecision } from '@/lib/marketing-plan/plan-card-decision'
import { parsePlanCardSubject, planCardSubject } from '@/lib/marketing-plan/plan-card-subject'

const mockApprove = vi.hoisted(() => vi.fn())
vi.mock('@/lib/marketing-plan/approve-plan', () => ({
  approvePlan: (...args: unknown[]) => mockApprove(...args),
}))

const PLAN = '11111111-1111-4111-8111-111111111111'
const HASH = '0123456789abcdef'
const START = '2026-10-28T00:00:00.000Z'
const OPC: CardClicker = { kind: 'opc', email: 'opc@example.com' }
const FDE: CardClicker = { kind: 'fde', email: 'fde@example.com', clientId: CLIENT_A }

function planFacts(contentHash: string | null): CardFacts {
  return {
    subjectKey: planCardSubject(PLAN, contentHash),
    what: '批准推广计划草稿（只改计划状态，不开投）',
    account: '不操作任何广告账户',
    amount: '批准计划本身不花钱，不改预算',
    date: '2026-11-01 至 2026-11-30',
    scope: '只改这份计划的状态，不建广告草稿，不写 Meta',
    hardChecks: [{ label: '预算还没到顶', state: 'red', reason: '还差一点' }],
  }
}

const OTHER: CardFacts = {
  subjectKey: 'weekly-budget',
  what: '记下要不要调每周预算',
  account: '测试广告账户',
  amount: '每天一百新西兰元',
  date: '下周一',
  scope: '只记这一张卡，不改广告',
  hardChecks: [{ label: '账户能读到', state: 'green', reason: '' }],
}

function fixture(): Fixture {
  return makeFixture({
    registry: ACTION_REGISTRY,
    capabilities: (sb) => createCapabilities(sb),
    startAt: START,
  })
}

function approved() {
  return { kind: 'approved', plan: { id: PLAN }, dispatch: { tasks_created: 0 }, receipt: { content_hash: HASH } }
}

async function click(
  f: Fixture,
  card: { runId: string; expectedDecisionId: string; fingerprint: string },
  resolution: 'confirm' | 'decline',
  clicker: CardClicker = OPC,
) {
  return applyConfirmationDecision(f.kernel, {
    clientId: CLIENT_A,
    runId: card.runId,
    clicker,
    resolution,
    expectedDecisionId: card.expectedDecisionId,
    fingerprint: card.fingerprint,
    approvedBy: clicker.kind === 'opc' ? clicker.email : null,
  })
}

function runStatus(f: Fixture, runId: string): string | undefined {
  return f.tables.action_runs.find((row) => row.id === runId)?.status as string | undefined
}

beforeEach(() => {
  mockApprove.mockReset()
  mockApprove.mockResolvedValue(approved())
})

describe('plan confirmation card', () => {
  it('confirm approves the plan the card names', async () => {
    const f = fixture()
    const card = await issueConfirmationCard(f.kernel, { clientId: CLIENT_A, clicker: OPC, facts: planFacts(HASH) })
    expect(card.confirmEnabled).toBe(true)
    expect(card.blockedReason).toContain('还差一点')
    const forFde = await listConfirmationCards(f.kernel, CLIENT_A, FDE)
    expect(forFde.find((row) => row.runId === card.runId)?.confirmEnabled).toBe(false)

    const clicked = await click(f, card, 'confirm')
    expect(clicked.status).toBe('confirmed')
    expect(clicked.statusLine).toContain('这份计划已批准')
    expect(mockApprove).toHaveBeenCalledTimes(1)
    expect(mockApprove).toHaveBeenCalledWith({
      clientId: CLIENT_A,
      planId: PLAN,
      approvedBy: 'opc@example.com',
      requireAllGreen: false,
      expectedContentHash: HASH,
    })
    expect(runStatus(f, card.runId)).toBe('authorized')
  })

  it('still approves a card that was issued before the content stamp', async () => {
    const f = fixture()
    const card = await issueConfirmationCard(f.kernel, { clientId: CLIENT_A, clicker: OPC, facts: planFacts(null) })
    await click(f, card, 'confirm')
    expect(mockApprove).toHaveBeenCalledWith({
      clientId: CLIENT_A,
      planId: PLAN,
      approvedBy: 'opc@example.com',
      requireAllGreen: false,
    })
  })

  it('does not approve when the card on screen is out of date or expired', async () => {
    const f = fixture()
    const card = await issueConfirmationCard(f.kernel, { clientId: CLIENT_A, clicker: OPC, facts: planFacts(HASH) })
    await expect(applyConfirmationDecision(f.kernel, {
      clientId: CLIENT_A,
      runId: card.runId,
      clicker: OPC,
      resolution: 'confirm',
      expectedDecisionId: card.expectedDecisionId,
      fingerprint: 'b'.repeat(64),
      approvedBy: OPC.email,
    })).rejects.toMatchObject({ code: 'stale' })
    expect(mockApprove).not.toHaveBeenCalled()

    f.clock.now = new Date(Date.parse(START) + 30 * 60 * 1000)
    const expired = await click(f, card, 'confirm')
    expect(expired.status).toBe('expired')
    expect(mockApprove).not.toHaveBeenCalled()
    expect(runStatus(f, card.runId)).not.toBe('authorized')
  })

  it('reject does not approve the plan', async () => {
    const f = fixture()
    const card = await issueConfirmationCard(f.kernel, { clientId: CLIENT_A, clicker: OPC, facts: planFacts(HASH) })
    const clicked = await click(f, card, 'decline')
    expect(clicked.status).toBe('declined')
    expect(mockApprove).not.toHaveBeenCalled()
    expect(runStatus(f, card.runId)).toBe('denied')
  })

  it.each([
    ['fde', FDE],
    ['client staff', { kind: 'client_staff', email: 'staff@example.com' } as const],
    ['agent', { kind: 'agent', email: null } as const],
  ])('refuses %s and does not approve', async (_name, clicker) => {
    const f = fixture()
    const card = await issueConfirmationCard(f.kernel, { clientId: CLIENT_A, clicker: OPC, facts: planFacts(HASH) })
    await expect(click(f, card, 'confirm', clicker)).rejects.toBeInstanceOf(ConfirmationCardError)
    await expect(click(f, card, 'confirm', clicker)).rejects.toMatchObject({ code: 'forbidden' })
    expect(mockApprove).not.toHaveBeenCalled()
    expect(runStatus(f, card.runId)).toBe('pending_approval')
  })

  it('a second confirm does not approve again', async () => {
    const f = fixture()
    const kinds: string[] = []
    mockApprove.mockImplementation(async () => {
      const kind = kinds.length === 0 ? 'approved' : 'already_approved'
      kinds.push(kind)
      return kind === 'approved' ? approved() : { kind, plan: { id: PLAN }, existingTaskCount: 1 }
    })
    const card = await issueConfirmationCard(f.kernel, { clientId: CLIENT_A, clicker: OPC, facts: planFacts(HASH) })
    const first = await click(f, card, 'confirm')
    const second = await click(f, card, 'confirm')
    expect(first.status).toBe('confirmed')
    expect(second.status).toBe('confirmed')
    expect(kinds).toEqual(['approved', 'already_approved'])
    expect(runStatus(f, card.runId)).toBe('authorized')
  })

  it('an already approved plan is not approved again', async () => {
    const f = fixture()
    mockApprove.mockResolvedValue({ kind: 'already_approved', plan: { id: PLAN }, existingTaskCount: 2 })
    const card = await issueConfirmationCard(f.kernel, { clientId: CLIENT_A, clicker: OPC, facts: planFacts(HASH) })
    const clicked = await click(f, card, 'confirm')
    expect(clicked.status).toBe('confirmed')
    expect(mockApprove).toHaveBeenCalledTimes(1)
    expect(mockApprove.mock.calls[0][0]).toMatchObject({ planId: PLAN, expectedContentHash: HASH })
  })

  it.each([
    ['stale', { kind: 'stale' }, 'stale'],
    ['blocked', { kind: 'blocked', blockers: [], contentHash: HASH }, 'hard_check'],
  ] as const)('does not confirm when the plan comes back %s', async (_name, result, code) => {
    const f = fixture()
    mockApprove.mockResolvedValue(result)
    const card = await issueConfirmationCard(f.kernel, { clientId: CLIENT_A, clicker: OPC, facts: planFacts(HASH) })
    await expect(click(f, card, 'confirm')).rejects.toMatchObject({ code })
    expect(runStatus(f, card.runId)).toBe('pending_approval')
  })

  it('leaves every other card as a recorded click', async () => {
    const f = fixture()
    const card = await issueConfirmationCard(f.kernel, { clientId: CLIENT_A, clicker: OPC, facts: OTHER })
    const clicked = await click(f, card, 'confirm')
    expect(clicked.status).toBe('confirmed')
    expect(clicked.statusLine).toContain('还没有开始做')
    expect(mockApprove).not.toHaveBeenCalled()
  })
})

describe('plan card subject', () => {
  it('reads the plan id and the content stamp', () => {
    expect(parsePlanCardSubject(planCardSubject(PLAN, HASH))).toEqual({ planId: PLAN, contentHash: HASH })
    expect(parsePlanCardSubject('plan-approve:plan-1')).toEqual({ planId: 'plan-1', contentHash: null })
    expect(parsePlanCardSubject('weekly-budget')).toBeNull()
  })
})
