import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createCapabilities } from '@/lib/capabilities'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { runAction } from '@/lib/kernel/runner'
import { CONFIRMATION_ACTION_KEY } from '@/lib/kernel/registry-confirmation'
import { CLIENT_A, CLIENT_B, makeFixture } from '@/lib/kernel/__tests__/fixtures'
import type { CardClicker } from '../actor'
import type { CardFacts } from '../facts'
import { decideConfirmationCard } from '../decide'
import { issueConfirmationCard } from '../issue'
import { listConfirmationCards } from '../list'
import { ConfirmationCardError } from '../errors'

const KEY = CONFIRMATION_ACTION_KEY
const START = '2026-10-27T00:00:00.000Z'
const OPC: CardClicker = { kind: 'opc', email: 'opc@example.com' }
const FDE: CardClicker = { kind: 'fde', email: 'fde@example.com', clientId: CLIENT_A }
const OTHER_FDE: CardClicker = { kind: 'fde', email: 'other@example.com', clientId: CLIENT_B }
const STAFF: CardClicker = { kind: 'client_staff', email: 'staff@example.com' }
const AGENT: CardClicker = { kind: 'agent', email: null }

const FACTS: CardFacts = {
  subjectKey: 'weekly-budget',
  what: '记下要不要调每周预算',
  account: '测试广告账户',
  amount: '每天一百新西兰元',
  date: '下周一',
  scope: '只记这一张卡，不改广告',
  hardChecks: [{ label: '账户能读到', state: 'green', reason: '' }],
}

function fixture(mode?: string) {
  const calls = vi.fn()
  const f = makeFixture({
    registry: ACTION_REGISTRY,
    startAt: START,
    capabilities: (sb) => {
      const impl = createCapabilities(sb)[KEY]
      return {
        [KEY]: {
          ...impl,
          steps: {
            hold: async (step) => {
              calls()
              return impl.steps.hold(step)
            },
          },
        },
      }
    },
    options: mode
      ? { policy: { action_key: KEY, mode, spend_cap_per_run_usd: 0, decision_ttl_seconds: 1800 } }
      : undefined,
  })
  return { f, calls }
}

function decisionCount(f: ReturnType<typeof fixture>['f']): number {
  return f.tables.authorization_decisions.length
}

describe('confirmation card issue and click', () => {
  it('does not call the capability when a card is issued or clicked', async () => {
    const { f, calls } = fixture()
    const card = await issueConfirmationCard(f.kernel, { clientId: CLIENT_A, clicker: OPC, facts: FACTS })
    expect(card.confirmEnabled).toBe(true)
    expect(card.what).toBe(FACTS.what)
    expect(card.statusLine).toBe('还没人点。')
    const clicked = await decideConfirmationCard(f.kernel, {
      clientId: CLIENT_A,
      runId: card.runId,
      clicker: OPC,
      resolution: 'confirm',
      expectedDecisionId: card.expectedDecisionId,
      fingerprint: card.fingerprint,
    })
    expect(clicked.status).toBe('confirmed')
    expect(clicked.statusLine).toContain('opc@example.com')
    expect(clicked.statusLine).toContain('还没有开始做')
    expect(calls).not.toHaveBeenCalled()
    const allow = f.tables.authorization_decisions.find((row) => row.verdict === 'allow')
    expect(String(allow?.reason)).toContain('OPC确认')
    expect(allow?.decided_by_user).toBe('opc@example.com')
  })

  it('returns the same fresh card and voids the old one when the words change', async () => {
    const { f, calls } = fixture()
    const first = await issueConfirmationCard(f.kernel, { clientId: CLIENT_A, clicker: OPC, facts: FACTS })
    const again = await issueConfirmationCard(f.kernel, { clientId: CLIENT_A, clicker: OPC, facts: FACTS })
    expect(again.runId).toBe(first.runId)
    const changed = await issueConfirmationCard(f.kernel, {
      clientId: CLIENT_A,
      clicker: OPC,
      facts: { ...FACTS, amount: '每天两百新西兰元' },
    })
    expect(changed.runId).not.toBe(first.runId)
    const old = f.tables.action_runs.find((row) => row.id === first.runId)
    expect(old?.status).toBe('denied')
    const deny = f.tables.authorization_decisions.find((row) => row.id === old?.authorization_decision_id)
    expect(String(deny?.reason)).toContain('内容变了')
    expect(calls).not.toHaveBeenCalled()
  })

  it('records an unread card as expired after 30 minutes', async () => {
    const { f, calls } = fixture()
    await issueConfirmationCard(f.kernel, { clientId: CLIENT_A, clicker: FDE, facts: FACTS })
    f.clock.now = new Date(Date.parse(START) + 30 * 60 * 1000)
    const cards = await listConfirmationCards(f.kernel, CLIENT_A, OPC, f.clock.now)
    expect(cards.map((card) => card.status)).toContain('expired')
    const deny = f.tables.authorization_decisions.find((row) => String(row.reason).includes('过了 30 分钟'))
    expect(deny?.decided_by_user).toBe('系统')
    expect(calls).not.toHaveBeenCalled()
  })

  it('refuses agent, staff, and another client\'s FDE without writing a click', async () => {
    const { f, calls } = fixture()
    const card = await issueConfirmationCard(f.kernel, { clientId: CLIENT_A, clicker: AGENT, facts: FACTS })
    const before = decisionCount(f)
    for (const clicker of [AGENT, STAFF, OTHER_FDE]) {
      await expect(decideConfirmationCard(f.kernel, {
        clientId: CLIENT_A,
        runId: card.runId,
        clicker,
        resolution: 'confirm',
        expectedDecisionId: card.expectedDecisionId,
        fingerprint: card.fingerprint,
      })).rejects.toBeInstanceOf(ConfirmationCardError)
    }
    expect(decisionCount(f)).toBe(before)
    expect(f.tables.action_runs.find((row) => row.id === card.runId)?.status).toBe('pending_approval')
    expect(calls).not.toHaveBeenCalled()
  })

  it('does not treat a missing or unreadable check as passed', async () => {
    const { f, calls } = fixture()
    const unread = await issueConfirmationCard(f.kernel, {
      clientId: CLIENT_A,
      clicker: OPC,
      facts: { ...FACTS, hardChecks: [{ label: '花费', state: 'unread', reason: '' }] },
    })
    expect(unread.confirmEnabled).toBe(false)
    expect(unread.blockedReason).toContain('读不到')
    const empty = await issueConfirmationCard(f.kernel, {
      clientId: CLIENT_A,
      clicker: OPC,
      facts: { ...FACTS, subjectKey: 'empty-checks', hardChecks: [] },
    })
    expect(empty.confirmEnabled).toBe(false)
    expect(empty.blockedReason).toContain('不能确认')
    await expect(decideConfirmationCard(f.kernel, {
      clientId: CLIENT_A,
      runId: unread.runId,
      clicker: OPC,
      resolution: 'confirm',
      expectedDecisionId: unread.expectedDecisionId,
      fingerprint: unread.fingerprint,
    })).rejects.toMatchObject({ code: 'hard_check' })
    expect(calls).not.toHaveBeenCalled()
  })

  it('greys out confirm on a red check and still records decline', async () => {
    const { f, calls } = fixture()
    const card = await issueConfirmationCard(f.kernel, {
      clientId: CLIENT_A,
      clicker: OPC,
      facts: {
        ...FACTS,
        hardChecks: [{ label: '花费', state: 'red', reason: '已经超了今天的上限' }],
      },
    })
    expect(card.confirmEnabled).toBe(false)
    expect(card.declineEnabled).toBe(true)
    expect(card.blockedReason).toContain('已经超了今天的上限')
    const before = decisionCount(f)
    await expect(decideConfirmationCard(f.kernel, {
      clientId: CLIENT_A,
      runId: card.runId,
      clicker: OPC,
      resolution: 'confirm',
      expectedDecisionId: card.expectedDecisionId,
      fingerprint: card.fingerprint,
    })).rejects.toMatchObject({ code: 'hard_check' })
    expect(decisionCount(f)).toBe(before)
    const declined = await decideConfirmationCard(f.kernel, {
      clientId: CLIENT_A,
      runId: card.runId,
      clicker: FDE,
      resolution: 'decline',
      expectedDecisionId: card.expectedDecisionId,
      fingerprint: card.fingerprint,
    })
    expect(declined.status).toBe('declined')
    expect(declined.statusLine).toContain('fde@example.com')
    expect(calls).not.toHaveBeenCalled()
  })

  it('does not write when the fingerprint is old, and does not confirm twice', async () => {
    const { f } = fixture()
    const card = await issueConfirmationCard(f.kernel, { clientId: CLIENT_A, clicker: OPC, facts: FACTS })
    const before = decisionCount(f)
    await expect(decideConfirmationCard(f.kernel, {
      clientId: CLIENT_A,
      runId: card.runId,
      clicker: OPC,
      resolution: 'confirm',
      expectedDecisionId: card.expectedDecisionId,
      fingerprint: 'b'.repeat(64),
    })).rejects.toMatchObject({ code: 'stale' })
    expect(decisionCount(f)).toBe(before)
    await decideConfirmationCard(f.kernel, {
      clientId: CLIENT_A,
      runId: card.runId,
      clicker: OPC,
      resolution: 'confirm',
      expectedDecisionId: card.expectedDecisionId,
      fingerprint: card.fingerprint,
    })
    await expect(decideConfirmationCard(f.kernel, {
      clientId: CLIENT_A,
      runId: card.runId,
      clicker: OPC,
      resolution: 'confirm',
      expectedDecisionId: card.expectedDecisionId,
      fingerprint: card.fingerprint,
    })).rejects.toMatchObject({ code: 'not_waiting' })
  })

  it('refuses to open a card when the rule is not require-approval', async () => {
    const { f, calls } = fixture('auto_approve')
    await expect(issueConfirmationCard(f.kernel, {
      clientId: CLIENT_A,
      clicker: OPC,
      facts: FACTS,
    })).rejects.toMatchObject({ code: 'rule_blocked' })
    expect(f.tables.action_runs).toHaveLength(0)
    expect(calls).not.toHaveBeenCalled()
  })

  it('does not run the hold step if something tries to continue after confirm', async () => {
    const { f, calls } = fixture()
    const card = await issueConfirmationCard(f.kernel, { clientId: CLIENT_A, clicker: OPC, facts: FACTS })
    await decideConfirmationCard(f.kernel, {
      clientId: CLIENT_A,
      runId: card.runId,
      clicker: OPC,
      resolution: 'confirm',
      expectedDecisionId: card.expectedDecisionId,
      fingerprint: card.fingerprint,
    })
    const stored = f.tables.action_runs.find((row) => row.id === card.runId)
    const outcome = await runAction(f.kernel, {
      clientId: CLIENT_A,
      actionKey: KEY,
      purpose: 'housekeeping',
      triggeredBy: 'human',
      input: stored?.input as Record<string, unknown>,
    })
    expect(outcome.kind).not.toBe('succeeded')
    expect(calls.mock.calls.length).toBeLessThanOrEqual(1)
    expect(f.tables.action_runs.every((row) => row.status !== 'succeeded')).toBe(true)
  })
})

describe('confirmation card source guard', () => {
  it('does not approve-and-run or mention a paid network', () => {
    const root = join(__dirname, '..')
    for (const name of ['issue.ts', 'decide.ts', 'list.ts', 'settle.ts']) {
      const text = readFileSync(join(root, name), 'utf8')
      expect(text).not.toMatch(/approveAndRun|executeAuthorizedRun/)
      expect(text.toLowerCase()).not.toContain('meta')
    }
  })
})
