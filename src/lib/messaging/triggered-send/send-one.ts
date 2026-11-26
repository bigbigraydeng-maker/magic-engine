/**
 * One guest, at most one welcome letter: the per-contact step of real sending (design P2 §5.2 A–M). Never throws.
 *
 *   re-check (switches, authorization, trial, window) → the guest and its live row → the shared body (`send-core.ts`):
 *   a letter in flight is taken over, any other guest goes through the gates, the render, the locks, the claim, the
 *   timeline record, the send and the outcome.
 *
 * The welcome letter's flow: its rows are the trigger's one-letter scope, the letter is rendered for the run's day
 * (`plan.sweepDay`), a full 7-day cap is final, and the body goes out exactly as rendered.
 */

import { checkArmed, isWithinSendWindow } from './send-arming'
import { result, sendToGuest, TERMINAL_STATUSES, type ArmedOk, type SendFlow } from './send-core'
import { renderWelcomeLetter } from './send-letter'
import type { SendContact, SendDeps, SendOneResult, SendPlan } from './send-types'

export { TERMINAL_STATUSES }

const TIMELINE_SUMMARY = 'ME 自动发出：欢迎信'

function welcomeFlow(plan: SendPlan, deps: SendDeps, armed: ArmedOk, contact: SendContact): SendFlow {
  return {
    clientId: plan.clientId,
    ledger: deps.ledger,
    triggerKey: armed.record.triggerKey,
    timelineSummary: TIMELINE_SUMMARY,
    frequencyFullFinal: true,
    render: () => renderWelcomeLetter(armed.template, contact.displayName, plan.sweepDay),
    extraAnnotations: {},
    finalText: async (_c, _row, letter) => ({ ok: true, text: letter.text }),
  }
}

export async function sendOne(args: { plan: SendPlan; contactId: string; deps: SendDeps }): Promise<SendOneResult> {
  const { plan, contactId, deps } = args
  try {
    const now = deps.now()
    const armed = await checkArmed(deps, plan.clientId, now, plan.authorizationId)
    if (!armed.ok) return result('stopped', armed.status, null, { stopRun: true })
    if (!isWithinSendWindow(armed.rule, now)) return result('stopped', 'outside_send_window', null, { stopRun: true })
    const loaded = await deps.loadContact({ clientId: plan.clientId, contactId, sources: armed.rule.audience.sources })
    if (!loaded.ok) return result('read_failed', 'contact_unreadable')
    if (loaded.contact === null) return result('contact_missing', null)
    const rows = await deps.ledger.rowsFor(plan.clientId, [contactId])
    if (!rows.ok) return result('read_failed', 'ledger_unreadable')
    const row = rows.rows.find((r) => r.contactId === contactId) ?? null
    if (row !== null && TERMINAL_STATUSES.has(row.status)) return result('already_done', row.status, row.id)
    const flow = welcomeFlow(plan, deps, armed, loaded.contact)
    return await sendToGuest({ flow, deps, armed, contact: loaded.contact, row: row?.status === 'blocked' ? row : null, now }, row)
  } catch (err) {
    console.error('[triggered-send] send step failed', err instanceof Error ? err.name : 'unknown')
    return result('read_failed', 'unexpected')
  }
}
