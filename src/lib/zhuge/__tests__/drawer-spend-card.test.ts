import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createCapabilities } from '@/lib/capabilities'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { CONFIRMATION_ACTION_KEY } from '@/lib/kernel/registry-confirmation'
import { CLIENT_A, makeFixture } from '@/lib/kernel/__tests__/fixtures'
import type { CardClicker } from '@/lib/confirmation-card'
import { decideConfirmationCard } from '@/lib/confirmation-card'
import { factsForSpend, type SpendEvidence } from '../drawer-spend-checks'
import { issueDrawerSpendCard } from '../drawer-spend-turn'

const START = '2026-10-27T00:00:00.000Z'
const OPC: CardClicker = { kind: 'opc', email: 'opc@example.com' }
const AGENT: CardClicker = { kind: 'agent', email: null }
const ROOT = join(__dirname, '..', '..', '..', '..')

function greenEvidence(speaker: CardClicker): SpendEvidence {
  return {
    dailyCap: { cents: 10000 },
    amountVerdict: 'within',
    leadCrm: 'green',
    leadCrmReason: '',
    creative: 'green',
    creativeReason: '',
    ownership: 'green',
    ownershipReason: '',
    speaker,
    clientId: CLIENT_A,
  }
}

function fixture() {
  const calls = vi.fn()
  const f = makeFixture({
    registry: ACTION_REGISTRY,
    startAt: START,
    capabilities: (sb) => {
      const impl = createCapabilities(sb)[CONFIRMATION_ACTION_KEY]
      return {
        [CONFIRMATION_ACTION_KEY]: {
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
  })
  return { f, calls }
}

describe('drawer confirmation card', () => {
  it('issues a card and a click still does not run the hold step', async () => {
    const { f, calls } = fixture()
    const card = await issueDrawerSpendCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      clicker: OPC,
      spend: 'launch',
      summary: '开投',
      evidence: greenEvidence(OPC),
      now: new Date(START),
    })
    expect(card.confirmEnabled).toBe(true)
    expect(card.what).toBe('开投')
    expect(card.scope).toContain('只出卡，不执行')
    const clicked = await decideConfirmationCard(f.kernel, {
      clientId: CLIENT_A,
      runId: card.runId,
      clicker: OPC,
      resolution: 'confirm',
      expectedDecisionId: card.expectedDecisionId,
      fingerprint: card.fingerprint,
      now: new Date(START),
    })
    expect(clicked.statusLine).toContain('还没有开始做')
    expect(calls).not.toHaveBeenCalled()
  })

  it('keeps confirm grey when a check is unread, including an agent request', async () => {
    const { f, calls } = fixture()
    const unread = factsForSpend('launch', '开投', {
      ...greenEvidence(OPC),
      amountVerdict: 'unknown',
    })
    expect(unread.hardChecks.find((check) => check.label === '日上限')?.state).toBe('unread')
    expect(unread.amount).toBe('读不到')
    const card = await issueDrawerSpendCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      clicker: AGENT,
      spend: 'launch',
      summary: '开投',
      evidence: greenEvidence(AGENT),
      now: new Date(START),
    })
    expect(card.confirmEnabled).toBe(false)
    expect(card.blockedReason).toContain('代理人')
    expect(calls).not.toHaveBeenCalled()
  })

  it('does not import an ad-platform write or claim a human trigger', () => {
    const files = [
      'src/lib/zhuge/drawer-spend-ask.ts',
      'src/lib/zhuge/drawer-spend-checks.ts',
      'src/lib/zhuge/drawer-spend-evidence.ts',
      'src/lib/zhuge/drawer-spend-turn.ts',
    ]
    const banned = ['getCampaignDetails', 'service-pause', 'ME_SERVICE_PAUSE', 'graph.facebook', "triggeredBy: 'human'"]
    for (const file of files) {
      const source = readFileSync(join(ROOT, file), 'utf8')
      for (const word of banned) expect(source, file).not.toContain(word)
    }
  })
})
