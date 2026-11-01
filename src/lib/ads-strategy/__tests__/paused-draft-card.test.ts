import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createCapabilities } from '@/lib/capabilities'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { CONFIRMATION_ACTION_KEY } from '@/lib/kernel/registry-confirmation'
import { CLIENT_A, CLIENT_B, makeFixture, type FixtureOptions } from '@/lib/kernel/__tests__/fixtures'
import { createFakeSupabase } from '@/lib/kernel/__tests__/fake-supabase'
import type { CardClicker } from '@/lib/confirmation-card'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import type { AdDraft } from '../ad-draft'
import { joinSpendPages, loadPausedDraftContext, readPaged } from '../paused-draft-context'
import { pausedDraftClickUrl, PAUSED_DRAFT_WHAT } from '../paused-draft-copy'
import { pausedDraftFacts, pausedDraftRetry } from '../paused-draft-facts'
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
  liveDeliveringCents: 0,
  campaignShapes: null,
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

function fixture(options?: FixtureOptions) {
  return makeFixture({
    registry: ACTION_REGISTRY,
    startAt: '2026-10-27T00:00:00.000Z',
    capabilities: (sb) => ({ [CONFIRMATION_ACTION_KEY]: createCapabilities(sb)[CONFIRMATION_ACTION_KEY] }),
    options,
  })
}

async function untilFlag(ready: () => boolean): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    if (ready()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('the cleanup write did not start')
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
  const createPaused = vi.fn(async (_draft: AdDraft, _deps: { adAccountId: string }) => outcome('awaiting_approval'))
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
    expect(createPaused).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ adAccountId: 'act_test' }))
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

  it('refuses to build when the ad account changed after the card was issued', async () => {
    const f = fixture()
    const { card, createPaused, resolveDeps } = await issued(f)
    expect(f.tables.flywheel_actions[0]?.payload).toMatchObject({ adAccountId: 'act_test' })
    const switched = {
      adAccountId: 'act_new',
      accounts: [{ ...REVIEW.accounts[0], ad_account_id: 'act_new' }],
      clientCapCents: REVIEW.clientCapCents,
      liveDeliveringCents: 0,
      campaignShapes: null,
    }
    resolveDeps.mockResolvedValue({
      supabase: f.supabase,
      adAccountId: 'act_new',
      accessToken: 'tok',
    })
    const drifted = await submitPausedDraftCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      runId: card.runId,
      clicker: OPC,
      resolution: 'confirm',
      expectedDecisionId: card.expectedDecisionId,
      fingerprint: card.fingerprint,
      review: switched,
      resolveDeps,
      createPaused,
    })
    expect(createPaused).not.toHaveBeenCalled()
    expect(drifted.wroteMeta).toBe(false)
    expect(drifted.resultLine).toContain('重新出一张确认卡')
    const again = await issuePausedDraftCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      clicker: OPC,
      draft: draft(),
      accountLabel: 'Old account',
      review: switched,
    })
    expect(again.runId).not.toBe(card.runId)
    const built = await submitPausedDraftCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      runId: again.runId,
      clicker: OPC,
      resolution: 'confirm',
      expectedDecisionId: again.expectedDecisionId,
      fingerprint: again.fingerprint,
      review: switched,
      resolveDeps,
      createPaused,
    })
    expect(createPaused).toHaveBeenCalledTimes(1)
    expect(createPaused).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ adAccountId: 'act_new' }))
    expect(built.queued).toBe(true)
  })

  it('does not issue another card for a draft that is building or already queued', async () => {
    const f = fixture()
    const { card, createPaused, resolveDeps } = await issued(f)
    const same = {
      kernel: f.kernel,
      clientId: CLIENT_A,
      clicker: OPC,
      draft: draft(),
      accountLabel: '这位客户的广告账户',
      review: REVIEW,
    }
    createPaused.mockImplementationOnce(async () => {
      await expect(issuePausedDraftCard(same)).rejects.toThrow('已经在建或已经送审')
      return outcome('awaiting_approval')
    })
    await submitPausedDraftCard({
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
    await expect(issuePausedDraftCard(same)).rejects.toThrow('已经在建或已经送审')
    expect(createPaused).toHaveBeenCalledTimes(1)
  })

  it('still confirms when history is long, and caps only the cards still waiting', async () => {
    const f = fixture()
    for (let i = 0; i < 60; i += 1) {
      f.tables.flywheel_actions.push({
        id: `built-${i}`,
        client_id: CLIENT_A,
        action_type: 'ads.paused_draft_hold',
        payload: {
          status: 'built',
          cardRunId: `built-run-${i}`,
          subjectKey: `meta-paused-draft:old${i}`,
          fingerprint: `fp-built-${i}`,
          draftHash: `hash-built-${i}`,
          draft: draft({ campaignName: `old ${i}` }),
          adAccountId: 'act_test',
          accountLabel: '这位客户的广告账户',
          wroteMeta: true,
          resultLine: '已经送审',
        },
      })
    }
    const { card, createPaused, resolveDeps } = await issued(f, draft({ campaignName: 'still open' }))
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
    expect(result.queued).toBe(true)
    expect(createPaused).toHaveBeenCalledTimes(1)

    for (let i = 0; i < 49; i += 1) {
      f.tables.flywheel_actions.push({
        id: `wait-${i}`,
        client_id: CLIENT_A,
        action_type: 'ads.paused_draft_hold',
        payload: {
          status: 'holding',
          cardRunId: `wait-run-${i}`,
          subjectKey: `meta-paused-draft:wait${i}`,
          fingerprint: `fp-wait-${i}`,
          draftHash: `hash-wait-${i}`,
          draft: draft({ campaignName: `wait ${i}` }),
          adAccountId: 'act_test',
          accountLabel: '这位客户的广告账户',
        },
      })
    }
    const waiting = await issued(f, draft({ campaignName: 'one more' }))
    await expect(issuePausedDraftCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      clicker: OPC,
      draft: draft({ campaignName: 'over the cap' }),
      accountLabel: '这位客户的广告账户',
      review: REVIEW,
    })).rejects.toThrow('待处理的建草稿记录太多')
    const declined = await submitPausedDraftCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      runId: waiting.card.runId,
      clicker: OPC,
      resolution: 'decline',
      expectedDecisionId: waiting.card.expectedDecisionId,
      fingerprint: waiting.card.fingerprint,
      review: REVIEW,
      resolveDeps: waiting.resolveDeps,
      createPaused: waiting.createPaused,
    })
    expect(waiting.createPaused).not.toHaveBeenCalled()
    expect(declined.resultLine).toContain('不做')
  })

  it('reissues the same draft after each card expires without using up the pending cap', async () => {
    const f = fixture()
    let now = Date.parse('2026-10-27T00:00:00.000Z')
    const step = 31 * 60 * 1000
    let first: Awaited<ReturnType<typeof issued>>['card'] | null = null
    for (let i = 0; i < 50; i += 1) {
      const card = await issuePausedDraftCard({
        kernel: f.kernel,
        clientId: CLIENT_A,
        clicker: OPC,
        draft: draft(),
        accountLabel: '这位客户的广告账户',
        review: REVIEW,
        now: new Date(now),
      })
      if (!first) first = card
      now += step
    }
    const again = await issuePausedDraftCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      clicker: OPC,
      draft: draft(),
      accountLabel: '这位客户的广告账户',
      review: REVIEW,
      now: new Date(now),
    })
    const holding = f.tables.flywheel_actions.filter((row) => {
      const payload = row.payload as { status?: string }
      return payload.status === 'holding'
    })
    expect(holding).toHaveLength(1)
    expect((holding[0]?.payload as { cardRunId?: string }).cardRunId).toBe(again.runId)
    if (!first) throw new Error('missing first card')
    const declined = await submitPausedDraftCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      runId: first.runId,
      clicker: OPC,
      resolution: 'decline',
      expectedDecisionId: first.expectedDecisionId,
      fingerprint: first.fingerprint,
      review: REVIEW,
      now: new Date(now),
    })
    expect(declined.wroteMeta).toBe(false)
    expect(declined.queued).toBe(false)
    expect(declined.resultLine).toContain('作废')
  })

  it('does not keep a replaced card in the pending cap', async () => {
    const f = fixture()
    const now = new Date('2026-10-27T00:00:00.000Z')
    for (let i = 0; i < 50; i += 1) {
      await issuePausedDraftCard({
        kernel: f.kernel,
        clientId: CLIENT_A,
        clicker: OPC,
        draft: draft({ dailyBudget: 20 + i }),
        accountLabel: '这位客户的广告账户',
        review: REVIEW,
        now,
      })
    }
    const latest = await issuePausedDraftCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      clicker: OPC,
      draft: draft({ dailyBudget: 80 }),
      accountLabel: '这位客户的广告账户',
      review: REVIEW,
      now,
    })
    const holding = f.tables.flywheel_actions.filter((row) => {
      const payload = row.payload as { status?: string }
      return payload.status === 'holding'
    })
    expect(holding).toHaveLength(1)
    expect((holding[0]?.payload as { cardRunId?: string }).cardRunId).toBe(latest.runId)
  })

  it('does not expire a hold that confirm already built while cleanup was waiting', async () => {
    let arm = false
    let held = false
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const f = fixture({
      supabaseOptions: {
        beforeOp: (table, op) => {
          if (!arm || held || table !== 'flywheel_actions' || op !== 'update') return
          held = true
          return gate
        },
      },
    })
    const original = draft()
    const old = await issuePausedDraftCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      clicker: OPC,
      draft: original,
      accountLabel: '这位客户的广告账户',
      review: REVIEW,
    })
    const createPaused = vi.fn(async () => outcome('awaiting_approval'))
    const resolveDeps = vi.fn(async (): Promise<CreateDraftDeps | null> => ({
      supabase: f.supabase,
      adAccountId: 'act_test',
      accessToken: 'tok',
    }))
    arm = true
    const replacing = issuePausedDraftCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      clicker: OPC,
      draft: draft({ dailyBudget: 40 }),
      accountLabel: '这位客户的广告账户',
      review: REVIEW,
    }).then(
      (card) => ({ card, error: null as unknown }),
      (error: unknown) => ({ card: null, error }),
    )
    await untilFlag(() => held)
    const built = await submitPausedDraftCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      runId: old.runId,
      clicker: OPC,
      resolution: 'confirm',
      expectedDecisionId: old.expectedDecisionId,
      fingerprint: old.fingerprint,
      review: REVIEW,
      resolveDeps,
      createPaused,
    })
    expect(built.queued).toBe(true)
    expect(createPaused).toHaveBeenCalledTimes(1)
    release()
    const replaced = await replacing
    expect(replaced.error).toBeNull()
    const row = f.tables.flywheel_actions.find((item) => {
      const payload = item.payload as { cardRunId?: string }
      return payload.cardRunId === old.runId
    })
    expect(row?.payload).toMatchObject({ status: 'built', wroteMeta: true, queued: true })
    expect((row?.payload as { resultLine?: string }).resultLine).toContain('审批队列')
    await expect(issuePausedDraftCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      clicker: OPC,
      draft: original,
      accountLabel: '这位客户的广告账户',
      review: REVIEW,
    })).rejects.toThrow('已经在建或已经送审')
    expect(createPaused).toHaveBeenCalledTimes(1)
  })
})

function freshCaptures(at: string) {
  return (['campaign', 'adset'] as const).map((level) => ({
    client_id: CLIENT_A,
    ad_account_id: 'act_test',
    level,
    complete: true,
    skipped_shared: false,
    error: null,
    captured_at: at,
  }))
}

function spendBase(adAccountId: string) {
  return {
    client_meta_ad_accounts: [{
      client_id: CLIENT_A,
      ad_account_id: adAccountId,
      label: '主账户',
      daily_budget_cap_cents: 20000,
    }],
    ad_strategy_configs: [{ client_id: CLIENT_A, daily_budget_cap_cents: 20000 }],
    clients: [{ id: CLIENT_A, name: '客户甲' }],
  }
}

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
      ad_snapshot_captures: [],
    })
    const loaded = await loadPausedDraftContext(sb, CLIENT_A, 'act_test')
    expect(loaded.accountLabel).toBe('主账户')
    expect(loaded.review.accounts?.[0]?.currency).toBe('NZD')
    expect(loaded.review.clientCapCents).toBe(20000)
    expect(loaded.review.liveDeliveringCents).toBeNull()
    expect(loaded.review.campaignShapes).toEqual([])
  })

  it('adds delivering daily budget and keeps a campaign-budget series visible', async () => {
    const now = new Date().toISOString()
    const sb = createFakeSupabase({
      client_meta_ad_accounts: [{
        client_id: CLIENT_A,
        ad_account_id: 'act_test',
        label: '主账户',
        daily_budget_cap_cents: 15000,
      }],
      ad_strategy_configs: [{ client_id: CLIENT_A, daily_budget_cap_cents: 20000 }],
      ad_entity_snapshots: [
        {
          client_id: CLIENT_A,
          ad_account_id: 'act_test',
          level: 'account',
          currency: 'NZD',
          captured_at: now,
        },
        {
          client_id: CLIENT_A,
          ad_account_id: 'act_test',
          level: 'campaign',
          entity_id: 'camp-1',
          campaign_id: 'camp-1',
          budget_level: 'abo',
          objective: 'OUTCOME_LEADS',
          effective_status: 'ACTIVE',
          daily_budget_minor: null,
          currency: 'NZD',
          capture_reason: 'daily',
          captured_at: now,
        },
        {
          client_id: CLIENT_A,
          ad_account_id: 'act_test',
          level: 'adset',
          entity_id: 'set-1',
          campaign_id: 'camp-1',
          budget_level: 'abo',
          objective: null,
          effective_status: 'ACTIVE',
          daily_budget_minor: 14500,
          currency: 'NZD',
          capture_reason: 'daily',
          captured_at: now,
        },
      ],
      clients: [{ id: CLIENT_A, name: '客户甲' }],
      ad_snapshot_captures: freshCaptures(now),
    })
    const loaded = await loadPausedDraftContext(sb, CLIENT_A, 'act_test')
    expect(loaded.review.liveDeliveringCents).toBe(14500)
    expect(loaded.review.campaignShapes).toEqual([
      { entityId: 'camp-1', objective: 'OUTCOME_LEADS', budgetLevel: 'abo' },
    ])
  })

  it('counts live budget on an account with no new draft, and blocks when the client total is over', async () => {
    const now = new Date().toISOString()
    const account = (adAccountId: string, label: string) => ({
      client_id: CLIENT_A,
      ad_account_id: adAccountId,
      label,
      daily_budget_cap_cents: null,
    })
    const snap = (adAccountId: string, level: string, entityId: string, minor: number | null) => ({
      client_id: CLIENT_A,
      ad_account_id: adAccountId,
      level,
      entity_id: entityId,
      campaign_id: level === 'account' ? null : `camp-${adAccountId}`,
      budget_level: level === 'account' ? null : 'abo',
      objective: level === 'campaign' ? 'OUTCOME_LEADS' : null,
      effective_status: 'ACTIVE',
      daily_budget_minor: minor,
      currency: 'NZD',
      capture_reason: 'daily',
      captured_at: now,
    })
    const captures = (adAccountId: string) => freshCaptures(now).map((item) => ({ ...item, ad_account_id: adAccountId }))
    const sb = createFakeSupabase({
      client_meta_ad_accounts: [account('act_a', '甲'), account('act_b', '乙')],
      ad_strategy_configs: [{ client_id: CLIENT_A, daily_budget_cap_cents: 10000 }],
      ad_entity_snapshots: [
        snap('act_a', 'account', 'acct-a', null),
        snap('act_b', 'account', 'acct-b', null),
        snap('act_a', 'campaign', `camp-act_a`, null),
        snap('act_b', 'campaign', `camp-act_b`, null),
        snap('act_a', 'adset', 'set-a', 2000),
        snap('act_b', 'adset', 'set-b', 8000),
      ],
      clients: [{ id: CLIENT_A, name: '客户甲' }],
      ad_snapshot_captures: [...captures('act_a'), ...captures('act_b')],
    })
    const loaded = await loadPausedDraftContext(sb, CLIENT_A, 'act_a')
    expect(loaded.review.liveByAccount).toEqual({ act_a: 2000, act_b: 8000 })
    const cap = pausedDraftFacts(draft({ dailyBudget: 30 }), '甲', loaded.review)
      .hardChecks.find((check) => check.label === '日预算上限')
    expect(cap?.state).toBe('red')
  })

  it('does not treat a stale snapshot or a mismatched account id as zero delivering', async () => {
    const stale = new Date(Date.now() - 3 * 86_400_000).toISOString()
    const old = createFakeSupabase({
      ...spendBase('act_10001'),
      ad_entity_snapshots: [{
        client_id: CLIENT_A,
        ad_account_id: 'act_10001',
        level: 'adset',
        entity_id: 'set-old',
        campaign_id: 'camp-old',
        budget_level: 'abo',
        effective_status: 'ACTIVE',
        daily_budget_minor: 9000,
        currency: 'NZD',
        capture_reason: 'daily',
        captured_at: stale,
      }],
      ad_snapshot_captures: freshCaptures(new Date().toISOString()).map((row) => ({ ...row, ad_account_id: 'act_10001' })),
    })
    const staleRead = await loadPausedDraftContext(old, CLIENT_A, 'act_10001')
    expect(staleRead.review.liveDeliveringCents).toBeNull()

    const now = new Date().toISOString()
    const mismatch = createFakeSupabase({
      ...spendBase('act_10001'),
      ad_entity_snapshots: [{
        client_id: CLIENT_A,
        ad_account_id: '10001',
        level: 'adset',
        entity_id: 'set-other',
        campaign_id: 'camp-other',
        budget_level: 'abo',
        effective_status: 'ACTIVE',
        daily_budget_minor: 8000,
        currency: 'NZD',
        capture_reason: 'daily',
        captured_at: now,
      }],
      ad_snapshot_captures: freshCaptures(now).map((row) => ({ ...row, ad_account_id: 'act_10001' })),
    })
    const mismatched = await loadPausedDraftContext(mismatch, CLIENT_A, 'act_10001')
    expect(mismatched.review.liveDeliveringCents).toBeNull()
  })

  it('does not treat a missing ad set capture as zero, and reads past the first snapshot page', async () => {
    const now = new Date().toISOString()
    const older = new Date(Date.now() - 60_000).toISOString()
    const campaigns = Array.from({ length: 1000 }, (_, index) => ({
      client_id: CLIENT_A,
      ad_account_id: 'act_10001',
      level: 'campaign',
      entity_id: `camp-${String(index).padStart(4, '0')}`,
      campaign_id: `camp-${String(index).padStart(4, '0')}`,
      budget_level: 'abo',
      objective: 'OUTCOME_LEADS',
      effective_status: 'ACTIVE',
      daily_budget_minor: null,
      currency: 'NZD',
      capture_reason: 'daily',
      captured_at: now,
    }))
    const sb = createFakeSupabase({
      ...spendBase('act_10001'),
      ad_entity_snapshots: [
        ...campaigns,
        {
          client_id: CLIENT_A,
          ad_account_id: 'act_10001',
          level: 'adset',
          entity_id: 'set-page-2',
          campaign_id: 'camp-0000',
          budget_level: 'abo',
          effective_status: 'ACTIVE',
          daily_budget_minor: 5000,
          currency: 'NZD',
          capture_reason: 'daily',
          captured_at: older,
        },
      ],
      ad_snapshot_captures: freshCaptures(now).map((row) => ({ ...row, ad_account_id: 'act_10001' })),
    })
    const paged = await loadPausedDraftContext(sb, CLIENT_A, 'act_10001')
    expect(paged.review.liveDeliveringCents).toBe(5000)

    const incomplete = createFakeSupabase({
      ...spendBase('act_10001'),
      ad_entity_snapshots: campaigns,
      ad_snapshot_captures: freshCaptures(now).map((row) => (
        row.level === 'adset' ? { ...row, ad_account_id: 'act_10001', complete: false, error: 'page failed' } : { ...row, ad_account_id: 'act_10001' }
      )),
    })
    const missingAdSets = await loadPausedDraftContext(incomplete, CLIENT_A, 'act_10001')
    expect(missingAdSets.review.liveDeliveringCents).toBeNull()
    expect(missingAdSets.review.campaignShapes?.length).toBe(1000)
  })

  it('treats a full snapshot page without a following short page as unread', async () => {
    const full = Array.from({ length: 1000 }, (_, index) => index)
    expect(joinSpendPages([full], 1000)).toBeNull()
    expect(joinSpendPages([full, full.slice(0, 1)], 1000)).toEqual([...full, 0])
    const failed = await readPaged<number>(async (from) => (from === 0 ? full : null), 1000)
    expect(failed).toBeNull()
  })

  it('shows an existing ad set by its real budget, not the draft numbers', async () => {
    const f = fixture()
    const item = draft({ existingAdSetId: '800001', dailyBudget: 15, durationDays: 7 })
    await expect(issuePausedDraftCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      clicker: OPC,
      draft: item,
      accountLabel: '这位客户的广告账户',
      review: REVIEW,
    })).rejects.toThrow('真实预算')

    const card = await issuePausedDraftCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      clicker: OPC,
      draft: item,
      accountLabel: '这位客户的广告账户',
      review: REVIEW,
      readSpend: async () => ({ ok: true, spend: { dailyBudget: 40, durationDays: null } }),
    })
    expect(card.amount).toContain('40.00')
    expect(card.amount).not.toContain('15.00')
    expect(card.date).toBe('这个广告组没有结束日')
    expect(card.confirmEnabled).toBe(true)
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
