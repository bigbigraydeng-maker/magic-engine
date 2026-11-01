import { describe, expect, it } from 'vitest'
import { createCapabilities } from '@/lib/capabilities'
import { ACTION_KEYS, ACTION_REGISTRY } from '@/lib/kernel/registry'
import { CONFIRMATION_ACTION_KEY } from '@/lib/kernel/registry-confirmation'
import { CLIENT_A, makeFixture } from '@/lib/kernel/__tests__/fixtures'
import type { CardClicker } from '@/lib/confirmation-card/actor'
import { issuePauseOrder, submitPauseCard, type PauseRuntime } from '../flow'
import { PAUSE_CARD_POLICY_KEY } from '../switch'
import type { LiveFacts, SuccessorLive } from '../guard'
import type { PauseOrder } from '../order'

const OPC: CardClicker = { kind: 'opc', email: 'opc@example.com' }
const KEY = CONFIRMATION_ACTION_KEY

const order: PauseOrder = {
  sourceKind: 'plan_step',
  sourceId: 'plan-1',
  stepId: 'step-1',
  level: 'ad',
  adAccountId: 'act_42',
  campaignId: '100',
  adsetId: '200',
  adId: '300',
  basis: '这条素材已经过了推广期',
  expectedMetric: 'ads.account.cost_per_lead',
  successorAdId: null,
}

function facts(patch: Partial<LiveFacts> = {}): LiveFacts {
  return {
    registeredAccountIds: ['act_42'],
    object: { campaignId: '100', accountId: '42', adsetId: '200' },
    campaignAds: [
      { id: '300', adsetId: '200', effectiveStatus: 'ACTIVE' },
      { id: '301', adsetId: '201', effectiveStatus: 'ACTIVE' },
    ],
    successor: { readable: true, accountId: null, campaignId: null, adsetId: null, effectiveStatus: null },
    ...patch,
  }
}

function placed(patch: Partial<SuccessorLive> = {}): SuccessorLive {
  return { readable: true, accountId: '42', campaignId: '100', adsetId: '200', effectiveStatus: 'ACTIVE', ...patch }
}

function runtime(liveFacts: LiveFacts, readback: string | null): PauseRuntime & { pauses: number } {
  const state = { pauses: 0, liveFacts, readback }
  return {
    get pauses() { return state.pauses },
    live: async () => state.liveFacts,
    pause: async () => { state.pauses += 1; return true },
    readback: async () => state.readback,
  }
}

function fixture(mode: 'require_approval' | 'deny' | 'auto_approve' | 'missing' = 'require_approval') {
  const f = makeFixture({
    registry: ACTION_REGISTRY,
    startAt: '2026-11-01T00:00:00.000Z',
    capabilities: (sb) => ({ [KEY]: createCapabilities(sb)[KEY] }),
    options: {
      extraTables: {
        client_automation_policies: mode === 'missing' ? [] : [{
          id: 'policy-pause',
          client_id: CLIENT_A,
          action_key: PAUSE_CARD_POLICY_KEY,
          mode,
          policy_version: 1,
          spend_cap_per_run_usd: 0,
          spend_cap_per_period_usd: null,
          spend_cap_period: null,
          decision_ttl_seconds: 1800,
          effective_from: '2020-01-01T00:00:00.000Z',
          effective_to: null,
          updated_by: 'test@magiclab',
        }],
      },
    },
  })
  return f
}

describe('pause card issue and execute', () => {
  it('stays off unless this client requires a person to confirm', async () => {
    const calls = runtime(facts(), 'PAUSED')
    const off = await issuePauseOrder({ kernel: fixture('missing').kernel, clientId: CLIENT_A, clicker: OPC, order, runtime: calls })
    expect(off.status).toBe('off')
    const auto = await issuePauseOrder({ kernel: fixture('auto_approve').kernel, clientId: CLIENT_A, clicker: OPC, order, runtime: calls })
    expect(auto.status).toBe('off')
    expect(calls.pauses).toBe(0)
  })

  it('pauses once after confirm and writes the metric only when readback matches', async () => {
    const f = fixture()
    const calls = runtime(facts(), 'PAUSED')
    const card = await issuePauseOrder({ kernel: f.kernel, clientId: CLIENT_A, clicker: OPC, order, runtime: calls })
    expect(card.confirmEnabled).toBe(true)
    const done = await submitPauseCard({
      kernel: f.kernel, clientId: CLIENT_A, runId: card.runId ?? '', clicker: OPC,
      resolution: 'confirm', expectedDecisionId: card.expectedDecisionId ?? '', fingerprint: card.fingerprint ?? '',
      runtime: calls,
    })
    expect(done.status).toBe('executed')
    expect(calls.pauses).toBe(1)
    const row = f.tables.flywheel_actions.find((item) => item.action_type === 'ads.pause_ad')
    expect(row?.expected_metric).toBe(order.expectedMetric)
    const again = await submitPauseCard({
      kernel: f.kernel, clientId: CLIENT_A, runId: card.runId ?? '', clicker: OPC,
      resolution: 'confirm', expectedDecisionId: card.expectedDecisionId ?? '', fingerprint: card.fingerprint ?? '',
      runtime: calls,
    })
    expect(again.status).toBe('executed')
    expect(calls.pauses).toBe(1)
  })

  it('marks a mismatched readback as failed and does not write again', async () => {
    const f = fixture()
    const calls = runtime(facts(), 'ACTIVE')
    const card = await issuePauseOrder({ kernel: f.kernel, clientId: CLIENT_A, clicker: OPC, order, runtime: calls })
    const failed = await submitPauseCard({
      kernel: f.kernel, clientId: CLIENT_A, runId: card.runId ?? '', clicker: OPC,
      resolution: 'confirm', expectedDecisionId: card.expectedDecisionId ?? '', fingerprint: card.fingerprint ?? '',
      runtime: calls,
    })
    expect(failed.status).toBe('failed')
    expect(failed.wroteMeta).toBe(true)
    const row = f.tables.flywheel_actions.find((item) => item.action_type === 'ads.pause_ad')
    expect(row?.expected_metric).toBeNull()
    await submitPauseCard({
      kernel: f.kernel, clientId: CLIENT_A, runId: card.runId ?? '', clicker: OPC,
      resolution: 'confirm', expectedDecisionId: card.expectedDecisionId ?? '', fingerprint: card.fingerprint ?? '',
      runtime: calls,
    })
    expect(calls.pauses).toBe(1)
  })

  it('does not pause the old ad until the new one reads back active, then pauses once', async () => {
    const f = fixture()
    const replacing = { ...order, successorAdId: '400' }
    const waiting = runtime(facts({ successor: placed({ effectiveStatus: 'PAUSED' }) }), 'PAUSED')
    const held = await issuePauseOrder({ kernel: f.kernel, clientId: CLIENT_A, clicker: OPC, order: replacing, runtime: waiting })
    expect(held.confirmEnabled).toBe(false)
    expect(waiting.pauses).toBe(0)
    const readyRuntime = runtime(facts({ successor: placed() }), 'PAUSED')
    const ready = await issuePauseOrder({ kernel: f.kernel, clientId: CLIENT_A, clicker: OPC, order: replacing, runtime: readyRuntime })
    expect(ready.confirmEnabled).toBe(true)
    const done = await submitPauseCard({
      kernel: f.kernel, clientId: CLIENT_A, runId: ready.runId ?? '', clicker: OPC,
      resolution: 'confirm', expectedDecisionId: ready.expectedDecisionId ?? '', fingerprint: ready.fingerprint ?? '',
      runtime: readyRuntime,
    })
    expect(done.status).toBe('executed')
    expect(readyRuntime.pauses).toBe(1)
    const row = f.tables.flywheel_actions.find((item) => (item.payload as { cardRunId?: string }).cardRunId === ready.runId)
    const steps = (row?.payload as { steps?: Array<{ key: string; status: string }> }).steps
    expect(steps?.map((step) => step.status)).toEqual(['passed', 'executed'])
  })

  it('requires the empty-campaign card before the pause card can run', async () => {
    const f = fixture()
    const calls = runtime(facts({ campaignAds: [{ id: '300', adsetId: '200', effectiveStatus: 'ACTIVE' }] }), 'PAUSED')
    const card = await issuePauseOrder({ kernel: f.kernel, clientId: CLIENT_A, clicker: OPC, order, runtime: calls })
    expect(card.confirmEnabled).toBe(false)
    expect(card.emptyAckRunId).toBeTruthy()
    await submitPauseCard({
      kernel: f.kernel, clientId: CLIENT_A, runId: card.emptyAckRunId ?? '', clicker: OPC,
      resolution: 'confirm', expectedDecisionId: card.emptyAckDecisionId ?? '', fingerprint: card.emptyAckFingerprint ?? '',
      runtime: calls,
    })
    const again = await issuePauseOrder({ kernel: f.kernel, clientId: CLIENT_A, clicker: OPC, order, runtime: calls })
    expect(again.confirmEnabled).toBe(true)
    const done = await submitPauseCard({
      kernel: f.kernel, clientId: CLIENT_A, runId: again.runId ?? '', clicker: OPC,
      resolution: 'confirm', expectedDecisionId: again.expectedDecisionId ?? '', fingerprint: again.fingerprint ?? '',
      runtime: calls,
    })
    expect(done.status).toBe('executed')
    expect(calls.pauses).toBe(1)
  })
})

describe('pause adapter source', () => {
  it('never names an activate status', async () => {
    const { readFileSync } = await import('node:fs')
    const meta = readFileSync('src/lib/ads-pause-card/meta.ts', 'utf8')
    const flow = readFileSync('src/lib/ads-pause-card/flow.ts', 'utf8')
    expect(meta.includes('ACTIVE')).toBe(false)
    expect(flow.includes('ACTIVE')).toBe(false)
    expect(ACTION_KEYS.some((key) => key === PAUSE_CARD_POLICY_KEY)).toBe(false)
  })
})
