/**
 * Card-gated Meta writes must refuse when the confirmation card is missing,
 * mismatched, expired, or not confirmed. Winner and budget cards already
 * cover expiry in their own tests; this file covers the other three gates.
 */

import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { KernelDeps } from '@/lib/kernel/deps'
import { createCapabilities } from '@/lib/capabilities'
import { CLIENT_A, makeFixture } from '@/lib/kernel/__tests__/fixtures'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { CONFIRMATION_ACTION_KEY } from '@/lib/kernel/registry-confirmation'
import { CONFIRMATION_TTL_MS } from '@/lib/confirmation-card/view'
import type { CardClicker } from '@/lib/confirmation-card'
import { ADS_ACTION_TYPE, ADS_METRIC_KEY } from '@/lib/flywheel/vocabulary'
import { approvalPlanHash, type ApprovalSource } from '@/lib/approval-source/read'
import { confirmPauseCard } from '@/lib/ads-pause-card/confirm'
import { orderKey, type PauseAdSetOrder } from '@/lib/ads-pause-card/order'
import type { PauseHold } from '@/lib/ads-pause-card/ledger'
import { decideGoLive, issueGoLive } from '@/lib/ads-go-live/decide'
import type { AdDraft } from '@/lib/ads-strategy/ad-draft'
import { issuePausedDraftCard, submitPausedDraftCard } from '@/lib/ads-strategy/paused-draft-submit'
import type { CreateDraftDeps } from '@/lib/ads-strategy/draft-and-gate'

const OPC: CardClicker = { kind: 'opc', email: 'opc@example.com' }
const START = '2026-10-28T00:00:00.000Z'

function kernel() {
  return makeFixture({
    registry: ACTION_REGISTRY,
    startAt: START,
    capabilities: (sb) => ({ [CONFIRMATION_ACTION_KEY]: createCapabilities(sb)[CONFIRMATION_ACTION_KEY] }),
  })
}

function later(): Date {
  return new Date(Date.parse(START) + CONFIRMATION_TTL_MS + 60_000)
}

describe('go-live refuses without a confirmed card', () => {
  const facts = {
    subjectKey: 'go-live:draft-1',
    what: '开投：把暂停的广告改成在投',
    account: '演示广告账户',
    amount: '按这张卡上已经写明的日预算',
    date: '从点下去的这一天开始',
    scope: '开到广告、广告组和广告系列这三层',
    hardChecks: [{ label: '开投前检查', state: 'green' as const, reason: '检查是绿灯' }],
  }

  it('does not settle an expired card or a missing card', async () => {
    const f = kernel()
    const issued = await issueGoLive({ kernel: f.kernel, clientId: CLIENT_A, clicker: OPC, facts })
    const settle = vi.fn()
    const expired = await decideGoLive({
      kernel: f.kernel,
      clientId: CLIENT_A,
      clicker: OPC,
      draftId: 'draft-1',
      facts,
      resolution: 'confirm',
      expectedDecisionId: issued.card.expectedDecisionId,
      fingerprint: issued.card.fingerprint,
      runId: issued.card.runId,
      now: later(),
      settle,
    })
    expect(expired.outcome).not.toBe('live')
    expect(expired.resultLine).toMatch(/没有开投/)
    expect(settle).not.toHaveBeenCalled()

    await expect(decideGoLive({
      kernel: f.kernel,
      clientId: CLIENT_A,
      clicker: OPC,
      draftId: 'draft-1',
      facts,
      resolution: 'confirm',
      expectedDecisionId: issued.card.expectedDecisionId,
      fingerprint: issued.card.fingerprint,
      runId: 'missing-run',
      settle,
    })).rejects.toThrow(/找不到/)
    expect(settle).not.toHaveBeenCalled()
  })
})

const REVIEW = {
  adAccountId: 'act_test',
  accounts: [{
    ad_account_id: 'act_test',
    currency: 'NZD',
    daily_cap_cents: 10000,
    owned_by_client: true,
  }],
  clientCapCents: 20000,
}

function draft(): AdDraft {
  return {
    kind: 'lead_form',
    clientId: CLIENT_A,
    campaignName: 'lead campaign',
    adSetName: 'group',
    dailyBudget: 30,
    durationDays: 7,
    geoCountries: ['NZ'],
    pageId: 'page-1',
    leadFormId: 'form-1',
    creatives: [{ name: 'A', primaryText: 'Hello there', headline: 'Read more', imageHash: 'hash-1' }],
  }
}

describe('paused draft refuses without a confirmed card', () => {
  it('does not publish when the card has expired', async () => {
    const f = kernel()
    const card = await issuePausedDraftCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      clicker: OPC,
      draft: draft(),
      accountLabel: '这位客户的广告账户',
      review: REVIEW,
    })
    const createPaused = vi.fn()
    const resolveDeps = vi.fn(async (): Promise<CreateDraftDeps | null> => ({
      supabase: f.supabase,
      adAccountId: 'act_test',
      accessToken: 'tok',
    }))
    const result = await submitPausedDraftCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      runId: card.runId,
      clicker: OPC,
      resolution: 'confirm',
      expectedDecisionId: card.expectedDecisionId,
      fingerprint: card.fingerprint,
      review: REVIEW,
      resolveDeps,
      createPaused,
      now: later(),
    })
    expect(createPaused).not.toHaveBeenCalled()
    expect(result.wroteMeta).toBe(false)
    expect(result.resultLine).toMatch(/不能用来建|作废|过了/)
  })
})

const ORDER: PauseAdSetOrder = {
  prescriptionId: 'rx-1',
  version: 2,
  adAccountId: 'acct-a',
  campaignId: 'camp-a',
  adsetId: 'set-a',
  metric: ADS_METRIC_KEY.SPEND,
  direction: 'pause',
  observationDays: 7,
  basis: '这一组花钱但没有结果',
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

function pauseHold(): PauseHold {
  return {
    status: 'holding',
    cardRunId: 'run-1',
    fingerprint: 'a'.repeat(64),
    orderKey: orderKey(ORDER),
    order: ORDER,
    goalId: 'goal-1',
    planId: 'plan-1',
    source: pauseSource(),
    before: null,
    after: null,
    wrote: false,
  }
}

function db(rows: Array<Record<string, unknown>>): SupabaseClient {
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

function pauseRows(): Array<Record<string, unknown>> {
  return [
    {
      id: 'hold-1',
      client_id: 'client-1',
      action_type: ADS_ACTION_TYPE.PAUSE_AD_SET,
      payload: pauseHold(),
    },
    {
      id: 'rx-1',
      client_id: 'client-1',
      status: 'approved',
      version: 2,
      goal_id: 'goal-1',
      approved_at: '2026-11-08T00:00:00.000Z',
      content: {
        pause_ad_set: {
          ad_account_id: ORDER.adAccountId,
          campaign_id: ORDER.campaignId,
          adset_id: ORDER.adsetId,
          metric: ORDER.metric,
          direction: 'pause',
          observation_days: ORDER.observationDays,
          basis: ORDER.basis,
        },
      },
      generation_meta: { plan_draft: { plan_id: 'plan-1' } },
    },
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
  ]
}

describe('ad-set pause refuses without a confirmed card', () => {
  const live = async () => ({
    registeredAccountIds: ['acct-a'],
    target: { id: 'set-a', status: 'ACTIVE', accountId: 'acct-a' },
    campaignAdSets: [
      { id: 'set-a', status: 'ACTIVE', accountId: 'acct-a' },
      { id: 'set-b', status: 'ACTIVE', accountId: 'acct-a' },
    ],
  })

  it('does not pause when there is no confirmation card for the hold', async () => {
    const execute = vi.fn()
    const kernelDeps = {
      supabase: db(pauseRows()),
      now: () => new Date(START),
      requireRun: async () => ({
        id: 'run-1',
        client_id: 'client-1',
        action_key: 'not-a-confirmation-card',
        status: 'pending_approval',
        input: {},
        authorization_decision_id: null,
      }),
    } as unknown as KernelDeps
    await expect(confirmPauseCard({
      kernel: kernelDeps,
      clientId: 'client-1',
      runId: 'run-1',
      clicker: OPC,
      resolution: 'confirm',
      expectedDecisionId: 'decision-1',
      fingerprint: 'a'.repeat(64),
      live,
      execute,
    })).rejects.toThrow(/找不到这张确认卡/)
    expect(execute).not.toHaveBeenCalled()
  })

  it('does not pause when the hold or the fingerprint is missing', async () => {
    const execute = vi.fn()
    const base = {
      kernel: {
        supabase: db([]),
        now: () => new Date(START),
        requireRun: vi.fn(),
      } as unknown as KernelDeps,
      clientId: 'client-1',
      runId: 'run-1',
      clicker: OPC,
      resolution: 'confirm' as const,
      expectedDecisionId: 'decision-1',
      fingerprint: 'a'.repeat(64),
      live,
      execute,
    }
    const missing = await confirmPauseCard(base)
    expect(missing.wrote).toBe(false)
    expect(missing.reason).toMatch(/找不到/)

    const mismatch = await confirmPauseCard({
      ...base,
      kernel: {
        supabase: db(pauseRows()),
        now: () => new Date(START),
        requireRun: vi.fn(),
      } as unknown as KernelDeps,
      fingerprint: 'b'.repeat(64),
    })
    expect(mismatch.wrote).toBe(false)
    expect(mismatch.reason).toMatch(/不是这一张卡/)
    expect(execute).not.toHaveBeenCalled()
  })
})
