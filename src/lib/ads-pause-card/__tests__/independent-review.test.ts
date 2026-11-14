import { describe, expect, it } from 'vitest'
import { createCapabilities } from '@/lib/capabilities'
import { ADS_METRIC_KEY } from '@/lib/flywheel/vocabulary'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { CONFIRMATION_ACTION_KEY } from '@/lib/kernel/registry-confirmation'
import { CLIENT_A, makeFixture, type FixtureOptions } from '@/lib/kernel/__tests__/fixtures'
import type { CardClicker } from '@/lib/confirmation-card'
import { issuePauseCards } from '../issue'

const OPC: CardClicker = { kind: 'opc', email: 'opc@example.com' }
const RX = 'a11ce000-0000-4000-8000-000000000001'
const GOAL = '90a10000-0000-4000-8000-00000000000b'
const PLAN = 'b1a00000-0000-4000-8000-000000000001'

function fixture(reviewOn: boolean, basis: string, options?: FixtureOptions) {
  return makeFixture({
    registry: ACTION_REGISTRY,
    startAt: '2026-11-08T00:00:00.000Z',
    capabilities: (sb) => ({ [CONFIRMATION_ACTION_KEY]: createCapabilities(sb)[CONFIRMATION_ACTION_KEY] }),
    options: {
      ...options,
      extraTables: {
        clients: [{
          id: CLIENT_A,
          leads_config: { pause_ad_set_card: true, ads_independent_review: reviewOn },
        }],
        prescriptions: [{
          id: RX,
          client_id: CLIENT_A,
          status: 'approved',
          version: 2,
          goal_id: GOAL,
          approved_at: '2026-11-08T00:00:00.000Z',
          content: {
            pause_ad_set: {
              ad_account_id: 'acct-a',
              campaign_id: 'camp-a',
              adset_id: 'set-a',
              metric: ADS_METRIC_KEY.SPEND,
              direction: 'pause',
              observation_days: 7,
              basis,
            },
          },
          generation_meta: { plan_draft: { plan_id: PLAN } },
        }],
        goals: [{ id: GOAL, client_id: CLIENT_A, status: 'active' }],
        marketing_plans: [{
          id: PLAN,
          client_id: CLIENT_A,
          status: 'approved',
          plan_data: {},
          generation_meta: {
            from_prescription: { prescription_id: RX, version: 2 },
            blank_draft: { goal_id: GOAL },
          },
        }],
      },
    },
  })
}

const LIVE_OK = {
  registeredAccountIds: ['acct-a'],
  target: { id: 'set-a', status: 'ACTIVE', accountId: 'acct-a' },
  campaignAdSets: [
    { id: 'set-a', status: 'ACTIVE', accountId: 'acct-a' },
    { id: 'set-b', status: 'ACTIVE', accountId: 'acct-a' },
  ],
}

function reviewMark(tables: { action_runs: Array<Record<string, unknown>> }) {
  const run = tables.action_runs.find((row) => row.action_key === CONFIRMATION_ACTION_KEY)
  const input = run?.input as { hard_checks?: string } | undefined
  const checks = JSON.parse(input?.hard_checks ?? '[]') as Array<{ label: string; state: string }>
  return { run, checks, mark: checks.find((item) => item.label === '独立复核') }
}

describe('pause suggestion review before pending', () => {
  it('marks a passing suggestion and still waits for a person', async () => {
    const f = fixture(true, '这一组花钱但没有结果')
    const result = await issuePauseCards({
      kernel: f.kernel,
      clientId: CLIENT_A,
      clicker: OPC,
      live: async () => LIVE_OK,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items[0]).toMatchObject({ status: 'issued', confirmEnabled: true })
    const stored = reviewMark(f.tables)
    expect(stored.run?.status).toBe('pending_approval')
    expect(stored.mark).toMatchObject({ state: 'green' })
    expect(f.tables.flywheel_actions.every((row) => row.payload && (row.payload as { wrote?: boolean }).wrote !== true)).toBe(true)
  })

  it('does not open a pending card when the shared red line hits', async () => {
    const f = fixture(true, '已帮你暂停这条广告')
    const result = await issuePauseCards({
      kernel: f.kernel,
      clientId: CLIENT_A,
      clicker: OPC,
      live: async () => LIVE_OK,
    })
    expect(result).toMatchObject({
      ok: true,
      items: [{ status: 'blocked', confirmEnabled: false }],
    })
    if (!result.ok) return
    expect(result.items[0]?.reason).toContain('直接写')
    expect(result.items[0]?.runId).toBeUndefined()
    expect(f.tables.action_runs).toEqual([])
    expect(f.tables.flywheel_actions).toEqual([])
  })

  it('keeps today\'s card when the switch is off', async () => {
    const f = fixture(false, '已帮你暂停这条广告')
    const result = await issuePauseCards({
      kernel: f.kernel,
      clientId: CLIENT_A,
      clicker: OPC,
      live: async () => LIVE_OK,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items[0]).toMatchObject({ status: 'issued', confirmEnabled: true })
    expect(reviewMark(f.tables).mark).toBeUndefined()
    expect(reviewMark(f.tables).run?.status).toBe('pending_approval')
  })
})
