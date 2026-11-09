/**
 * Magic Engine 2.0 · Inngest consumer of provider receipts for ME's automated e-mails.
 *
 * `cloud-triggered-send-provider-event` runs once per `crm.provider_event.received` (one per stored Resend receipt):
 *   1. `load-event`: read the stored receipt; keep its type, the provider message id, times, bounce type, the
 *      `triggered_send_id` tag and the FINGERPRINTS of its recipients (never the addresses: step results are stored).
 *   2. `apply-<n>`: find the ledger row of that letter and move it forward (receipt-consumer.ts). A row that is still
 *      `pending` without a message id is waited for, up to IN_FLIGHT_ATTEMPTS tries IN_FLIGHT_WAIT apart; the last try
 *      matches it by address.
 * Receipts of ME's own system mail (same Resend account) match no row and end at once: no retry, no alert.
 *
 * 🔴 Sends nothing, changes no contact's details. Its only writes: the ledger row's status / receipt columns, and for a
 *    complaint one e-mail-unsubscribe record. Each step is idempotent (the ledger only moves forward; the unsubscribe
 *    record has a unique key), so Inngest's retries and replays are safe.
 * 🔴 Not a cron job: no run log row per receipt (the ledger row itself is the receipt of what happened).
 */

import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { CRM_PROVIDER_EVENT_RECEIVED, parseProviderEventReceived } from '@/lib/messaging/provider-events/events'
import {
  applyReceipt,
  loadReceipt,
  type LoadedReceipt,
  type ReceiptOutcome,
  type ReceiptStore,
} from '@/lib/messaging/triggered-send/receipt-consumer'
import { createReceiptStore, loadStoredReceipt } from '@/lib/messaging/triggered-send/receipt-store-prod'

export const TRIGGERED_SEND_PROVIDER_EVENT_ID = `${CLOUD_FN_PREFIX}triggered-send-provider-event`
export const IN_FLIGHT_ATTEMPTS = 4
export const IN_FLIGHT_WAIT = '2m'

export interface ReceiptStepTools {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>
  sleep(id: string, duration: string): Promise<void>
}

export interface ReceiptRunDeps {
  load(key: { account: string; providerEventId: string }): Promise<LoadedReceipt | null>
  store: ReceiptStore
  now(): Date
}

export type ReceiptRunResult =
  | { outcome: 'skipped'; reason: string }
  | { outcome: 'event_missing' }
  | ReceiptOutcome

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
  let result: ReceiptOutcome = { outcome: 'not_ours' }
  for (let attempt = 1; attempt <= IN_FLIGHT_ATTEMPTS; attempt++) {
    const bindPending = attempt === IN_FLIGHT_ATTEMPTS
    result = await step.run(`apply-${attempt}`, () => applyReceipt(loaded, deps.store, { bindPending, now: deps.now() }))
    if (result.outcome !== 'in_flight') return result
    if (!bindPending) await step.sleep(`wait-${attempt}`, IN_FLIGHT_WAIT)
  }
  return result
}

function realDeps(): ReceiptRunDeps {
  return {
    load: async (key) => {
      const stored = await loadStoredReceipt(supabaseAdmin, key)
      return stored === null ? null : loadReceipt(stored)
    },
    store: createReceiptStore(supabaseAdmin),
    now: () => new Date(),
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
