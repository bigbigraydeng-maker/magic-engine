import { describe, expect, it, vi } from 'vitest'

import { runAutoPublishSweep, type AutoPublishWorkerDeps, type PlanState, type RunPublishInput } from '../daily-plan-auto-publish-worker'
import type { AutoPublishAuthorization } from '../daily-plan-auto-publish'
import type { AttemptRecord } from '../daily-plan-auto-publish-worker-store'

// 2026-10-12 07:00 in Auckland (NZDT, UTC+13): today's 08:00 slot is an hour away, tomorrow's is a day away.
const NOW = new Date('2026-10-11T18:00:00Z')
const TODAY = '2026-10-12'
const TOMORROW = '2026-10-13'
const LATER = '2026-10-16'
const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const PLAN = 'b0000000-0000-0000-0000-000000000001'
const CAMPAIGN = 'a0000000-0000-0000-0000-000000000001'
const PLAN_REV = '2026-10-01T00:00:00.000Z'
const REVIEW_REV = '10000000-0000-0000-0000-000000000001'
const PM = 'f0000000-0000-0000-0000-000000000001'

function grant(overrides: Partial<AutoPublishAuthorization> = {}): AutoPublishAuthorization {
  return {
    id: 'auth-1',
    request_id: 'req-auth-1',
    client_id: CLIENT,
    campaign_id: CAMPAIGN,
    plan_id: PLAN,
    plan_revision: PLAN_REV,
    review_revision: REVIEW_REV,
    page_id: '227633594573276',
    dates: [TODAY, TOMORROW],
    lifted_dates: [],
    max_per_day: 1,
    authorized_by_email: 'pm@example.test',
    authorized_by_user_id: PM,
    authorized_at: '2026-10-10T00:00:00.000Z',
    activated_at: '2026-10-10T00:00:05.000Z',
    expires_at: '2026-10-24T00:00:00.000Z',
    revoked_at: null,
    revoked_by_email: null,
    revoked_reason: null,
    ...overrides,
  }
}

function attempt(overrides: Partial<AttemptRecord> & { date: string }): AttemptRecord {
  return {
    id: 'att-1',
    auth_id: 'auth-1',
    client_id: CLIENT,
    plan_id: PLAN,
    status: 'claimed',
    reason_code: null,
    attempt_no: 1,
    next_retry_at: null,
    updated_at: NOW.toISOString(),
    request_id: 'req-old',
    provider_impact: 'NONE',
    post_id: null,
    scheduled_publish_time: null,
    ...overrides,
  }
}

interface Setup {
  grants?: AutoPublishAuthorization[]
  plan?: Partial<PlanState> | null
  scope?: { clientStatus: string | null; campaignStatus: string | null }
  attempts?: AttemptRecord[]
  live?: boolean
  now?: Date
  runPublish?: (input: RunPublishInput) => Promise<{ status: number; body: Record<string, unknown> }>
  claim?: boolean
  finish?: boolean
  active?: AutoPublishAuthorization | null | 'same'
}

function publishedBody(date: string) {
  return {
    status: 200,
    body: {
      success: true,
      receipt: { published: [{ date, post_id: `post-${date}`, scheduled_publish_time: '2026-10-13T19:00:00.000Z' }], failed: [] },
    },
  }
}

function build(setup: Setup = {}) {
  const grants = setup.grants ?? [grant()]
  const runPublish = vi.fn(
    setup.runPublish ??
      (async (input: RunPublishInput) =>
        input.command.no_publish ? { status: 200, body: { success: true, mode: 'DRY_RUN' } } : publishedBody(input.command.dates?.[0] ?? '')),
  )
  const claimedNow = new Map<string, string>()
  const claimAttempt = vi.fn(async (input: Parameters<AutoPublishWorkerDeps['claimAttempt']>[0]) => {
    const ok = setup.claim ?? true
    if (ok) claimedNow.set(input.date, input.requestId)
    return ok
  })
  const finishAttempt = vi.fn(async (_input: Parameters<AutoPublishWorkerDeps['finishAttempt']>[0]) => setup.finish ?? true)
  const emit = vi.fn(async (_event: Parameters<AutoPublishWorkerDeps['emit']>[0]) => undefined)
  const deps: AutoPublishWorkerDeps = {
    now: setup.now ?? NOW,
    clock: () => setup.now ?? NOW,
    switches: { live: setup.live ?? true, clientIds: [CLIENT] },
    listLiveAuthorizations: async () => grants,
    isGlobalAdmin: () => true,
    getActiveAuthorization: async planId =>
      setup.active === undefined || setup.active === 'same' ? (grants.find(g => g.plan_id === planId) ?? null) : setup.active,
    loadPlanState: async () =>
      setup.plan === null
        ? null
        : { planRevision: PLAN_REV, reviewRevision: REVIEW_REV, publishedDates: [], receiptRecalledDates: [], ...setup.plan },
    loadScope: async () => setup.scope ?? { clientStatus: 'active', campaignStatus: 'active' },
    // earlier rows plus whatever this sweep has claimed so far (so the post-claim re-check sees its own claim)
    listAttempts: async (_plan, _client, dates) => [
      ...(setup.attempts ?? []),
      ...Array.from(claimedNow.entries())
        .filter(([date]) => dates.includes(date))
        .map(([date, requestId]) => attempt({ date, status: 'claimed', request_id: requestId })),
    ],
    claimAttempt,
    finishAttempt,
    runPublish,
    emit,
  }
  return { deps, runPublish, claimAttempt, finishAttempt, emit }
}

const resultsOf = (summary: Awaited<ReturnType<typeof runAutoPublishSweep>>) => summary.records.map(r => `${r.date}:${r.result}${r.reason ? `(${r.reason})` : ''}`)

describe('runAutoPublishSweep — practice mode never sends or writes', () => {
  it('🔴 live switch off: proves the gates, claims nothing, calls the runner only as a dry run', async () => {
    const { deps, runPublish, claimAttempt, finishAttempt } = build({ live: false })
    const summary = await runAutoPublishSweep(deps)

    expect(resultsOf(summary)).toEqual([`${TODAY}:would_publish`, `${TOMORROW}:would_publish`])
    expect(claimAttempt).not.toHaveBeenCalled()
    expect(finishAttempt).not.toHaveBeenCalled()
    expect(runPublish).toHaveBeenCalledTimes(1)
    expect(runPublish.mock.calls[0][0].command.no_publish).toBe(true)
  })

  it('🔴 a client that is not on the allow-list stays in practice mode even when the live switch is on', async () => {
    const { deps, claimAttempt } = build()
    deps.switches = { live: true, clientIds: ['someone-else'] }
    const summary = await runAutoPublishSweep(deps)
    expect(summary.records.every(r => r.mode === 'practice')).toBe(true)
    expect(claimAttempt).not.toHaveBeenCalled()
  })
})

describe('runAutoPublishSweep — live publishing', () => {
  it('claims, publishes each due date serially as the authorising PM, and records the result', async () => {
    const { deps, runPublish, claimAttempt, finishAttempt, emit } = build()
    const summary = await runAutoPublishSweep(deps)

    expect(resultsOf(summary)).toEqual([`${TODAY}:published`, `${TOMORROW}:published`])
    // 1 whole-plan dry run + one live call per date
    expect(runPublish).toHaveBeenCalledTimes(3)
    const live = runPublish.mock.calls.filter(c => c[0].command.no_publish === false).map(c => c[0])
    expect(live.map(i => i.command.dates)).toEqual([[TODAY], [TOMORROW]])
    for (const input of live) {
      expect(input.approvedByUserId).toBe(PM)
      expect(input.allowImmediate).toBe(false)
      expect(input.now).toBe(NOW)
      expect(input.command.date_offset_days).toBe(0)
    }
    expect(claimAttempt).toHaveBeenCalledTimes(2)
    expect(finishAttempt.mock.calls[0][0].patch).toMatchObject({ status: 'published', post_id: `post-${TODAY}`, provider_impact: 'FB_SCHEDULED' })
    expect(emit).toHaveBeenCalledTimes(2)
  })

  it('🔴 only today and tomorrow are touched; later dates of the grant wait', async () => {
    const { deps, runPublish } = build({ grants: [grant({ dates: [TOMORROW, LATER] })] })
    await runAutoPublishSweep(deps)
    const live = runPublish.mock.calls.filter(c => c[0].command.no_publish === false)
    expect(live.map(c => c[0].command.dates)).toEqual([[TOMORROW]])
  })

  it('a date already on the receipt is never sent again', async () => {
    const { deps, runPublish } = build({ plan: { publishedDates: [TODAY] } })
    const summary = await runAutoPublishSweep(deps)
    expect(resultsOf(summary)).toContain(`${TODAY}:skipped(ALREADY_PUBLISHED)`)
    expect(runPublish.mock.calls.filter(c => c[0].command.no_publish === false).map(c => c[0].command.dates)).toEqual([[TOMORROW]])
  })

  it('🔴 revoked during the sweep: stops before the next send', async () => {
    const { deps, runPublish } = build()
    let calls = 0
    // call 1: the per-date check; call 2: the re-check after the claim; call 3 (next date): revoked
    deps.getActiveAuthorization = async () => (++calls <= 2 ? grant() : null)
    const summary = await runAutoPublishSweep(deps)
    expect(runPublish.mock.calls.filter(c => c[0].command.no_publish === false)).toHaveLength(1)
    expect(resultsOf(summary)).toContain(`${TOMORROW}:skipped(REVOKED_DURING_SWEEP)`)
  })

  it('lost claim: nothing is sent for that date', async () => {
    const { deps, runPublish } = build({ claim: false })
    const summary = await runAutoPublishSweep(deps)
    expect(runPublish.mock.calls.filter(c => c[0].command.no_publish === false)).toHaveLength(0)
    expect(resultsOf(summary)).toContain(`${TODAY}:skipped(CLAIM_LOST)`)
  })

  it('a finish that no longer owns the claim is reported, not hidden', async () => {
    const { deps } = build({ finish: false })
    const summary = await runAutoPublishSweep(deps)
    // it counts as an error and carries the post id, so a Post that may be live cannot pass unnoticed
    expect(summary.records.some(r => r.result === 'error' && r.reason?.includes('FINISH_LOST_CLAIM_CHANGED') && r.reason.includes('post_id=post-'))).toBe(true)
  })
})

describe('runAutoPublishSweep — when it must do nothing', () => {
  it.each([
    ['revoked', { revoked_at: '2026-10-11T00:00:00.000Z' }, 'REVOKED'],
    ['never armed', { activated_at: null }, 'NOT_ACTIVATED'],
    ['expired', { expires_at: '2026-10-11T00:00:00.000Z' }, 'EXPIRED'],
    ['plan changed (other review revision)', { review_revision: '20000000-0000-0000-0000-000000000002' }, 'PLAN_CHANGED'],
  ])('🔴 %s authorisation -> nothing is read further or sent', async (_name, patch, reason) => {
    const { deps, runPublish, claimAttempt } = build({ grants: [grant(patch as Partial<AutoPublishAuthorization>)] })
    const summary = await runAutoPublishSweep(deps)
    expect(resultsOf(summary)).toEqual([`*:skipped(${reason})`])
    expect(runPublish).not.toHaveBeenCalled()
    expect(claimAttempt).not.toHaveBeenCalled()
  })

  it.each([
    ['archived client', { clientStatus: 'archived', campaignStatus: 'active' }],
    ['archived campaign', { clientStatus: 'active', campaignStatus: 'archived' }],
    ['unknown campaign', { clientStatus: 'active', campaignStatus: null }],
    ['client that is only a prospect', { clientStatus: 'prospect', campaignStatus: 'active' }],
    ['client status unreadable', { clientStatus: null, campaignStatus: 'active' }],
  ])('🔴 %s -> skipped', async (_name, scope) => {
    const { deps, runPublish } = build({ scope })
    const summary = await runAutoPublishSweep(deps)
    expect(resultsOf(summary)).toEqual(['*:skipped(CLIENT_OR_CAMPAIGN_INACTIVE)'])
    expect(runPublish).not.toHaveBeenCalled()
  })

  it('🔴 the authoriser is no longer a global administrator -> nothing is sent, even though the grant is otherwise valid', async () => {
    const { deps, runPublish, claimAttempt } = build()
    deps.isGlobalAdmin = () => false
    const summary = await runAutoPublishSweep(deps)
    expect(resultsOf(summary)).toEqual(['*:skipped(AUTHORIZER_NOT_ADMIN)'])
    expect(runPublish).not.toHaveBeenCalled()
    expect(claimAttempt).not.toHaveBeenCalled()
  })

  it('the plan row is gone -> skipped', async () => {
    const { deps, runPublish } = build({ plan: null })
    expect(resultsOf(await runAutoPublishSweep(deps))).toEqual(['*:skipped(PLAN_NOT_FOUND)'])
    expect(runPublish).not.toHaveBeenCalled()
  })

  it('one plan throwing does not stop the next plan', async () => {
    const second = grant({ id: 'auth-2', plan_id: 'b0000000-0000-0000-0000-000000000002' })
    const { deps } = build({ grants: [grant(), second] })
    const base = deps.loadPlanState
    deps.loadPlanState = async (planId, clientId) => {
      if (planId === PLAN) throw new Error('db down')
      return base(planId, clientId)
    }
    const summary = await runAutoPublishSweep(deps)
    expect(summary.records[0]).toMatchObject({ plan_id: PLAN, result: 'error' })
    expect(summary.records.some(r => r.plan_id === second.plan_id && r.result === 'published')).toBe(true)
  })
})

describe('runAutoPublishSweep — bookkeeping that must not drift', () => {
  it('🔴 a refusal that is the same as last sweep is not re-claimed, re-written or re-announced', async () => {
    const { deps, claimAttempt, finishAttempt, emit } = build({
      runPublish: async () => ({ status: 409, body: { success: false, error: 'PRICE_FACT_UNVERIFIED' } }),
      attempts: [
        attempt({ date: TODAY, status: 'blocked', reason_code: 'PRICE_FACT_UNVERIFIED' }),
        attempt({ date: TOMORROW, status: 'blocked', reason_code: 'PRICE_FACT_UNVERIFIED' }),
      ],
    })
    const summary = await runAutoPublishSweep(deps)
    expect(resultsOf(summary)).toEqual([`${TODAY}:blocked(PRICE_FACT_UNVERIFIED)`, `${TOMORROW}:blocked(PRICE_FACT_UNVERIFIED)`])
    expect(claimAttempt).not.toHaveBeenCalled()
    expect(finishAttempt).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })

  it('a refusal for a different reason IS recorded', async () => {
    const { deps, finishAttempt } = build({
      runPublish: async () => ({ status: 409, body: { success: false, error: 'PRICE_CLAIM_UNBACKED' } }),
      attempts: [attempt({ date: TODAY, status: 'blocked', reason_code: 'PRICE_FACT_UNVERIFIED' })],
    })
    await runAutoPublishSweep(deps)
    expect(finishAttempt.mock.calls.some(c => c[0].date === TODAY && c[0].patch.reason_code === 'PRICE_CLAIM_UNBACKED')).toBe(true)
  })

  it('🔴 the receipt says it is out but our row was left in `claimed`: the row is closed as published with the receipt post id', async () => {
    const { deps, finishAttempt, runPublish } = build({
      plan: { publishedDates: [TODAY], publishedPostIds: { [TODAY]: 'post-from-receipt' } },
      attempts: [attempt({ date: TODAY, status: 'claimed', request_id: 'req-left' })],
    })
    await runAutoPublishSweep(deps)
    const closed = finishAttempt.mock.calls.map(c => c[0]).find(c => c.date === TODAY)
    expect(closed).toMatchObject({ requestId: 'req-left', patch: { status: 'published', post_id: 'post-from-receipt', reason_code: 'RECONCILED_FROM_RECEIPT' } })
    expect(runPublish.mock.calls.filter(c => c[0].command.no_publish === false).map(c => c[0].command.dates?.[0])).not.toContain(TODAY)
  })
})

describe('runAutoPublishSweep — a manual publish that may have reached Facebook', () => {
  it('🔴 a date whose manual publish failed with an uncertain result is parked as UNKNOWN_OUTCOME, never sent', async () => {
    const { deps, runPublish, finishAttempt } = build({ plan: { receiptUnknownFailedDates: [TOMORROW] } })
    const summary = await runAutoPublishSweep(deps)
    expect(resultsOf(summary)).toContain(`${TOMORROW}:unknown_outcome(RECEIPT_FAILED_UNKNOWN)`)
    expect(finishAttempt.mock.calls.map(c => c[0]).find(c => c.date === TOMORROW)?.patch).toMatchObject({ status: 'unknown_outcome' })
    expect(runPublish.mock.calls.filter(c => c[0].command.no_publish === false).map(c => c[0].command.dates)).toEqual([[TODAY]])
  })

  it('🔴 a date further out (not due yet) is parked too, so the fact is durable before the receipt can be overwritten', async () => {
    const { deps, claimAttempt, finishAttempt } = build({
      grants: [grant({ dates: [TODAY, LATER] })],
      plan: { receiptUnknownFailedDates: [LATER] },
    })
    const summary = await runAutoPublishSweep(deps)
    expect(resultsOf(summary)).toContain(`${LATER}:unknown_outcome(RECEIPT_FAILED_UNKNOWN)`)
    expect(claimAttempt.mock.calls.map(c => c[0].date)).toContain(LATER)
    expect(finishAttempt.mock.calls.find(c => c[0].date === LATER)?.[0].patch).toMatchObject({ status: 'unknown_outcome' })
  })

  it('practice mode parks nothing', async () => {
    const { deps, claimAttempt } = build({ live: false, plan: { receiptUnknownFailedDates: [TOMORROW] } })
    await runAutoPublishSweep(deps)
    expect(claimAttempt).not.toHaveBeenCalled()
  })
})

describe('runAutoPublishSweep — last-moment checks', () => {
  it('🔴 the grant is revoked right after the claim: nothing is sent and the claim is closed as blocked', async () => {
    const { deps, runPublish, finishAttempt } = build({ grants: [grant({ dates: [TOMORROW] })] })
    let reads = 0
    deps.getActiveAuthorization = async () => (++reads === 1 ? grant({ dates: [TOMORROW] }) : null)
    const summary = await runAutoPublishSweep(deps)
    expect(runPublish.mock.calls.filter(c => c[0].command.no_publish === false)).toHaveLength(0)
    expect(finishAttempt.mock.calls[0][0].patch).toMatchObject({ status: 'blocked', reason_code: 'ABORTED_BEFORE_SEND' })
    expect(resultsOf(summary)).toContain(`${TOMORROW}:blocked(ABORTED_BEFORE_SEND)`)
  })

  it('🔴 only THIS date\'s claim is taken away (tombstoned): that date is blocked, the other date is still sent', async () => {
    const { deps, runPublish } = build()
    const mine = new Map<string, string>()
    const realClaim = deps.claimAttempt
    deps.claimAttempt = async input => {
      const ok = await realClaim(input)
      if (ok) mine.set(input.date, input.requestId)
      return ok
    }
    let todayReads = 0
    deps.listAttempts = async (_plan, _client, dates) =>
      dates.flatMap(date =>
        date === TODAY
          ? // the first read (eligibility) sees nothing; after our claim, someone tombstoned the date
            ++todayReads === 1 || dates.length > 1
            ? []
            : [attempt({ date, status: 'blocked', reason_code: 'RECALLED', request_id: 'tombstone' })]
          : mine.has(date)
            ? [attempt({ date, status: 'claimed', request_id: mine.get(date) })]
            : [],
      )
    const summary = await runAutoPublishSweep(deps)
    expect(runPublish.mock.calls.filter(c => c[0].command.no_publish === false).map(c => c[0].command.dates?.[0])).toEqual([TOMORROW])
    expect(resultsOf(summary)).toContain(`${TODAY}:blocked(ABORTED_BEFORE_SEND)`)
    expect(resultsOf(summary)).toContain(`${TOMORROW}:published`)
  })

  it('🔴 the runner is handed a request timeout and a before-send check that is still true while the claim is ours', async () => {
    let beforeSendResult: boolean | null = null
    const { deps, runPublish } = build({
      grants: [grant({ dates: [TOMORROW] })],
      runPublish: async input => {
        if (input.command.no_publish) return { status: 200, body: { success: true } }
        beforeSendResult = (await input.beforeSend?.(TOMORROW)) ?? null
        return publishedBody(TOMORROW)
      },
    })
    await runAutoPublishSweep(deps)
    const live = runPublish.mock.calls.map(c => c[0]).find(i => i.command.no_publish === false)
    expect(live?.requestTimeoutMs).toBe(45_000)
    expect(beforeSendResult).toBe(true)
  })

  it('🔴 the before-send check turns false once the claim is gone (tombstoned) — so the runner would not send', async () => {
    let beforeSendResult: boolean | null = null
    const { deps } = build({
      grants: [grant({ dates: [TOMORROW] })],
      runPublish: async input => {
        if (input.command.no_publish) return { status: 200, body: { success: true } }
        // someone tombstones the date between the claim and the send
        deps.listAttempts = async () => [attempt({ date: TOMORROW, status: 'blocked', reason_code: 'RECALLED', request_id: 'someone-else' })]
        beforeSendResult = (await input.beforeSend?.(TOMORROW)) ?? null
        return { status: 200, body: { receipt: { published: [], failed: [{ date: TOMORROW, error: 'ABORTED_BEFORE_SEND', certainty: 'rejected' }] } } }
      },
    })
    const summary = await runAutoPublishSweep(deps)
    expect(beforeSendResult).toBe(false)
    expect(resultsOf(summary)).toContain(`${TOMORROW}:blocked(ABORTED_BEFORE_SEND)`)
  })
})

describe('runAutoPublishSweep — recalled dates', () => {
  it('🔴 a tombstone blocks the date', async () => {
    const { deps, runPublish } = build({ attempts: [attempt({ date: TODAY, status: 'blocked', reason_code: 'RECALLED' })] })
    const summary = await runAutoPublishSweep(deps)
    expect(resultsOf(summary)).toContain(`${TODAY}:skipped(RECALLED)`)
    expect(runPublish.mock.calls.filter(c => c[0].command.no_publish === false).map(c => c[0].command.dates)).toEqual([[TOMORROW]])
  })

  it('🔴 the receipt\'s recalled list blocks the date even with no tombstone', async () => {
    const { deps } = build({ plan: { receiptRecalledDates: [TODAY] } })
    expect(resultsOf(await runAutoPublishSweep(deps))).toContain(`${TODAY}:skipped(RECALLED)`)
  })

  it('a recalled date the PM explicitly lifted on this grant is sent again', async () => {
    const { deps, runPublish } = build({
      grants: [grant({ lifted_dates: [TODAY] })],
      plan: { receiptRecalledDates: [TODAY], receiptRecalledAt: { [TODAY]: '2026-10-01T00:00:00.000Z' } },
    })
    await runAutoPublishSweep(deps)
    expect(runPublish.mock.calls.filter(c => c[0].command.no_publish === false).map(c => c[0].command.dates)).toContainEqual([TODAY])
  })

  it('a lift counts when the recall happened before the grant was written', async () => {
    const { deps, runPublish } = build({
      grants: [grant({ lifted_dates: [TODAY], authorized_at: '2026-10-10T00:00:00.000Z' })],
      plan: { receiptRecalledDates: [TODAY], receiptRecalledAt: { [TODAY]: '2026-10-09T00:00:00.000Z' } },
    })
    await runAutoPublishSweep(deps)
    expect(runPublish.mock.calls.filter(c => c[0].command.no_publish === false).map(c => c[0].command.dates)).toContainEqual([TODAY])
  })

  it('🔴 a recall AFTER the grant (or with no readable time) voids the lift — even with no tombstone', async () => {
    const after = build({
      grants: [grant({ lifted_dates: [TODAY], authorized_at: '2026-10-10T00:00:00.000Z' })],
      plan: { receiptRecalledDates: [TODAY], receiptRecalledAt: { [TODAY]: '2026-10-11T00:00:00.000Z' } },
    })
    expect(resultsOf(await runAutoPublishSweep(after.deps))).toContain(`${TODAY}:skipped(RECALLED)`)

    const unreadable = build({ grants: [grant({ lifted_dates: [TODAY] })], plan: { receiptRecalledDates: [TODAY] } })
    expect(resultsOf(await runAutoPublishSweep(unreadable.deps))).toContain(`${TODAY}:skipped(RECALLED)`)
  })

  it('🔴 a grant that expired mid-sweep stops the next send', async () => {
    const { deps, runPublish } = build({ grants: [grant({ expires_at: '2026-10-11T18:00:00.001Z' })] })
    deps.getActiveAuthorization = async () => grant({ expires_at: '2026-10-11T18:00:00.001Z' })
    // by the time the per-date re-check runs, the clock is past the expiry
    deps.clock = () => new Date('2026-10-11T18:00:01Z')
    await runAutoPublishSweep(deps)
    expect(runPublish.mock.calls.filter(c => c[0].command.no_publish === false)).toHaveLength(0)
  })

  it('🔴 a tombstone beats a lift (re-recalled after the lift)', async () => {
    const { deps } = build({
      grants: [grant({ lifted_dates: [TODAY] })],
      plan: { receiptRecalledDates: [TODAY] },
      attempts: [attempt({ date: TODAY, status: 'blocked', reason_code: 'RECALLED' })],
    })
    expect(resultsOf(await runAutoPublishSweep(deps))).toContain(`${TODAY}:skipped(RECALLED)`)
  })
})

describe('runAutoPublishSweep — the publish window', () => {
  const AFTER_SLOT = new Date('2026-10-11T21:00:00Z') // 10:00 NZ on 10-12: today's 08:00 slot has passed

  it('🔴 a passed slot is MISSED_WINDOW: claimed and closed, never sent, never published late', async () => {
    const { deps, runPublish, finishAttempt } = build({ now: AFTER_SLOT })
    const summary = await runAutoPublishSweep(deps)
    expect(resultsOf(summary)).toContain(`${TODAY}:missed_window(MISSED_WINDOW)`)
    expect(finishAttempt.mock.calls[0][0].patch).toMatchObject({ status: 'missed_window' })
    expect(runPublish.mock.calls.filter(c => c[0].command.no_publish === false).map(c => c[0].command.dates)).toEqual([[TOMORROW]])
  })

  it('practice mode reports the missed window but writes nothing', async () => {
    const { deps, claimAttempt } = build({ now: AFTER_SLOT, live: false })
    const summary = await runAutoPublishSweep(deps)
    expect(resultsOf(summary)).toContain(`${TODAY}:missed_window(MISSED_WINDOW)`)
    expect(claimAttempt).not.toHaveBeenCalled()
  })
})

describe('runAutoPublishSweep — gates pause the whole plan', () => {
  it('🔴 one refusal blocks every due date with the refusal code and sends nothing', async () => {
    const { deps, runPublish, finishAttempt } = build({
      runPublish: async () => ({ status: 409, body: { success: false, error: 'PRICE_FACT_UNVERIFIED' } }),
    })
    const summary = await runAutoPublishSweep(deps)
    expect(resultsOf(summary)).toEqual([`${TODAY}:blocked(PRICE_FACT_UNVERIFIED)`, `${TOMORROW}:blocked(PRICE_FACT_UNVERIFIED)`])
    expect(runPublish).toHaveBeenCalledTimes(1)
    expect(finishAttempt.mock.calls.map(c => c[0].patch.status)).toEqual(['blocked', 'blocked'])
  })

  it('practice mode: a refusal is reported and nothing is written', async () => {
    const { deps, claimAttempt } = build({ live: false, runPublish: async () => ({ status: 409, body: { error: 'PRICE_CLAIM_UNBACKED' } }) })
    const summary = await runAutoPublishSweep(deps)
    expect(resultsOf(summary)).toEqual([`${TODAY}:blocked(PRICE_CLAIM_UNBACKED)`, `${TOMORROW}:blocked(PRICE_CLAIM_UNBACKED)`])
    expect(claimAttempt).not.toHaveBeenCalled()
  })
})

describe('runAutoPublishSweep — outcomes of a live send', () => {
  const failing = (certainty: string | undefined) => async (input: RunPublishInput) =>
    input.command.no_publish
      ? { status: 200, body: { success: true } }
      : { status: 200, body: { receipt: { published: [], failed: [{ date: input.command.dates?.[0], error: 'x', ...(certainty ? { certainty } : {}) }] } } }

  it('a definite refusal is retried later with backoff (attempt 1 -> 10 minutes)', async () => {
    const { deps, finishAttempt } = build({ grants: [grant({ dates: [TOMORROW] })], runPublish: failing('rejected') })
    await runAutoPublishSweep(deps)
    const patch = finishAttempt.mock.calls[0][0].patch
    expect(patch.status).toBe('failed_retryable')
    expect(patch.next_retry_at).toBe(new Date(NOW.getTime() + 10 * 60_000).toISOString())
  })

  it('🔴 an uncertain failure is UNKNOWN_OUTCOME and is not retried', async () => {
    const { deps, finishAttempt } = build({ grants: [grant({ dates: [TOMORROW] })], runPublish: failing('unknown') })
    await runAutoPublishSweep(deps)
    expect(finishAttempt.mock.calls[0][0].patch).toMatchObject({ status: 'unknown_outcome' })
  })

  it('🔴 a failure with no certainty on record counts as unknown', async () => {
    const { deps, finishAttempt } = build({ grants: [grant({ dates: [TOMORROW] })], runPublish: failing(undefined) })
    await runAutoPublishSweep(deps)
    expect(finishAttempt.mock.calls[0][0].patch).toMatchObject({ status: 'unknown_outcome' })
  })

  it('🔴 the runner throwing after the claim is UNKNOWN_OUTCOME (the Post may exist)', async () => {
    const { deps, finishAttempt } = build({
      grants: [grant({ dates: [TOMORROW] })],
      runPublish: async input => {
        if (input.command.no_publish) return { status: 200, body: { success: true } }
        throw new Error('socket hang up')
      },
    })
    const summary = await runAutoPublishSweep(deps)
    expect(finishAttempt.mock.calls[0][0].patch).toMatchObject({ status: 'unknown_outcome', reason_code: 'RUNNER_THREW' })
    expect(resultsOf(summary)).toContain(`${TOMORROW}:unknown_outcome(RUNNER_THREW)`)
  })
})

describe('runAutoPublishSweep — what earlier attempts mean', () => {
  const sentDates = (runPublish: ReturnType<typeof build>['runPublish']) =>
    runPublish.mock.calls.filter(c => c[0].command.no_publish === false).map(c => c[0].command.dates?.[0])

  it.each([
    ['published', 'ALREADY_PUBLISHED'],
    ['unknown_outcome', 'UNKNOWN_OUTCOME'],
    ['failed_final', 'FAILED_FINAL'],
    ['missed_window', 'MISSED_WINDOW'],
  ] as const)('🔴 an earlier %s attempt is final: skipped, not sent', async (status, reason) => {
    const { deps, runPublish } = build({ attempts: [attempt({ date: TOMORROW, status })] })
    const summary = await runAutoPublishSweep(deps)
    expect(resultsOf(summary)).toContain(`${TOMORROW}:skipped(${reason})`)
    expect(sentDates(runPublish)).not.toContain(TOMORROW)
  })

  it('a retry that is not due yet waits; one that is due is re-claimed with the next attempt number', async () => {
    const notDue = build({ attempts: [attempt({ date: TOMORROW, status: 'failed_retryable', next_retry_at: '2026-10-11T19:00:00.000Z' })] })
    expect(resultsOf(await runAutoPublishSweep(notDue.deps))).toContain(`${TOMORROW}:skipped(WAITING_RETRY)`)

    const due = build({ attempts: [attempt({ date: TOMORROW, status: 'failed_retryable', attempt_no: 1, next_retry_at: '2026-10-11T17:00:00.000Z' })] })
    await runAutoPublishSweep(due.deps)
    const reclaim = due.claimAttempt.mock.calls.map(c => c[0]).find(c => c.date === TOMORROW)
    expect(reclaim).toMatchObject({ fromStatus: 'failed_retryable', attemptNo: 2 })
  })

  it('a block from an earlier sweep is re-evaluated (reclaimed) every sweep', async () => {
    const { deps, claimAttempt } = build({ attempts: [attempt({ date: TOMORROW, status: 'blocked', reason_code: 'PRICE_FACT_UNVERIFIED' })] })
    await runAutoPublishSweep(deps)
    expect(claimAttempt.mock.calls.map(c => c[0]).find(c => c.date === TOMORROW)).toMatchObject({ fromStatus: 'blocked' })
  })

  it('🔴 a fresh claim by someone else is left alone; a stale one becomes UNKNOWN_OUTCOME and is not sent', async () => {
    const fresh = build({ attempts: [attempt({ date: TOMORROW, status: 'claimed', updated_at: '2026-10-11T17:55:00.000Z' })] })
    expect(resultsOf(await runAutoPublishSweep(fresh.deps))).toContain(`${TOMORROW}:skipped(CLAIMED_IN_PROGRESS)`)

    const stale = build({ attempts: [attempt({ date: TOMORROW, status: 'claimed', updated_at: '2026-10-11T16:00:00.000Z', request_id: 'req-stale' })] })
    await runAutoPublishSweep(stale.deps)
    expect(stale.finishAttempt.mock.calls.map(c => c[0]).find(c => c.date === TOMORROW)).toMatchObject({
      requestId: 'req-stale',
      patch: { status: 'unknown_outcome', reason_code: 'STALE_CLAIM' },
    })
    expect(sentDates(stale.runPublish)).not.toContain(TOMORROW)
  })
})
