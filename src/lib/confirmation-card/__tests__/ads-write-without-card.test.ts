/**
 * Card-gated Meta writes must refuse when the confirmation card is missing,
 * mismatched, expired, or not confirmed. Winner and budget cards already
 * cover expiry in their own tests; this file covers the other three gates.
 */

import { readFileSync } from 'node:fs'
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
import { askDirectPausedDraft } from '@/lib/ads-strategy/direct-draft-card'
import { admitFinishedAsset, type AdmitDeps, type AdmitWorkOrder } from '@/lib/ads-strategy/admit-finished-asset'
import { pausedDraftClickUrl, VIDEO_UPLOAD_WHAT } from '@/lib/ads-strategy/paused-draft-copy'
import {
  confirmVideoUploadCard,
  requestVideoUploadCard,
  uploadOrAsk,
  VIDEO_UPLOAD_HOLD,
} from '@/lib/ads-strategy/video-upload-card'
import { writeHeldBudget } from '@/lib/action-submission/money-card-write'
import type { MoneyHold } from '@/lib/action-submission/money-card'

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

const EIGHT = [
  {
    name: 'paused draft ask',
    file: 'src/app/api/clients/[id]/meta-ads/draft/route.ts',
    present: ['askDirectPausedDraft', 'issuePausedDraftCard'],
    absent: ['createDraftForApproval(', 'publishDraftPaused('],
  },
  {
    name: 'listing draft ask',
    file: 'src/app/api/clients/[id]/meta-ads/draft-listing/route.ts',
    present: ['issueListingDraftCard'],
    absent: ['uploadAssetToMeta(', 'createDraftForApproval(', 'uploadVideoToMeta('],
  },
  {
    name: 'stop-loss ask',
    file: 'src/app/api/clients/[id]/ad-health/stop-loss/route.ts',
    present: ['issueMoneyBudget', 'requestCampaignStatusCard'],
    absent: ['submitStopLossThroughKernel(', 'setCampaignStatus(', 'setCampaignDailyBudget(', 'executeStopLoss('],
  },
  {
    name: 'scorecard budget ask',
    file: 'src/app/api/clients/[id]/ad-health/budget-change/route.ts',
    present: ['issueMoneyBudget', 'LIVE_PLAN_INCREASE_REFUSED'],
    absent: ['submitStopLossThroughKernel(', 'queueRaiseAfterCard(', 'submitAdsO1BudgetScale('],
  },
  {
    name: 'opportunity raise ask',
    file: 'src/app/api/clients/[id]/ad-health/o1-scale/route.ts',
    present: ['LIVE_PLAN_INCREASE_REFUSED'],
    absent: ['issueMoneyBudget(', 'submitAdsO1BudgetScale(', 'setCampaignDailyBudget('],
  },
  {
    name: 'opportunity raise decision',
    file: 'src/app/api/clients/[id]/ad-health/o1-scale/[runId]/decision/route.ts',
    present: ['LIVE_PLAN_INCREASE_REFUSED', 'refuseLivePlanIncrease'],
    absent: ['inngest.send(', 'approveRun(', 'setCampaignDailyBudget('],
  },
  {
    name: 'auto-pause decision',
    file: 'src/app/api/clients/[id]/ad-health/auto-pause/[runId]/decision/route.ts',
    present: ['issueMoneyPause'],
    absent: ['setAdSetStatus('],
  },
  {
    name: 'service pause ask',
    file: 'src/lib/meta/service-pause-only.ts',
    present: ['requestCampaignStatusCard', 'issuePauseCard'],
    absent: ['setCampaignStatus(', 'setCampaignDailyBudget('],
  },
  {
    name: 'finished-asset acceptance',
    file: 'src/lib/ads-strategy/admit-finished-asset.ts',
    present: ['ASSET_UPLOAD_REFUSED'],
    absent: ['deps.upload(', 'uploadVideoToMeta('],
  },
  {
    name: 'finished-asset runner',
    file: 'src/lib/ads-strategy/admit-finished-asset-run.ts',
    present: ['requestFinishedVideoUpload', 'ASSET_UPLOAD_REFUSED'],
    absent: ['uploadVideoToMeta('],
  },
  {
    name: 'video upload card',
    file: 'src/lib/ads-strategy/video-upload-card.ts',
    present: ['confirmVideoUploadCard', 'requestVideoUploadCard'],
    absent: ['uploadVideoToMeta(', 'createDraftForApproval(', 'setCampaignStatus(', 'setAdSetStatus(', '@/lib/supabase', '@/lib/capabilities'],
  },
  {
    name: 'video upload exec',
    file: 'src/lib/ads-strategy/video-upload-exec.ts',
    present: ['uploadVideoToMeta(', 'readVideoInAdAccount('],
    absent: ['createDraftForApproval(', 'setCampaignStatus(', 'setAdSetStatus(', '/campaigns', '/adsets'],
  },
  {
    name: 'video upload confirm route',
    file: 'src/app/api/clients/[id]/meta-ads/video-upload-card/[runId]/route.ts',
    present: ['confirmVideoUploadCard'],
    absent: ['uploadVideoToMeta('],
  },
]

describe('the eight direct Meta writes are carded or refused', () => {
  it.each(EIGHT)('$name stays behind a card or a refusal', ({ file, present, absent }) => {
    const source = readFileSync(file, 'utf8')
    for (const token of present) expect(source, token).toContain(token)
    for (const token of absent) expect(source, token).not.toContain(token)
  })

  it('several ad sets are refused and the ask does not build', async () => {
    const issue = vi.fn()
    const refused = await askDirectPausedDraft({ draft: { adSets: [{ name: 'a' }] }, issue })
    expect(refused.status).toBe(409)
    expect(refused.body.wroteMeta).toBe(false)
    expect(String(refused.body.error)).toContain('没有去建')
    expect(issue).not.toHaveBeenCalled()
  })

  it('approving an auto-pause suggestion only issues the pause card', () => {
    const source = readFileSync('src/app/api/clients/[id]/ad-health/auto-pause/[runId]/decision/route.ts', 'utf8')
    const decide = source.slice(source.indexOf('async function decide'), source.indexOf('export async function POST'))
    expect(decide).toContain('issueAutoPauseCard')
    expect(decide).not.toContain('approveAndExecuteAdsAutoPause')
  })

  it('a confirmed raise of a live plan does not write', async () => {
    const hold = {
      raising: true,
      source: 'scorecard_up',
      level: 'adset',
      entityId: 'set-1',
      beforeCents: 1000,
      afterCents: 1100,
    } as MoneyHold
    const result = await writeHeldBudget({} as never, CLIENT_A, hold)
    expect(result.wroteMeta).toBe(false)
    expect(result.queued).toBeUndefined()
    expect(result.reason).toContain('新开一份计划')
  })

  it('acceptance does not upload a finished video', async () => {
    const upload = vi.fn<AdmitDeps['upload']>(async () => ({ ok: true as const, videoId: '555' }))
    const order: AdmitWorkOrder = {
      id: 'wo-1',
      clientId: CLIENT_A,
      status: 'in_review',
      assetOnly: true,
      videoPath: 'renders/c/wo-1/final.mp4',
      reviewRef: {},
    }
    const result = await admitFinishedAsset(order, {
      uploadEnabled: true,
      publicBase: 'https://files.example.test/bucket',
      accounts: async () => ({ ok: true, accounts: [{ adAccountId: VIDEO_ACCOUNT, isPrimary: true }], registeredIds: [VIDEO_ACCOUNT] }),
      token: async () => 'tok',
      upload,
      remember: async () => ({ ok: true }),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('没有确认卡')
    expect(upload).not.toHaveBeenCalled()
  })
})

const VIDEO_FILE = 'https://files.example.test/bucket/renders/c/wo-1/final.mp4'
const VIDEO_ACCOUNT = 'act_1234567890'

function videoExec(readBackOk = true) {
  const upload = vi.fn(async () => ({ ok: true as const, videoId: '555' }))
  const readBack = vi.fn(async () => (readBackOk ? { ok: true as const, videoId: '555' } : { ok: false as const, error: 'missing' }))
  const remember = vi.fn(async () => ({ ok: true as const }))
  const token = vi.fn(async () => 'tok')
  return { upload, readBack, remember, token, deps: { currentFileUrl: async () => VIDEO_FILE, accountRegistered: async () => true, token, upload, readBack, remember } }
}

async function issued(workOrderId: string) {
  const f = kernel()
  const card = await requestVideoUploadCard({
    kernel: f.kernel, clientId: CLIENT_A, clicker: { kind: 'agent', email: null },
    workOrderId, accountId: VIDEO_ACCOUNT, fileUrl: VIDEO_FILE,
  })
  return { f, card }
}

function press(bundle: Awaited<ReturnType<typeof issued>>, deps: ReturnType<typeof videoExec>['deps'], over: { fingerprint?: string; now?: Date; runId?: string } = {}) {
  return confirmVideoUploadCard({
    kernel: bundle.f.kernel, clientId: CLIENT_A, runId: over.runId ?? bundle.card.runId, clicker: OPC,
    resolution: 'confirm', expectedDecisionId: bundle.card.expectedDecisionId,
    fingerprint: over.fingerprint ?? bundle.card.fingerprint, deps, now: over.now,
  })
}

describe('video upload writes only after a confirmed card', () => {
  it('points the card click at the upload confirm route', () => {
    expect(pausedDraftClickUrl(CLIENT_A, 'run-1', VIDEO_UPLOAD_WHAT)).toBe(`/api/clients/${CLIENT_A}/meta-ads/video-upload-card/run-1`)
  })

  it('asks for a card instead of uploading when acceptance has none', async () => {
    const upload = vi.fn<AdmitDeps['upload']>(async () => ({ ok: true as const, videoId: '555' }))
    const ask = vi.fn(async () => ({ ok: true as const }))
    const order: AdmitWorkOrder = { id: 'wo-1', clientId: CLIENT_A, status: 'in_review', assetOnly: true, videoPath: 'renders/c/wo-1/final.mp4', reviewRef: {} }
    const result = await uploadOrAsk({
      admit: () => admitFinishedAsset(order, {
        uploadEnabled: true, publicBase: 'https://files.example.test/bucket',
        accounts: async () => ({ ok: true, accounts: [{ adAccountId: VIDEO_ACCOUNT, isPrimary: true }], registeredIds: [VIDEO_ACCOUNT] }),
        token: async () => 'tok', upload, remember: async () => ({ ok: true }),
      }),
      ask,
    })
    expect(result).toMatchObject({ ok: true, awaitingCard: true, videoId: null })
    expect(ask).toHaveBeenCalledTimes(1)
    expect(upload).not.toHaveBeenCalled()
  })

  it('does not upload when the card is missing, mismatched, or expired', async () => {
    const bundle = await issued('wo-1')
    const expired = videoExec()
    const late = await press(bundle, expired.deps, { now: later() })
    expect(late.wrote).toBe(false)
    expect(late.reason).toMatch(/作废/)
    expect(expired.upload).not.toHaveBeenCalled()
    expect(expired.token).not.toHaveBeenCalled()
    const mismatch = videoExec()
    expect((await press(bundle, mismatch.deps, { fingerprint: 'b'.repeat(64) })).wrote).toBe(false)
    expect(mismatch.upload).not.toHaveBeenCalled()
    const missing = videoExec()
    const gone = await press(bundle, missing.deps, { runId: '11111111-1111-4111-8111-111111111111' })
    expect(gone.statusCode).toBe(404)
    expect(missing.upload).not.toHaveBeenCalled()
  })

  it('uploads once after confirm, and only remembers a matching read-back', async () => {
    const bundle = await issued('wo-1')
    const used = videoExec()
    const result = await press(bundle, used.deps, { now: new Date(START) })
    expect(result).toMatchObject({ wrote: true, videoId: '555' })
    expect(result.reason).toContain('回读')
    expect(used.upload).toHaveBeenCalledTimes(1)
    expect(used.upload).toHaveBeenCalledWith(VIDEO_ACCOUNT, VIDEO_FILE, 'tok')
    expect(used.readBack).toHaveBeenCalledWith(VIDEO_ACCOUNT, '555', 'tok')
    expect(used.remember).toHaveBeenCalledWith('wo-1', '555', VIDEO_ACCOUNT)
    const rows = bundle.f.tables.flywheel_actions as Array<{ action_type: string; payload: { status?: string } }>
    expect(rows.filter((row) => row.action_type === VIDEO_UPLOAD_HOLD && row.payload.status === 'executed')).toHaveLength(1)
    const again = videoExec()
    expect((await press(bundle, again.deps, { now: new Date(START) })).wrote).toBe(true)
    expect(again.upload).not.toHaveBeenCalled()
    const missed = await issued('wo-2')
    const unread = videoExec(false)
    const hidden = await press(missed, unread.deps, { now: new Date(START) })
    expect(hidden).toMatchObject({ wrote: true, videoId: null })
    expect(hidden.reason).toMatch(/回读/)
    expect(unread.remember).not.toHaveBeenCalled()
  })
})
