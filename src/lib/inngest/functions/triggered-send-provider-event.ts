/**
 * Magic Engine 2.0 · Inngest consumer of provider receipts for ME's automated e-mails.
 *
 * `cloud-triggered-send-provider-event` runs once per `crm.provider_event.received` (one per stored Resend receipt):
 *   1. `load-event`: read the stored receipt into provider-neutral facts and the letter's own exact identity (its
 *      `triggered_send_id` tag, the send named by a correctly signed unsubscribe link in its headers). Only ids,
 *      times, codes and recipient FINGERPRINTS leave this step: never an address, never a token (step results are
 *      stored by Inngest).
 *   2. `apply-<n>`: find the ledger row the receipt names exactly and move it forward (receipt-consumer.ts). When a row
 *      of the recipient's address is still `pending` without a message id, the receipt is retried up to
 *      IN_FLIGHT_ATTEMPTS times IN_FLIGHT_WAIT apart (its sender is probably about to record the id); after that it is
 *      reported as unmatched, never bound by address.
 * Receipts of ME's own system mail (same Resend account) match no row and end at once: no retry, no alert.
 *
 * 🔴 Sends nothing, changes no contact's details. Its only writes: the ledger row's status / receipt columns, and for a
 *    complaint one e-mail-unsubscribe record. Each step is idempotent (the ledger only moves forward; the unsubscribe
 *    record has a unique key), so Inngest's retries and replays are safe.
 * 🔴 Not a cron job: no run log row per receipt (the ledger row is the receipt of what happened). Outcomes worth a look
 *    (applied, conflict, ambiguous, unmatched) are logged as one JSON line with ids only.
 */

import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { CRM_PROVIDER_EVENT_RECEIVED, parseProviderEventReceived } from '@/lib/messaging/provider-events/events'
import { readResendReceipt } from '@/lib/messaging/provider-events/resend-receipt'
import { loadStoredProviderEvent } from '@/lib/messaging/provider-events/store'
import {
  applyReceipt,
  identifyLetter,
  type LoadedReceipt,
  type ReceiptOutcome,
  type ReceiptStore,
} from '@/lib/messaging/triggered-send/receipt-consumer'
import { createReceiptStore } from '@/lib/messaging/triggered-send/receipt-store-prod'

export const TRIGGERED_SEND_PROVIDER_EVENT_ID = `${CLOUD_FN_PREFIX}triggered-send-provider-event`
export const IN_FLIGHT_ATTEMPTS = 4
export const IN_FLIGHT_WAIT = '2m'
const LOGGED_OUTCOMES: ReadonlySet<string> = new Set(['applied', 'conflict', 'ambiguous', 'unmatched'])

export interface ReceiptStepTools {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>
  sleep(id: string, duration: string): Promise<void>
}

export interface ReceiptRunDeps {
  load(key: { account: string; providerEventId: string }): Promise<LoadedReceipt | null>
  store: ReceiptStore
  now(): Date
  log(line: Record<string, string>): void
}

export type ReceiptRunResult =
  | { outcome: 'skipped'; reason: string }
  | { outcome: 'event_missing' }
  | ReceiptOutcome

function logOutcome(result: ReceiptOutcome, deps: ReceiptRunDeps): void {
  if (!LOGGED_OUTCOMES.has(result.outcome)) return
  const line: Record<string, string> = { evt: 'triggered_send_receipt', outcome: result.outcome }
  if ('sendId' in result) line.send_id = result.sendId
  if ('status' in result) line.status = result.status
  deps.log(line)
}

export async function runProviderEventReceipt(
  data: unknown,
  step: ReceiptStepTools,
  deps: ReceiptRunDeps,
): Promise<ReceiptRunResult> {
  const parsed = parseProviderEventReceived(data)
  if (!parsed.ok) return { outcome: 'skipped', reason: parsed.reason }
  const loaded = await step.run('load-event', () => deps.load({ account: parsed.account, providerEventId: parsed.providerEventId }))
  if (loaded === null) return { outcome: 'event_missing' }
  if (loaded.facts === null) return { outcome: 'not_a_receipt' }
  for (let attempt = 1; attempt <= IN_FLIGHT_ATTEMPTS; attempt++) {
    const lastTry = attempt === IN_FLIGHT_ATTEMPTS
    const result = await step.run(`apply-${attempt}`, () => applyReceipt(loaded, deps.store, { lastTry, now: deps.now() }))
    if (result.outcome !== 'in_flight' || lastTry) {
      logOutcome(result, deps)
      return result
    }
    await step.sleep(`wait-${attempt}`, IN_FLIGHT_WAIT)
  }
  // Not reached: the last try never answers "in flight".
  return { outcome: 'not_ours' }
}

function realDeps(): ReceiptRunDeps {
  const env = (name: string): string | undefined => process.env[name]
  return {
    load: async (key) => {
      const stored = await loadStoredProviderEvent(supabaseAdmin, { provider: 'resend', ...key })
      return stored === null ? null : identifyLetter(readResendReceipt(stored), env)
    },
    store: createReceiptStore(supabaseAdmin),
    now: () => new Date(),
    log: (line) => console.info(JSON.stringify(line)),
  }
}

export function createTriggeredSendProviderEvent(deps?: ReceiptRunDeps) {
  return inngest.createFunction(
    {
      id: TRIGGERED_SEND_PROVIDER_EVENT_ID,
      name: 'Triggered send: apply a provider receipt to the send ledger',
      retries: 4,
    },
    { event: CRM_PROVIDER_EVENT_RECEIVED },
    async ({ event, step }) =>
      runProviderEventReceipt(
        event.data,
        {
          // Every step result here is plain JSON, so Jsonify<T> has the same shape as T.
          run: <T>(id: string, fn: () => Promise<T>) => step.run(id, fn) as Promise<T>,
          sleep: async (id, duration) => {
            await step.sleep(id, duration)
          },
        },
        deps ?? realDeps(),
      ),
  )
}

export const triggeredSendProviderEvent = createTriggeredSendProviderEvent()
