import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createCapabilities } from '@/lib/capabilities'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { CONFIRMATION_ACTION_KEY } from '@/lib/kernel/registry-confirmation'
import { CLIENT_A, CLIENT_B, makeFixture } from '@/lib/kernel/__tests__/fixtures'
import { createFakeSupabase } from '@/lib/kernel/__tests__/fake-supabase'
import type { CardClicker } from '@/lib/confirmation-card'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import type { AdDraft } from '../ad-draft'
import { loadPausedDraftContext } from '../paused-draft-context'
import { pausedDraftClickUrl, PAUSED_DRAFT_WHAT } from '../paused-draft-copy'
import { pausedDraftRetry } from '../paused-draft-facts'
import { issuePausedDraftCard, submitPausedDraftCard } from '../paused-draft-submit'
import type { CreateDraftDeps, CreateDraftOutcome } from '../draft-and-gate'

const OPC: CardClicker = { kind: 'opc', email: 'opc@example.com' }
const FDE: CardClicker = { kind: 'fde', email: 'fde@example.com', clientId: CLIENT_A }
const OTHER: CardClicker = { kind: 'fde', email: 'other@example.com', clientId: CLIENT_B }
const STAFF: CardClicker = { kind: 'client_staff', email: 'staff@example.com' }
const AGENT: CardClicker = { kind: 'agent', email: null }

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

function draft(over: Partial<AdDraft> = {}): AdDraft {
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
    ...over,
  }
}

function fixture() {
  return makeFixture({
    registry: ACTION_REGISTRY,
    startAt: '2026-10-27T00:00:00.000Z',
    capabilities: (sb) => ({ [CONFIRMATION_ACTION_KEY]: createCapabilities(sb)[CONFIRMATION_ACTION_KEY] }),
  })
}

function outcome(status: CreateDraftOutcome['status'], error?: string): CreateDraftOutcome {
  return { actionId: 'action-1', status, summary: 'summary', findings: [], readback: '回读记下了', error }
}

async function issued(f: ReturnType<typeof fixture>, item = draft(), review = REVIEW) {
  const card = await issuePausedDraftCard({
    kernel: f.kernel,
    clientId: CLIENT_A,
    clicker: OPC,
    draft: item,
    accountLabel: '这位客户的广告账户',
    review,
  })
  const createPaused = vi.fn(async () => outcome('awaiting_approval'))
  const resolveDeps = vi.fn(async (): Promise<CreateDraftDeps | null> => ({
    supabase: f.supabase,
    adAccountId: 'act_test',
    accessToken: 'tok',
  }))
  return { card, createPaused, resolveDeps }
}

describe('paused draft confirmation', () => {
  it('issues a card and does not call the publisher', async () => {
    const f = fixture()
    const { card } = await issued(f)
    expect(card.what).toBe(PAUSED_DRAFT_WHAT)
    expect(card.confirmEnabled).toBe(true)
    expect(card.scope).toContain('1 个暂停系列')
    expect(card.scope).toContain('不开启')
    const types = f.tables.flywheel_actions.map((row) => row.action_type)
    expect(types).toEqual(['ads.paused_draft_hold'])
  })

  it('builds a paused draft only after confirm, then puts it in the approval queue', async () => {
    const f = fixture()
    const { card, createPaused, resolveDeps } = await issued(f)
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
    })
    expect(createPaused).toHaveBeenCalledTimes(1)
    expect(result.queued).toBe(true)
    expect(result.wroteMeta).toBe(true)
    expect(result.resultLine).toContain('opc@example.com')
    expect(result.resultLine).toContain('审批队列')
    const again = await submitPausedDraftCard({
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
    })
    expect(createPaused).toHaveBeenCalledTimes(1)
    expect(again.queued).toBe(true)
  })

  it('does not build when the person declines', async () => {
    const f = fixture()
    const { card, createPaused, resolveDeps } = await issued(f)
    const result = await submitPausedDraftCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      runId: card.runId,
      clicker: FDE,
      resolution: 'decline',
      expectedDecisionId: card.expectedDecisionId,
      fingerprint: card.fingerprint,
      review: REVIEW,
      resolveDeps,
      createPaused,
    })
    expect(createPaused).not.toHaveBeenCalled()
    expect(result.wroteMeta).toBe(false)
    expect(result.resultLine).toContain('不做')
  })

  it('does not build when the cap no longer fits, or the token is missing', async () => {
    const f = fixture()
    const { card, createPaused, resolveDeps } = await issued(f)
    const tight = {
      ...REVIEW,
      accounts: [{ ...REVIEW.accounts[0], daily_cap_cents: 1000 }],
    }
    const over = await submitPausedDraftCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      runId: card.runId,
      clicker: OPC,
      resolution: 'confirm',
      expectedDecisionId: card.expectedDecisionId,
      fingerprint: card.fingerprint,
      review: tight,
      resolveDeps,
      createPaused,
    })
    expect(createPaused).not.toHaveBeenCalled()
    expect(over.resultLine).toContain('没有去建')

    const f2 = fixture()
    const second = await issued(f2)
    resolveDeps.mockResolvedValueOnce(null)
    const missing = await submitPausedDraftCard({
      kernel: f2.kernel,
      clientId: CLIENT_A,
      runId: second.card.runId,
      clicker: OPC,
      resolution: 'confirm',
      expectedDecisionId: second.card.expectedDecisionId,
      fingerprint: second.card.fingerprint,
      review: REVIEW,
      resolveDeps,
      createPaused,
    })
    expect(createPaused).not.toHaveBeenCalled()
    expect(missing.resultLine).toContain('拿不到广告授权')
  })

  it('keeps a readback mismatch paused and out of the queue', async () => {
    const f = fixture()
    const { card, createPaused, resolveDeps } = await issued(f)
    createPaused.mockResolvedValueOnce(outcome('blocked', '对不上'))
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
    })
    expect(result.queued).toBe(false)
    expect(result.wroteMeta).toBe(true)
    expect(result.resultLine).toContain('保持暂停')
    expect(result.resultLine).toContain('不删除')
  })

  it('stops after the same Meta error class has already failed twice', async () => {
    const f = fixture()
    const first = await issued(f, draft({ dailyBudget: 20 }))
    first.createPaused.mockResolvedValueOnce(outcome('failed', 'HTTP 400: no'))
    await submitPausedDraftCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      runId: first.card.runId,
      clicker: OPC,
      resolution: 'confirm',
      expectedDecisionId: first.card.expectedDecisionId,
      fingerprint: first.card.fingerprint,
      review: REVIEW,
      resolveDeps: first.resolveDeps,
      createPaused: first.createPaused,
    })
    const second = await issued(f, draft({ dailyBudget: 25, campaignName: 'lead campaign' }))
    second.createPaused.mockResolvedValueOnce(outcome('failed', 'HTTP 400: still no'))
    await submitPausedDraftCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      runId: second.card.runId,
      clicker: OPC,
      resolution: 'confirm',
      expectedDecisionId: second.card.expectedDecisionId,
      fingerprint: second.card.fingerprint,
      review: REVIEW,
      resolveDeps: second.resolveDeps,
      createPaused: second.createPaused,
    })
    const third = await issued(f, draft({ dailyBudget: 28 }))
    const stopped = await submitPausedDraftCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      runId: third.card.runId,
      clicker: OPC,
      resolution: 'confirm',
      expectedDecisionId: third.card.expectedDecisionId,
      fingerprint: third.card.fingerprint,
      review: REVIEW,
      resolveDeps: third.resolveDeps,
      createPaused: third.createPaused,
    })
    expect(third.createPaused).not.toHaveBeenCalled()
    expect(stopped.resultLine).toContain('同一类错误')
  })

  it('refuses a multi-set draft even when the pre-build review would pass', async () => {
    const f = fixture()
    const many = draft({
      adSetName: '',
      geoCountries: [],
      creatives: [],
      budgetMode: 'ad_set',
      dailyBudget: 30,
      adSets: [
        {
          name: 'group-a',
          dailyBudget: 15,
          geoCountries: ['NZ'],
          creatives: [{ name: 'A', primaryText: 'Hello there', headline: 'Read more', imageHash: 'hash-1' }],
          audienceIds: ['1111111'],
          expansion: { advantageAudience: false, customAudienceRelaxed: false, lookalikeRelaxed: false },
        },
        {
          name: 'group-b',
          dailyBudget: 15,
          geoCountries: ['NZ'],
          creatives: [{ name: 'B', primaryText: 'Hello there', headline: 'Read more', imageHash: 'hash-1' }],
        },
      ],
    })
    const { card, createPaused, resolveDeps } = await issued(f, many)
    expect(card.confirmEnabled).toBe(false)
    await expect(submitPausedDraftCard({
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
    })).rejects.toBeInstanceOf(ConfirmationCardError)
    expect(createPaused).not.toHaveBeenCalled()
  })

  it('refuses an agent, staff, and another client FDE', async () => {
    const f = fixture()
    const card = await issuePausedDraftCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      clicker: AGENT,
      draft: draft(),
      accountLabel: '这位客户的广告账户',
      review: REVIEW,
    })
    const createPaused = vi.fn(async () => outcome('awaiting_approval'))
    await expect(submitPausedDraftCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      runId: card.runId,
      clicker: AGENT,
      resolution: 'confirm',
      expectedDecisionId: card.expectedDecisionId,
      fingerprint: card.fingerprint,
      review: REVIEW,
      createPaused,
    })).rejects.toBeInstanceOf(ConfirmationCardError)
    await expect(issuePausedDraftCard({
      kernel: f.kernel, clientId: CLIENT_A, clicker: STAFF, draft: draft(), accountLabel: '这位客户的广告账户', review: REVIEW,
    })).rejects.toBeInstanceOf(ConfirmationCardError)
    await expect(issuePausedDraftCard({
      kernel: f.kernel, clientId: CLIENT_A, clicker: OTHER, draft: draft(), accountLabel: '这位客户的广告账户', review: REVIEW,
    })).rejects.toBeInstanceOf(ConfirmationCardError)
    expect(createPaused).not.toHaveBeenCalled()
  })
})

describe('paused draft helpers', () => {
  it('allows one changed retry and then stops on the same error class', () => {
    expect(pausedDraftRetry([], 'a')).toBe('allow')
    expect(pausedDraftRetry([{ fingerprint: 'a', errorClass: 'meta-400' }], 'a')).toBe('same')
    expect(pausedDraftRetry([{ fingerprint: 'a', errorClass: 'meta-400' }], 'b')).toBe('allow')
    expect(pausedDraftRetry([
      { fingerprint: 'a', errorClass: 'meta-400' },
      { fingerprint: 'b', errorClass: 'meta-400' },
    ], 'c')).toBe('escalate')
  })

  it('sends only the paused-draft card to its own click address', () => {
    expect(pausedDraftClickUrl('c1', 'r1', PAUSED_DRAFT_WHAT)).toBe('/api/clients/c1/meta-ads/paused-draft-card/r1')
    expect(pausedDraftClickUrl('c1', 'r1', '记下要不要调每周预算')).toContain('/confirmation-cards/r1/decision')
  })

  it('reads the cap from stored rows and does not invent one', async () => {
    const sb = createFakeSupabase({
      client_meta_ad_accounts: [{
        client_id: CLIENT_A,
        ad_account_id: 'act_test',
        label: '主账户',
        daily_budget_cap_cents: 10000,
      }],
      ad_strategy_configs: [{ client_id: CLIENT_A, daily_budget_cap_cents: 20000 }],
      ad_entity_snapshots: [{
        client_id: CLIENT_A,
        ad_account_id: 'act_test',
        level: 'account',
        currency: 'NZD',
        captured_at: '2026-10-27T00:00:00.000Z',
      }],
      clients: [{ id: CLIENT_A, name: '客户甲' }],
    })
    const loaded = await loadPausedDraftContext(sb, CLIENT_A, 'act_test')
    expect(loaded.accountLabel).toBe('主账户')
    expect(loaded.review.accounts?.[0]?.currency).toBe('NZD')
    expect(loaded.review.clientCapCents).toBe(20000)
  })

  it('is not wired into prescription agreement', () => {
    const landing = readFileSync('src/lib/diagnostic/prescription-landing.ts', 'utf8')
    const dialog = readFileSync('src/app/dashboard/clients/[id]/prescription/new/dialog/decide-turn.ts', 'utf8')
    const submit = readFileSync('src/lib/ads-strategy/paused-draft-submit.ts', 'utf8')
    expect(landing).not.toContain('paused-draft')
    expect(landing).not.toContain('createDraftForApproval')
    expect(dialog).not.toContain('paused-draft')
    expect(submit).not.toContain('activatePublished')
    expect(submit).not.toContain('ME_SERVICE_PAUSE_ENABLED')
    expect(submit).not.toContain("'ACTIVE'")
  })
})
