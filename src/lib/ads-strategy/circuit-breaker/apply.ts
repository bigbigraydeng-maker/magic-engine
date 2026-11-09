/**
 * Turn a judgement into an existing campaign pause card plus a ledger row.
 * This file does not write Meta and does not insert a kernel trip.
 */

import type { AlertFinding, PauseProposal } from './rules'

export const BREAKER_ACTION = 'ads.circuit_breaker_event'

export interface BreakerEvent {
  readonly subjectKey: string
  readonly status: 'card_issued' | 'alert_only' | 'card_failed'
  readonly summary: string
  readonly cardRunId: string | null
  readonly wrote: false
  readonly rules: readonly string[]
  readonly day: string
  readonly campaignName: string
}

export interface ApplyDeps {
  issuePause(args: { campaignId: string; accountId: string; name: string }): Promise<
    { ok: true; runId: string } | { ok: false; reason: string }
  >
  alreadyOpen(subjectKey: string): Promise<boolean>
  record(event: BreakerEvent): Promise<boolean>
}

export interface ApplyCounts {
  cards: number
  alerts: number
  skipped: number
  recorded: boolean
}

export async function applyBreaker(args: {
  day: string
  pauses: readonly PauseProposal[]
  alerts: readonly AlertFinding[]
  deps: ApplyDeps
}): Promise<ApplyCounts> {
  const counts = { cards: 0, alerts: 0, skipped: 0, recorded: true }
  for (const pause of args.pauses) await addPause(counts, args.day, pause, args.deps)
  for (const alert of args.alerts) await addAlert(counts, args.day, alert, args.deps)
  return counts
}

async function addPause(counts: ApplyCounts, day: string, pause: PauseProposal, deps: ApplyDeps): Promise<void> {
  const subjectKey = `pause:${pause.campaignId}:${day}`
  if (await deps.alreadyOpen(subjectKey)) {
    counts.skipped += 1
    return
  }
  const issued = await deps.issuePause({
    campaignId: pause.campaignId, accountId: pause.accountId, name: pause.campaignName,
  })
  const saved = await deps.record(eventOf(subjectKey, day, pause.summary, pause.rules, pause.campaignName, issued))
  if (!saved) counts.recorded = false
  if (issued.ok) counts.cards += 1
}

async function addAlert(counts: ApplyCounts, day: string, alert: AlertFinding, deps: ApplyDeps): Promise<void> {
  const subjectKey = `alert:${alert.code}:${alert.accountId || 'client'}:${day}`
  if (await deps.alreadyOpen(subjectKey)) {
    counts.skipped += 1
    return
  }
  const saved = await deps.record({
    subjectKey, status: 'alert_only', summary: alert.summary, cardRunId: null,
    wrote: false, rules: [alert.code], day, campaignName: '',
  })
  if (!saved) counts.recorded = false
  else counts.alerts += 1
}

function eventOf(
  subjectKey: string,
  day: string,
  summary: string,
  rules: readonly string[],
  campaignName: string,
  issued: { ok: true; runId: string } | { ok: false; reason: string },
): BreakerEvent {
  return {
    subjectKey,
    status: issued.ok ? 'card_issued' : 'card_failed',
    summary,
    cardRunId: issued.ok ? issued.runId : null,
    wrote: false,
    rules,
    day,
    campaignName,
  }
}
