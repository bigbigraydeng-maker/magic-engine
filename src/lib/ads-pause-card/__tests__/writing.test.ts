import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { KernelDeps } from '@/lib/kernel/deps'
import { ADS_ACTION_TYPE, ADS_METRIC_KEY } from '@/lib/flywheel/vocabulary'
import { approvalPlanHash, type ApprovalSource } from '@/lib/approval-source/read'
import { confirmPauseCard } from '../confirm'
import { issuePauseCards } from '../issue'
import type { PauseHold } from '../ledger'
import { orderKey, type PauseAdSetOrder } from '../order'

const payload: PauseHold = {
  status: 'writing',
  cardRunId: 'run-1',
  fingerprint: 'a'.repeat(64),
  orderKey: 'order-1',
  order: {
    prescriptionId: 'rx-1',
    version: 2,
    adAccountId: 'acct-a',
    campaignId: 'camp-a',
    adsetId: 'set-a',
    metric: ADS_METRIC_KEY.SPEND,
    direction: 'pause',
    observationDays: 7,
    basis: '这一组花钱但没有结果',
  },
  goalId: 'goal-1',
  planId: 'plan-1',
  source: null,
  before: null,
  after: null,
  wrote: false,
}

function db(rowOrRows: Record<string, unknown> | Array<Record<string, unknown>>): SupabaseClient {
  const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]
  return {
    from() {
      const filters: Array<[string, unknown]> = []
      const matched = () => rows.filter((item) => filters.every(([column, value]) => read(item, column) === value))
      const self = {
        select() { return self },
        eq(column: string, value: unknown) {
          filters.push([column, value])
          return self
        },
        maybeSingle: async () => ({ data: matched()[0] ?? null, error: null }),
        then(onFulfilled: (value: { data: unknown; error: null }) => unknown) {
          return Promise.resolve({ data: matched(), error: null }).then(onFulfilled)
        },
      }
      return self
    },
  } as unknown as SupabaseClient
}

function read(row: Record<string, unknown>, column: string): unknown {
  if (!column.startsWith('payload->>')) return row[column]
  if (!row.payload || typeof row.payload !== 'object') return undefined
  return (row.payload as Record<string, unknown>)[column.slice('payload->>'.length)]
}

describe('writing ledger', () => {
  it('never calls pause again', async () => {
    const execute = vi.fn()
    const result = await confirmPauseCard({
      kernel: {
        supabase: db({
          id: 'hold-1',
          client_id: 'client-1',
          action_type: ADS_ACTION_TYPE.PAUSE_AD_SET,
          payload,
        }),
        now: () => new Date('2026-11-08T00:00:00.000Z'),
        requireRun: vi.fn(),
      } as unknown as KernelDeps,
      clientId: 'client-1',
      runId: 'run-1',
      clicker: { kind: 'opc', email: 'ray@example.com' },
      resolution: 'confirm',
      expectedDecisionId: 'decision-1',
      fingerprint: payload.fingerprint,
      live: vi.fn(),
      execute,
    })
    expect(result.wrote).toBe(false)
    expect(result.reason).toContain('不会自动再写')
    expect(execute).not.toHaveBeenCalled()
  })

  it('refuses to pause the last active ad set and does not write', async () => {
    const order = payload.order
    const execute = vi.fn()
    const result = await confirmPauseCard({
      kernel: kernelFor([
        holdRow({ ...payload, status: 'holding', orderKey: orderKey(order), source: pauseSource() }),
        prescriptionRow(order),
        { id: 'goal-1', client_id: 'client-1', status: 'active' },
        {
          id: 'plan-1',
          client_id: 'client-1',
          status: 'approved',
          plan_data: {},
          generation_meta: {
            from_prescription: { prescription_id: 'rx-1', version: 2 },
            blank_draft: { goal_id: 'goal-1' },
          },
        },
      ]),
      clientId: 'client-1',
      runId: 'run-1',
      clicker: { kind: 'opc', email: 'ray@example.com' },
      resolution: 'confirm',
      expectedDecisionId: 'decision-1',
      fingerprint: payload.fingerprint,
      live: async () => ({
        registeredAccountIds: ['acct-a'],
        target: { id: 'set-a', status: 'ACTIVE', accountId: 'acct-a' },
        campaignAdSets: [{ id: 'set-a', status: 'ACTIVE', accountId: 'acct-a' }],
      }),
      execute,
    })
    expect(result.wrote).toBe(false)
    expect(result.reason).toContain('没有在投广告组')
    expect(execute).not.toHaveBeenCalled()
  })
})

describe('switch off', () => {
  it('does not read a prescription or call Meta when the switch is missing', async () => {
    const live = vi.fn()
    const result = await issuePauseCards({
      kernel: kernelFor([{ id: 'client-1', leads_config: { notify_emails: ['a@example.com'] } }]),
      clientId: 'client-1',
      clicker: { kind: 'opc', email: 'ray@example.com' },
      live,
    })
    expect(result).toMatchObject({ ok: true, items: [{ status: 'off' }] })
    expect(live).not.toHaveBeenCalled()
  })
})

function holdRow(body: PauseHold): Record<string, unknown> {
  return { id: 'hold-1', client_id: 'client-1', action_type: ADS_ACTION_TYPE.PAUSE_AD_SET, payload: body }
}

function prescriptionRow(order: PauseAdSetOrder): Record<string, unknown> {
  return {
    id: 'rx-1',
    client_id: 'client-1',
    status: 'approved',
    version: 2,
    goal_id: 'goal-1',
    approved_at: '2026-11-08T00:00:00.000Z',
    content: {
      pause_ad_set: {
        ad_account_id: order.adAccountId,
        campaign_id: order.campaignId,
        adset_id: order.adsetId,
        metric: order.metric,
        direction: 'pause',
        observation_days: order.observationDays,
        basis: order.basis,
      },
    },
    generation_meta: { plan_draft: { plan_id: 'plan-1' } },
  }
}

function pauseSource(): ApprovalSource {
  return {
    prescriptionId: 'rx-1',
    version: 2,
    goalId: 'goal-1',
    planId: 'plan-1',
    planHash: approvalPlanHash('plan-1', null),
    approvedOn: '2026-11-08',
  }
}

function kernelFor(rows: Array<Record<string, unknown>>): KernelDeps {
  return {
    supabase: db(rows),
    now: () => new Date('2026-11-08T00:00:00.000Z'),
    requireRun: vi.fn(),
  } as unknown as KernelDeps
}
