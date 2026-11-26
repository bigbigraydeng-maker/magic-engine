/**
 * Reads a stored Resend receipt (provider_webhook_events) into provider-neutral facts. Resend-specific details (event
 * names, the payload layout, bounce types, how tags and headers come back) stay in this file; the send ledger only
 * sees `ProviderReceipt`.
 *
 * The recipient addresses never leave this function: only their fingerprints do.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §6.5 (layering: §16.10).
 */

import { emailAddressSha256s } from '@/lib/crm/address-sha256'
import type { ProviderReceipt, ReceiptKind, StoredProviderEvent } from './receipt-types'

export type { ProviderReceipt, ReceiptKind, StoredProviderEvent }

export const RESEND_RECEIPT_KINDS: Readonly<Record<string, ReceiptKind>> = {
  'email.sent': 'sent',
  'email.delivery_delayed': 'delivery_delayed',
  'email.delivered': 'delivered',
  'email.suppressed': 'suppressed',
  'email.failed': 'failed',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
}

const TAG_TEXT_RE = /^[A-Za-z0-9_-]{1,256}$/
const HEADER_VALUE_MAX = 2_000

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 2000 || d.getUTCFullYear() > 2100) return null
  return d.toISOString()
}

/** Resend's bounce type ("Permanent" / "Transient" / "Undetermined"). */
export function bounceKindOf(value: unknown): ProviderReceipt['bounceKind'] {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  return v === 'permanent' || v === 'transient' || v === 'undetermined' ? v : null
}

/** Tags as an object (`{ name: value }`) or as name/value pairs; anything that is not a plain token is dropped. */
export function tagsOf(value: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  const pairs: Array<[unknown, unknown]> = Array.isArray(value)
    ? value.map((t) => [record(t)?.name, record(t)?.value])
    : Object.entries(record(value) ?? {})
  for (const [name, tagValue] of pairs) {
    if (typeof name === 'string' && typeof tagValue === 'string' && TAG_TEXT_RE.test(name) && TAG_TEXT_RE.test(tagValue)) {
      out[name] = tagValue
    }
  }
  return out
}

/** The List-Unsubscribe header values, from headers given as name/value pairs or as an object. Case-insensitive. */
export function listUnsubscribeOf(value: unknown): string[] {
  const pairs: Array<[unknown, unknown]> = Array.isArray(value)
    ? value.map((h) => [record(h)?.name, record(h)?.value])
    : Object.entries(record(value) ?? {})
  return pairs
    .filter(([name, headerValue]) => typeof name === 'string' && name.toLowerCase() === 'list-unsubscribe' && typeof headerValue === 'string')
    .map(([, headerValue]) => (headerValue as string).slice(0, HEADER_VALUE_MAX))
}

/** Recipient fingerprints. Accepts plain addresses and "Name <address>". */
export function recipientFingerprints(to: unknown): string[] {
  const list = Array.isArray(to) ? to : typeof to === 'string' ? [to] : []
  const addresses = list
    .filter((a): a is string => typeof a === 'string')
    .map((a) => /<([^<>\s]+)>\s*$/.exec(a)?.[1] ?? a)
  return emailAddressSha256s(addresses)
}

export function readResendReceipt(stored: StoredProviderEvent): ProviderReceipt {
  const data = record(record(stored.payload)?.data)
  return {
    kind: RESEND_RECEIPT_KINDS[stored.eventType] ?? null,
    eventType: stored.eventType,
    messageId: stored.providerMessageId,
    occurredAt: isoOrNull(stored.occurredAt),
    emailCreatedAt: isoOrNull(data?.created_at),
    bounceKind: bounceKindOf(record(data?.bounce)?.type),
    tags: tagsOf(data?.tags),
    listUnsubscribe: listUnsubscribeOf(data?.headers),
    toFingerprints: recipientFingerprints(data?.to),
  }
}
