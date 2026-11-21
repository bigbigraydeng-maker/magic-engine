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

export interface PauseIssueArgs {
  readonly campaignId: string
  readonly accountId: string
  readonly name: string
  readonly adsetId: string | null
  readonly unit: 'campaign' | 'adset'
}

export interface ApplyDeps {
  issuePause(args: PauseIssueArgs): Promise<{ ok: true; runId: string } | { ok: false; reason: string }>
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
  /** New Zealand day for ad-set cards. Campaign cards keep `day`. */
  nzDay?: string
  pauses: readonly PauseProposal[]
  alerts: readonly AlertFinding[]
  deps: ApplyDeps
}): Promise<ApplyCounts> {
  const counts = { cards: 0, alerts: 0, skipped: 0, recorded: true }
  for (const pause of args.pauses) await addPause(counts, subjectDay(args.day, args.nzDay, pause), pause, args.deps)
  for (const alert of args.alerts) await addAlert(counts, args.day, alert, args.deps)
  return counts
}

function subjectDay(day: string, nzDay: string | undefined, pause: PauseProposal): string {
  return pause.unit === 'adset' && nzDay ? nzDay : day
}

async function addPause(counts: ApplyCounts, day: string, pause: PauseProposal, deps: ApplyDeps): Promise<void> {
  const subjectKey = pause.unit === 'adset' && pause.adsetId
    ? `pause-adset:${pause.adsetId}:${day}`
    : `pause:${pause.campaignId}:${day}`
  if (await deps.alreadyOpen(subjectKey)) {
    counts.skipped += 1
    return
  }
  const issued = await deps.issuePause({
    campaignId: pause.campaignId,
    accountId: pause.accountId,
    name: pause.unit === 'adset' ? pause.adsetName || pause.campaignName : pause.campaignName,
    adsetId: pause.unit === 'adset' ? pause.adsetId : null,
    unit: pause.unit,
  })
  if (!issued.ok && issued.reason === 'pending') {
    counts.skipped += 1
    return
  }
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
