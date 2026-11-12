/**
 * The CRM timeline row of one automated e-mail that ME sends.
 *
 * Timeline only. The weekly per-guest cap does NOT count this row: it counts ME's mails from the send ledger
 * (triggered_sends) by address fingerprint (frequency source `meSends`), so a guest whose address sits on two contact
 * records is still counted, and a pending or unknown mail is counted from the moment it is claimed.
 *
 * Written when the send is claimed; marked "cancelled" (with its timeline line rewritten) when the provider definitely
 * refused the mail. One row per send, keyed by the ledger row id (source_ref), so a replay never writes a second one.
 * Deliveries, bounces and complaints update the ledger, never this row. The row is `automated: true` (source `me_send`),
 * so nothing reads it as a person following the guest up. It holds no address, no subject line and no body.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §6.4 (counting moved to the ledger: §16.8).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { ME_SEND_SOURCE } from '@/lib/crm/touchpoint-sources'

export { ME_SEND_SOURCE }

const TABLE = 'contact_touchpoints'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TRIGGER_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/
const SUMMARY_MAX = 200

export interface SendTouchpointInput {
  clientId: string
  contactId: string
  /** triggered_sends.id: becomes source_ref, so the table's unique key makes the write idempotent. */
  triggeredSendId: string
  /** The trigger, e.g. 'welcome'. Lower-case letters, digits and underscores. */
  triggerKey: string
  /** ISO time of the claim. */
  occurredAt: string
  /** One plain line for the timeline, without personal data (e.g. 「ME 自动发出：欢迎信」). */
  summary: string
}

export type SendState = 'claimed' | 'cancelled'

/** The welcome letter's timeline line once it is known it did not go (refused by the provider, or a person said so). */
export const WELCOME_NOT_SENT_TIMELINE_LINE = 'ME 自动发信没有发出：欢迎信'

// A type literal (not an interface) so it is a plain JSON record wherever metadata is read as Record<string, unknown>.
export type SendTouchpointMetadata = {
  automated: true
  transport: 'resend'
  triggered_send_id: string
  trigger_key: string
  send_state: SendState
}

export type TouchpointWrite = { ok: true } | { ok: false; error: string }
export type TouchpointCancel = { ok: true; updated: number } | { ok: false; error: string }

export function sendTouchpointMetadata(triggeredSendId: string, triggerKey: string, state: SendState): SendTouchpointMetadata {
  return {
    automated: true,
    transport: 'resend',
    triggered_send_id: triggeredSendId,
    trigger_key: triggerKey,
    send_state: state,
  }
}

function summaryProblem(summary: string): string | null {
  const trimmed = summary.trim()
  return trimmed === '' || trimmed.length > SUMMARY_MAX ? 'summary is empty or too long' : null
}

function inputProblem(input: SendTouchpointInput): string | null {
  if (!UUID_RE.test(input.clientId)) return 'clientId is not a uuid'
  if (!UUID_RE.test(input.contactId)) return 'contactId is not a uuid'
  if (!UUID_RE.test(input.triggeredSendId)) return 'triggeredSendId is not a uuid'
  if (!TRIGGER_KEY_RE.test(input.triggerKey)) return 'triggerKey is malformed'
  if (Number.isNaN(Date.parse(input.occurredAt))) return 'occurredAt is not a time'
  return summaryProblem(input.summary)
}

export function buildSendTouchpointRow(input: SendTouchpointInput): Record<string, unknown> {
  return {
    client_id: input.clientId,
    contact_id: input.contactId,
    channel: 'email',
    direction: 'outbound',
    occurred_at: new Date(Date.parse(input.occurredAt)).toISOString(),
    summary: input.summary.trim(),
    raw: null,
    metadata: sendTouchpointMetadata(input.triggeredSendId, input.triggerKey, 'claimed'),
    source: ME_SEND_SOURCE,
    source_ref: input.triggeredSendId,
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Write the row of a claimed send. Writing it again for the same send is a no-op (the first row stays as it was). */
export async function writeSendTouchpoint(db: SupabaseClient, input: SendTouchpointInput): Promise<TouchpointWrite> {
  const problem = inputProblem(input)
  if (problem !== null) return { ok: false, error: `invalid touchpoint input: ${problem}` }
  try {
    const { error } = await db
      .from(TABLE)
      .upsert(buildSendTouchpointRow(input), { onConflict: 'client_id,source,source_ref', ignoreDuplicates: true })
    if (error) return { ok: false, error: `touchpoint write: ${error.message}` }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: `touchpoint write: ${errorText(err)}` }
  }
}

/**
 * The provider definitely refused the mail (or a person confirmed it was not sent): the row stays on the timeline,
 * marked cancelled, and its line says so (`summary`, e.g. 「ME 自动发信被拒收，没有发出：欢迎信」).
 * `updated: 0` means there was no row (the claim crashed before writing it): nothing to rewrite.
 */
export async function cancelSendTouchpoint(
  db: SupabaseClient,
  args: { clientId: string; triggeredSendId: string; triggerKey: string; summary: string },
): Promise<TouchpointCancel> {
  if (
    !UUID_RE.test(args.clientId) ||
    !UUID_RE.test(args.triggeredSendId) ||
    !TRIGGER_KEY_RE.test(args.triggerKey) ||
    summaryProblem(args.summary) !== null
  ) {
    return { ok: false, error: 'invalid touchpoint input' }
  }
  try {
    const { data, error } = await db
      .from(TABLE)
      .update({
        metadata: sendTouchpointMetadata(args.triggeredSendId, args.triggerKey, 'cancelled'),
        summary: args.summary.trim(),
      })
      .eq('client_id', args.clientId)
      .eq('source', ME_SEND_SOURCE)
      .eq('source_ref', args.triggeredSendId)
      .select('id')
    if (error) return { ok: false, error: `touchpoint cancel: ${error.message}` }
    return { ok: true, updated: Array.isArray(data) ? data.length : 0 }
  } catch (err) {
    return { ok: false, error: `touchpoint cancel: ${errorText(err)}` }
  }
}
