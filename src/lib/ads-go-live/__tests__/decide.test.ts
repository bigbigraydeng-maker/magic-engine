import { describe, expect, it, vi } from 'vitest'
import { createCapabilities } from '@/lib/capabilities'
import { CLIENT_A, makeFixture } from '@/lib/kernel/__tests__/fixtures'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { CONFIRMATION_ACTION_KEY } from '@/lib/kernel/registry-confirmation'
import { ConfirmationCardError, type CardClicker, type CardFacts } from '@/lib/confirmation-card'
import { issueConfirmationCard } from '@/lib/confirmation-card'
import { decideGoLive, issueGoLive } from '../decide'
import type { ExecutionOutcome } from '../decide'

const OPC: CardClicker = { kind: 'opc', email: 'opc@example.com' }
const AGENT: CardClicker = { kind: 'agent', email: null }
const FACTS: CardFacts = {
  subjectKey: 'go-live:draft-1',
  what: '开投：把暂停的广告改成在投',
  account: '演示广告账户',
  amount: '每天 40，按这个广告账户自己的货币',
  date: '从点下去的这一天开始，计划跑 7 天',
  scope: '开到广告、广告组和广告系列这三层',
  hardChecks: [{ label: '开投前十道检查', state: 'green', reason: '十道都是绿灯' }],
}

function kernel() {
  return makeFixture({
    registry: ACTION_REGISTRY,
    startAt: '2026-10-28T00:00:00.000Z',
    capabilities: (sb) => {
      const impl = createCapabilities(sb)[CONFIRMATION_ACTION_KEY]
      return { [CONFIRMATION_ACTION_KEY]: impl }
    },
  }).kernel
}

function live(): ExecutionOutcome {
  return {
    settle: { outcome: 'live', attempts: 1, readback: '广告在投，广告组在投，广告系列在投' },
    note: null,
  }
}

describe('go-live decide', () => {
  it('settles once after confirm and does not settle on decline', async () => {
    const deps = kernel()
    const issued = await issueGoLive({ kernel: deps, clientId: CLIENT_A, clicker: OPC, facts: FACTS })
    const settle = vi.fn(async () => live())
    const declined = await decideGoLive({
      kernel: deps,
      clientId: CLIENT_A,
      clicker: OPC,
      draftId: 'draft-1',
      facts: FACTS,
      resolution: 'decline',
      expectedDecisionId: issued.card.expectedDecisionId,
      fingerprint: issued.card.fingerprint,
      runId: issued.card.runId,
      settle,
    })
    expect(declined.outcome).toBe('declined')
    expect(declined.resultLine).toContain('不做')
    expect(settle).not.toHaveBeenCalled()

    const again = await issueGoLive({ kernel: deps, clientId: CLIENT_A, clicker: OPC, facts: FACTS })
    const confirmed = await decideGoLive({
      kernel: deps,
      clientId: CLIENT_A,
      clicker: OPC,
      draftId: 'draft-1',
      facts: FACTS,
      resolution: 'confirm',
      expectedDecisionId: again.card.expectedDecisionId,
      fingerprint: again.card.fingerprint,
      runId: again.card.runId,
      settle,
    })
    expect(confirmed.outcome).toBe('live')
    expect(confirmed.resultLine).toContain('opc@example.com')
    expect(confirmed.resultLine).toContain('开投观察从现在开始计时')
    expect(settle).toHaveBeenCalledTimes(1)
  })

  it('refuses an agent click and a red check without settling', async () => {
    const deps = kernel()
    const issued = await issueGoLive({ kernel: deps, clientId: CLIENT_A, clicker: AGENT, facts: FACTS })
    const settle = vi.fn(async () => live())
    await expect(decideGoLive({
      kernel: deps,
      clientId: CLIENT_A,
      clicker: AGENT,
      draftId: 'draft-1',
      facts: FACTS,
      resolution: 'confirm',
      expectedDecisionId: issued.card.expectedDecisionId,
      fingerprint: issued.card.fingerprint,
      runId: issued.card.runId,
      settle,
    })).rejects.toBeInstanceOf(ConfirmationCardError)
    expect(settle).not.toHaveBeenCalled()

    const blocked: CardFacts = {
      ...FACTS,
      subjectKey: 'go-live:draft-2',
      hardChecks: [{ label: '像素在线', state: 'red', reason: '还不是绿灯' }],
    }
    const red = await issueGoLive({ kernel: deps, clientId: CLIENT_A, clicker: OPC, facts: blocked })
    expect(red.card.confirmEnabled).toBe(false)
    await expect(decideGoLive({
      kernel: deps,
      clientId: CLIENT_A,
      clicker: OPC,
      draftId: 'draft-2',
      facts: blocked,
      resolution: 'confirm',
      expectedDecisionId: red.card.expectedDecisionId,
      fingerprint: red.card.fingerprint,
      runId: red.card.runId,
      settle,
    })).rejects.toMatchObject({ code: 'hard_check' })
    expect(settle).not.toHaveBeenCalled()
  })

  it('reissues when the fingerprint changed and does not settle', async () => {
    const deps = kernel()
    const issued = await issueGoLive({ kernel: deps, clientId: CLIENT_A, clicker: OPC, facts: FACTS })
    const settle = vi.fn(async () => live())
    const refreshed = await decideGoLive({
      kernel: deps,
      clientId: CLIENT_A,
      clicker: OPC,
      draftId: 'draft-1',
      facts: { ...FACTS, amount: '每天 80，按这个广告账户自己的货币' },
      resolution: 'confirm',
      expectedDecisionId: issued.card.expectedDecisionId,
      fingerprint: issued.card.fingerprint,
      runId: issued.card.runId,
      settle,
    })
    expect(refreshed.outcome).toBe('waiting')
    expect(refreshed.card.runId).not.toBe(issued.card.runId)
    expect(refreshed.resultLine).toContain('还没有开投')
    expect(settle).not.toHaveBeenCalled()
  })

  it('refuses a card that belongs to another subject', async () => {
    const deps = kernel()
    const other = await issueConfirmationCard(deps, {
      clientId: CLIENT_A,
      clicker: OPC,
      facts: { ...FACTS, subjectKey: 'weekly-budget', what: '记下要不要调每周预算' },
    })
    const settle = vi.fn(async () => live())
    await expect(decideGoLive({
      kernel: deps,
      clientId: CLIENT_A,
      clicker: OPC,
      draftId: 'draft-1',
      facts: { ...FACTS, subjectKey: 'weekly-budget', what: '记下要不要调每周预算' },
      resolution: 'confirm',
      expectedDecisionId: other.expectedDecisionId,
      fingerprint: other.fingerprint,
      runId: other.runId,
      settle,
    })).rejects.toMatchObject({ code: 'not_found' })
    expect(settle).not.toHaveBeenCalled()
  })
})
