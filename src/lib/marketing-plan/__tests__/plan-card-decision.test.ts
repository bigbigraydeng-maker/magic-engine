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

function issuePlan(f: Fixture, facts: CardFacts = planFacts(HASH)) {
  return issueConfirmationCard(f.kernel, {
    clientId: CLIENT_A,
    clicker: OPC,
    facts,
    allowPlanApproval: true,
  })
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
  mockApprove.mockImplementation(async (args: { commit?: boolean }) => (
    args.commit === false ? { kind: 'ready' } : approved()
  ))
})

describe('plan confirmation card', () => {
  it('confirm approves the plan the card names', async () => {
    const f = fixture()
    const card = await issuePlan(f)
    expect(card.confirmEnabled).toBe(true)
    expect(card.blockedReason).toContain('还差一点')
    const forFde = await listConfirmationCards(f.kernel, CLIENT_A, FDE)
    expect(forFde.find((row) => row.runId === card.runId)?.confirmEnabled).toBe(false)

    const seen: string[] = []
    mockApprove.mockImplementation(async (args: { commit?: boolean }) => {
      seen.push(`${args.commit === false ? 'preview' : 'commit'}:${runStatus(f, card.runId)}`)
      return args.commit === false ? { kind: 'ready' } : approved()
    })
    const clicked = await click(f, card, 'confirm')
    expect(clicked.status).toBe('confirmed')
    expect(clicked.statusLine).toContain('这份计划已批准')
    expect(seen).toEqual(['preview:pending_approval', 'commit:authorized'])
    expect(mockApprove).toHaveBeenNthCalledWith(2, expect.objectContaining({
      clientId: CLIENT_A,
      planId: PLAN,
      approvedBy: 'opc@example.com',
      requireAllGreen: false,
      expectedContentHash: HASH,
      commit: true,
    }))
  })

  it('does not approve a card without the content stamp or with different words', async () => {
    const f = fixture()
    const unstamped = await issuePlan(f, planFacts(null))
    await expect(click(f, unstamped, 'confirm')).rejects.toMatchObject({ code: 'hard_check' })
    const disguised = await issuePlan(f, { ...planFacts(HASH), what: '只是记下这条建议，不批准计划' })
    await expect(click(f, disguised, 'confirm')).rejects.toMatchObject({ code: 'hard_check' })
    expect(mockApprove).not.toHaveBeenCalled()
    await expect(issueConfirmationCard(f.kernel, {
      clientId: CLIENT_A,
      clicker: FDE,
      facts: planFacts(HASH),
    })).rejects.toMatchObject({ code: 'invalid' })
  })

  it('does not approve when the card on screen is out of date or expired', async () => {
    const f = fixture()
    const card = await issuePlan(f)
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
    const card = await issuePlan(f)
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
    const card = await issuePlan(f)
    await expect(click(f, card, 'confirm', clicker)).rejects.toBeInstanceOf(ConfirmationCardError)
    await expect(click(f, card, 'confirm', clicker)).rejects.toMatchObject({ code: 'forbidden' })
    expect(mockApprove).not.toHaveBeenCalled()
    expect(runStatus(f, card.runId)).toBe('pending_approval')
  })

  it('a second confirm does not approve again', async () => {
    const f = fixture()
    let wrote = false
    mockApprove.mockImplementation(async (args: { commit?: boolean }) => {
      if (args.commit === false) {
        return wrote
          ? { kind: 'already_approved', plan: { id: PLAN }, existingTaskCount: 1 }
          : { kind: 'ready' }
      }
      if (!wrote) {
        wrote = true
        return approved()
      }
      return { kind: 'already_approved', plan: { id: PLAN }, existingTaskCount: 1 }
    })
    const card = await issuePlan(f)
    const first = await click(f, card, 'confirm')
    const second = await click(f, card, 'confirm')
    expect(first.status).toBe('confirmed')
    expect(second.status).toBe('confirmed')
    expect(wrote).toBe(true)
    const commits = mockApprove.mock.calls.filter((call) => call[0].commit === true)
    expect(commits).toHaveLength(2)
    expect(commits[1][0]).toMatchObject({ planId: PLAN })
    expect(runStatus(f, card.runId)).toBe('authorized')
  })

  it('an already approved plan is not approved again', async () => {
    const f = fixture()
    mockApprove.mockResolvedValue({ kind: 'already_approved', plan: { id: PLAN }, existingTaskCount: 2 })
    const card = await issuePlan(f)
    const clicked = await click(f, card, 'confirm')
    expect(clicked.status).toBe('confirmed')
    expect(mockApprove).toHaveBeenCalledTimes(2)
    expect(mockApprove.mock.calls.map((call) => call[0].commit)).toEqual([false, true])
  })

  it.each([
    ['stale', { kind: 'stale' }, 'stale'],
    ['blocked', { kind: 'blocked', blockers: [], contentHash: HASH }, 'hard_check'],
  ] as const)('does not confirm when the plan comes back %s', async (_name, result, code) => {
    const f = fixture()
    mockApprove.mockResolvedValue(result)
    const card = await issuePlan(f)
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
