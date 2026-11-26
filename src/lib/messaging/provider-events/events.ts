/**
 * The wake-up event of a stored provider receipt: `crm.provider_event.received`.
 *
 * The webhook intake sends one after every receipt it stored (and again when a retried delivery of the same receipt
 * arrives as a duplicate), so the send ledger can follow up. The event carries only the key of the stored row; the
 * consumer reads the row itself. No address, no subject, no body. The event id is derived from the provider's own event
 * id, so Inngest runs the consumer once per receipt even when the provider delivers it twice.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §6.5 and §8.
 */

export const CRM_PROVIDER_EVENT_RECEIVED = 'crm.provider_event.received'

export interface ProviderEventReceivedData {
  [key: string]: unknown
  provider: 'resend'
  account: string
  provider_event_id: string
}

export interface ProviderEventReceivedEvent {
  id: string
  name: typeof CRM_PROVIDER_EVENT_RECEIVED
  data: ProviderEventReceivedData
}

const ACCOUNT_RE = /^[a-z][a-z0-9_]{1,30}$/
// The same alphabet and length as the intake's check on svix-id.
const PROVIDER_EVENT_ID_RE = /^[A-Za-z0-9_-]{1,200}$/

export function buildProviderEventReceived(args: { account: string; providerEventId: string }): ProviderEventReceivedEvent {
  return {
    id: `provider_event:resend:${args.account}:${args.providerEventId}`,
    name: CRM_PROVIDER_EVENT_RECEIVED,
    data: { provider: 'resend', account: args.account, provider_event_id: args.providerEventId },
  }
}

export type ParsedProviderEventReceived =
  | { ok: true; provider: 'resend'; account: string; providerEventId: string }
  | { ok: false; reason: string }

/** Strict parse of the event payload. Never throws. */
export function parseProviderEventReceived(data: unknown): ParsedProviderEventReceived {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { ok: false, reason: 'payload is not an object' }
  const record = data as Record<string, unknown>
  if (record.provider !== 'resend') return { ok: false, reason: 'provider is not resend' }
  if (typeof record.account !== 'string' || !ACCOUNT_RE.test(record.account)) return { ok: false, reason: 'account is malformed' }
  if (typeof record.provider_event_id !== 'string' || !PROVIDER_EVENT_ID_RE.test(record.provider_event_id)) {
    return { ok: false, reason: 'provider_event_id is malformed' }
  }
  return { ok: true, provider: 'resend', account: record.account, providerEventId: record.provider_event_id }
}
