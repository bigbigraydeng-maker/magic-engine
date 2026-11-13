import { describe, expect, it, vi } from 'vitest'

import { buildWeeklySocialPlan } from './build'
import type { BuildInput } from './types'
import { targetWeek } from '@/lib/social/week-pack/cadence'

import {
  ensureWeekPlanApprovalAfterDraft,
  shouldOpenWeekPlanApprovalAfterDraft,
  type WeekPlanApprovalAfterDraftDeps,
} from './after-draft'
import { weekPlanSubject } from './approval'

const NOW = new Date('2026-11-05T00:00:00.000Z')
const CLIENT = '11111111-1111-4111-8111-111111111111'
const WEEK = targetWeek(NOW)

function planInput(partial: Partial<BuildInput> = {}): BuildInput {
  return {
    weekStart: WEEK.weekStart,
    weekEnd: WEEK.weekEnd,
    industryKey: 'travel',
    clientConfig: null,
    weeklyQuota: { storyPerWeek: null, postPerWeek: null, reelPerWeek: null },
    pillarNames: {},
    lockMix: false,
    stage: {
      auth: { state: 'ok', value: true },
      authLost: { state: 'ok', value: false },
      facts: { state: 'ok', value: 1 },
      assets: { state: 'ok', value: 1 },
      onTimeWeeks: { state: 'unreadable', value: 0 },
      receipts: { state: 'unreadable', value: 0 },
      periods: { state: 'unreadable', value: 0 },
      circuitBreaker: { state: 'unreadable', value: false },
      complaintSpike: { state: 'unreadable', value: false },
    },
    goal: { read: 'none', title: null },
    themes: { read: 'none', items: [] },
    ...partial,
  }
}

function deps(over: Partial<WeekPlanApprovalAfterDraftDeps> = {}): WeekPlanApprovalAfterDraftDeps {
  const plan = buildWeeklySocialPlan(planInput())
  return {
    buildAndSave: vi.fn(async () => ({
      id: 'plan-1',
      plan,
      digest: 'dig-1',
      approval: null,
      saved: 'inserted' as const,
    })),
    readLatest: vi.fn(async () => null),
    listPending: vi.fn(async () => []),
    issueCard: vi.fn(async () => 'card-run-1'),
    ...over,
  }
}

describe('shouldOpenWeekPlanApprovalAfterDraft', () => {
  it('opens only on a clean write run', () => {
    expect(
      shouldOpenWeekPlanApprovalAfterDraft({ mode: 'write', status: 'completed', failureCount: 0 }),
    ).toBe(true)
    expect(
      shouldOpenWeekPlanApprovalAfterDraft({ mode: 'dry_run', status: 'completed', failureCount: 0 }),
    ).toBe(false)
    expect(
      shouldOpenWeekPlanApprovalAfterDraft({ mode: 'write', status: 'failed', failureCount: 0 }),
    ).toBe(false)
    expect(
      shouldOpenWeekPlanApprovalAfterDraft({ mode: 'write', status: 'completed', failureCount: 1 }),
    ).toBe(false)
  })
})

describe('ensureWeekPlanApprovalAfterDraft', () => {
  const db = {} as never

  it('saves the plan and issues a card when none is pending', async () => {
    const d = deps()
    const receipt = await ensureWeekPlanApprovalAfterDraft(db, CLIENT, NOW, d)
    expect(receipt).toMatchObject({ status: 'ok', planId: 'plan-1', cardRunId: 'card-run-1', reusedCard: false })
    expect(d.issueCard).toHaveBeenCalledTimes(1)
  })

  it('reuses an existing pending card when the plan digest is unchanged', async () => {
    const subject = weekPlanSubject(CLIENT, WEEK.weekStart)
    const d = deps({
      listPending: vi.fn(async () => [
        {
          id: 'card-old',
          client_id: CLIENT,
          status: 'pending_approval',
          input: {
            subject_key: subject,
            content_fingerprint: 'a'.repeat(64),
            what: 'x',
            account_label: 'Facebook',
            amount_label: 'x',
            date_label: 'x',
            scope_label: 'x',
            hard_checks: '[]',
            issued_at: new Date().toISOString(),
            lifetime: 'nz_day',
          },
        },
      ]),
      buildAndSave: vi.fn(async () => {
        const plan = buildWeeklySocialPlan(planInput())
        return { id: 'plan-1', plan, digest: 'dig-1', approval: null, saved: 'same' as const }
      }),
    })
    const receipt = await ensureWeekPlanApprovalAfterDraft(db, CLIENT, NOW, d)
    expect(receipt).toMatchObject({ status: 'ok', cardRunId: 'card-old', reusedCard: true })
    expect(d.issueCard).not.toHaveBeenCalled()
  })

  it('skips when this week is already approved', async () => {
    const plan = buildWeeklySocialPlan(planInput())
    const d = deps({
      readLatest: vi.fn(async () => ({
        id: 'plan-old',
        plan,
        digest: 'dig-old',
        approval: { status: 'confirmed', at: '2026-11-01T00:00:00.000Z' },
      })),
    })
    const receipt = await ensureWeekPlanApprovalAfterDraft(db, CLIENT, NOW, d)
    expect(receipt).toEqual({ status: 'skipped', reason: 'already_approved' })
    expect(d.buildAndSave).not.toHaveBeenCalled()
  })

  it('returns error when issuing the card fails without throwing', async () => {
    const d = deps({ issueCard: vi.fn(async () => { throw new Error('issue_boom') }) })
    const receipt = await ensureWeekPlanApprovalAfterDraft(db, CLIENT, NOW, d)
    expect(receipt.status).toBe('error')
    expect(receipt.reason).toContain('issue_boom')
  })
})
