/**
 * After a successful weekly draft in write mode: store this week's slot plan and
 * open the existing week-plan confirmation card. Does not publish or auto-approve.
 * Errors are returned to the caller; they must not fail the draft job.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import type { CardClicker } from '@/lib/confirmation-card/actor'
import { issueConfirmationCard } from '@/lib/confirmation-card/issue'
import { listPendingCards } from '@/lib/confirmation-card/records'
import { isExpired, readStoredCard } from '@/lib/confirmation-card/view'
import { createKernel } from '@/lib/kernel'
import { targetWeek } from '@/lib/social/week-pack/cadence'

import { openWeekPlanApproval, weekPlanSubject } from './approval'
import { readLatestWeeklyPlan, type StoredWeeklyPlan } from './db'
import type { ProducedDrafts } from './produced'
import { buildAndSaveWeeklyPlan } from './run'

export interface WeekPlanApprovalAfterDraftReceipt {
  status: 'skipped' | 'ok' | 'error'
  reason?: string
  planId?: string
  cardRunId?: string
  reusedCard?: boolean
}

export interface WeekPlanApprovalAfterDraftDeps {
  buildAndSave: typeof buildAndSaveWeeklyPlan
  readLatest: typeof readLatestWeeklyPlan
  listPending: typeof listPendingCards
  issueCard: (
    db: SupabaseClient,
    clientId: string,
    stored: StoredWeeklyPlan,
    now: Date,
    clicker: CardClicker,
  ) => Promise<string>
}

const AGENT_CLICKER: CardClicker = { kind: 'agent', email: null }

function pendingWeekPlanRun(
  runs: Awaited<ReturnType<typeof listPendingCards>>,
  subjectKey: string,
  now: Date,
): { runId: string } | null {
  for (const run of runs) {
    const stored = readStoredCard(run.input)
    if (!stored || stored.subjectKey !== subjectKey) continue
    if (isExpired(stored.issuedAt, now, stored.lifetime)) continue
    return { runId: run.id }
  }
  return null
}

async function defaultIssueCard(
  db: SupabaseClient,
  clientId: string,
  stored: StoredWeeklyPlan,
  now: Date,
  clicker: CardClicker,
): Promise<string> {
  const kernel = createKernel(db)
  const card = await openWeekPlanApproval(
    {
      issue: (facts, lifetime) =>
        issueConfirmationCard(kernel, { clientId, clicker, facts, now, lifetime }),
    },
    stored.plan,
    clientId,
    stored.digest,
  )
  return card.runId
}

export function defaultWeekPlanAfterDraftDeps(): WeekPlanApprovalAfterDraftDeps {
  return {
    buildAndSave: buildAndSaveWeeklyPlan,
    readLatest: readLatestWeeklyPlan,
    listPending: listPendingCards,
    issueCard: defaultIssueCard,
  }
}

/** True when the draft loop finished cleanly in write mode and a week-plan card may be opened. */
export function shouldOpenWeekPlanApprovalAfterDraft(input: {
  mode: 'write' | 'dry_run'
  status: 'completed' | 'stopped' | 'failed'
  failureCount: number
}): boolean {
  return input.mode === 'write' && input.status === 'completed' && input.failureCount === 0
}

export async function ensureWeekPlanApprovalAfterDraft(
  db: SupabaseClient,
  clientId: string,
  now: Date,
  deps: WeekPlanApprovalAfterDraftDeps = defaultWeekPlanAfterDraftDeps(),
  produced: ProducedDrafts | null = null,
): Promise<WeekPlanApprovalAfterDraftReceipt> {
  const week = targetWeek(now)
  const subjectKey = weekPlanSubject(clientId, week.weekStart)
  let pendingBefore: { runId: string } | null = null
  try {
    pendingBefore = pendingWeekPlanRun(await deps.listPending(db, clientId), subjectKey, now)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[weekly-plan] after-draft: pending cards unreadable:', message)
    return { status: 'error', reason: message }
  }

  const latestBefore = await deps.readLatest(db, clientId, week.weekStart)
  if (latestBefore === 'unreadable') return { status: 'error', reason: 'plan_unreadable' }
  if (latestBefore?.approval?.status === 'confirmed') {
    return { status: 'skipped', reason: 'already_approved' }
  }

  const saved = await deps.buildAndSave(db, clientId, now, produced)
  if (saved === 'error') return { status: 'error', reason: 'plan_save_failed' }

  const stored: StoredWeeklyPlan = {
    id: saved.id,
    plan: saved.plan,
    digest: saved.digest,
    approval: saved.approval,
  }

  if (pendingBefore !== null && saved.saved === 'same') {
    return {
      status: 'ok',
      planId: stored.id,
      cardRunId: pendingBefore.runId,
      reusedCard: true,
    }
  }

  try {
    const cardRunId = await deps.issueCard(db, clientId, stored, now, AGENT_CLICKER)
    const reusedCard = pendingBefore !== null && cardRunId === pendingBefore.runId
    return { status: 'ok', planId: stored.id, cardRunId, reusedCard }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[weekly-plan] after-draft: issue card failed:', message)
    return { status: 'error', reason: message }
  }
}
