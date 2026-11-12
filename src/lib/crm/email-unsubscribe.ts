/**
 * Has this guest unsubscribed from e-mail through ME's one-click link (or marked one of ME's letters as spam)?
 *
 * Asked about a contact AND its addresses: the same address can sit on two contact records, and an unsubscribe given on
 * one of them must stop mail to that address from the other one too. A record (written by the unsubscribe entry and by
 * the receipt consumer, P2-2b) is one contact_touchpoints row:
 *   source 'me_unsubscribe', channel 'email', direction 'outbound', contact_id = the contact the letter was for,
 *   source_ref '<contact id>:<address fingerprint>' (one row per contact and address),
 *   occurred_at = the LATEST click or complaint (a later one moves it forward: the reply rule compares with it),
 *   metadata { automated: true, kind: 'email_unsubscribed', address_sha256: <fingerprint of the address it was sent to>,
 *              via: 'link' | 'complaint', triggered_send_id }.
 * Why 'outbound' although the guest acted: in the CRM read models "automated" is an outbound notion (ME's own letters,
 * Mailchimp campaigns, auto-replies are all outbound machine rows, and every reader skips them); an inbound e-mail row is
 * read as "the guest wrote to us" and would put an unsubscribed guest at the top of the call list (review 2026-11-10).
 * A row of this contact counts whatever its address; a row of another contact counts when its address fingerprint is
 * one of this guest's addresses.
 *
 * It stops e-mail only: it is not "do not contact", so calls and the sales lists are unaffected, and nothing in ME ever
 * turns it back on by itself (that needs the guest's new consent).
 * A failed read is `{ ok:false }`. Every caller must then refuse to send: an unreadable answer is never "not unsubscribed".
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §6.3 (address part: §16.8; writer and reply rule: §16.10).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { emailAddressSha256s } from './address-sha256'
import { EMAIL_UNSUBSCRIBE_SOURCE } from './touchpoint-sources'

export { EMAIL_UNSUBSCRIBE_SOURCE }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SHA256_RE = /^[0-9a-f]{64}$/

export type EmailUnsubscribeRead = { ok: true; unsubscribed: boolean } | { ok: false; error: string }

export interface EmailUnsubscribeReadOptions {
  /**
   * Only count records made AFTER this moment (ISO). Used when replying to a guest's own mail: an unsubscribe given
   * before the guest wrote to us again does not stop the reply to that mail.
   */
  after?: string
}

/**
 * `contactId: null` = a thread that is linked to no contact: only the addresses can match. With no contact and no
 * address there is nothing that can match, so the answer is "not unsubscribed".
 */
export async function readEmailUnsubscribed(
  db: SupabaseClient,
  clientId: string,
  guest: { contactId: string | null; addresses: readonly string[] },
  opts: EmailUnsubscribeReadOptions = {},
): Promise<EmailUnsubscribeRead> {
  // Both values go into a filter expression: refuse anything that is not exactly a uuid (the fingerprints are hex).
  if (guest.contactId !== null && !UUID_RE.test(guest.contactId)) {
    return { ok: false, error: 'unsubscribe read: contact id is not a uuid' }
  }
  const afterMs = opts.after === undefined ? null : Date.parse(opts.after)
  if (afterMs !== null && Number.isNaN(afterMs)) return { ok: false, error: 'unsubscribe read: "after" is not a time' }
  const fingerprints = emailAddressSha256s(guest.addresses)
  const terms: string[] = []
  if (guest.contactId !== null) terms.push(`contact_id.eq.${guest.contactId}`)
  if (fingerprints.length > 0) terms.push(`metadata->>address_sha256.in.(${fingerprints.join(',')})`)
  if (terms.length === 0) return { ok: true, unsubscribed: false }
  try {
    let query = db
      .from('contact_touchpoints')
      .select('id')
      .eq('client_id', clientId)
      .eq('source', EMAIL_UNSUBSCRIBE_SOURCE)
      .eq('channel', 'email')
      .or(terms.join(','))
    if (afterMs !== null) query = query.gt('occurred_at', new Date(afterMs).toISOString())
    const { data, error } = await query.limit(1)
    if (error) return { ok: false, error: `unsubscribe read: ${error.message}` }
    if (!Array.isArray(data)) return { ok: false, error: 'unsubscribe read: no rows array' }
    return { ok: true, unsubscribed: data.length > 0 }
  } catch (err) {
    return { ok: false, error: `unsubscribe read: ${err instanceof Error ? err.message : String(err)}` }
  }
}

export interface EmailUnsubscribeRecord {
  clientId: string
  contactId: string
  /** Fingerprint of the address the letter went to, copied from the send ledger row (never computed from input). */
  addressSha256: string
  /** triggered_sends.id of the letter. */
  triggeredSendId: string
  /** 'link' = the guest pressed the unsubscribe button; 'complaint' = the guest marked the letter as spam. */
  via: 'link' | 'complaint'
  /** ISO time of the click or of the complaint. */
  occurredAt: string
}

/** `created`: the first record of this contact and address; `refreshed`: an existing one moved to this later time. */
export type EmailUnsubscribeWrite = { ok: true; created: boolean; refreshed: boolean } | { ok: false; error: string }

const SUMMARY: Record<EmailUnsubscribeRecord['via'], string> = {
  link: '客人点了 ME 自动信里的退订链接：以后不再给他发邮件（打电话不受影响）',
  complaint: '客人把 ME 自动信标成了垃圾邮件：以后不再给他发邮件（打电话不受影响）',
}

function recordProblem(input: EmailUnsubscribeRecord): string | null {
  if (!UUID_RE.test(input.clientId)) return 'clientId is not a uuid'
  if (!UUID_RE.test(input.contactId)) return 'contactId is not a uuid'
  if (!UUID_RE.test(input.triggeredSendId)) return 'triggeredSendId is not a uuid'
  if (!SHA256_RE.test(input.addressSha256)) return 'addressSha256 is not a fingerprint'
  if (input.via !== 'link' && input.via !== 'complaint') return 'via is not link or complaint'
  if (Number.isNaN(Date.parse(input.occurredAt))) return 'occurredAt is not a time'
  return null
}

/** The row as it is written. One row per contact and address: the table's unique key makes every repeat a no-op. */
export function buildEmailUnsubscribeRow(input: EmailUnsubscribeRecord): Record<string, unknown> {
  return {
    client_id: input.clientId,
    contact_id: input.contactId,
    channel: 'email',
    direction: 'outbound',
    occurred_at: new Date(Date.parse(input.occurredAt)).toISOString(),
    summary: SUMMARY[input.via],
    raw: null,
    metadata: {
      automated: true,
      kind: 'email_unsubscribed',
      address_sha256: input.addressSha256,
      via: input.via,
      triggered_send_id: input.triggeredSendId,
    },
    source: EMAIL_UNSUBSCRIBE_SOURCE,
    source_ref: `${input.contactId}:${input.addressSha256}`,
  }
}

function codeOf(error: { code?: unknown }): string {
  return typeof error.code === 'string' ? error.code : 'unknown'
}

/**
 * Record the unsubscribe. A repeat (a second click, a click and a complaint) writes no second row, but moves the
 * existing row to the later time, so "unsubscribed after the guest's last mail" stays true after a guest who wrote in
 * unsubscribes again. An earlier time never moves it back.
 */
export async function recordEmailUnsubscribe(db: SupabaseClient, input: EmailUnsubscribeRecord): Promise<EmailUnsubscribeWrite> {
  const problem = recordProblem(input)
  if (problem !== null) return { ok: false, error: `invalid unsubscribe record: ${problem}` }
  const row = buildEmailUnsubscribeRow(input)
  try {
    const inserted = await db
      .from('contact_touchpoints')
      .upsert(row, { onConflict: 'client_id,source,source_ref', ignoreDuplicates: true })
      .select('id')
    // Only the error code: the details of a failed write can echo the whole row.
    if (inserted.error) return { ok: false, error: `unsubscribe write: ${codeOf(inserted.error)}` }
    if (Array.isArray(inserted.data) && inserted.data.length > 0) return { ok: true, created: true, refreshed: false }
    const moved = await db
      .from('contact_touchpoints')
      .update({ occurred_at: row.occurred_at, summary: row.summary, metadata: row.metadata })
      .eq('client_id', input.clientId)
      .eq('source', EMAIL_UNSUBSCRIBE_SOURCE)
      .eq('source_ref', row.source_ref as string)
      .lt('occurred_at', row.occurred_at as string)
      .select('id')
    if (moved.error) return { ok: false, error: `unsubscribe refresh: ${codeOf(moved.error)}` }
    return { ok: true, created: false, refreshed: Array.isArray(moved.data) && moved.data.length > 0 }
  } catch (err) {
    return { ok: false, error: `unsubscribe write: ${err instanceof Error ? err.name : 'exception'}` }
  }
}
