/**
 * The CRM timeline row of one automated e-mail that ME sends.
 *
 * Written when the send is CLAIMED, before the provider is called: the sales path's rolling per-guest cap then already
 * counts a mail whose outcome is still unknown (written after sending, a timeout would leave it uncounted). Turned into
 * "cancelled" (no longer counted) only when the provider definitely refused the mail. One row per send, keyed by the
 * ledger row id (source_ref), so a replay of the same send never writes a second row. Deliveries, bounces and complaints
 * update the ledger (triggered_sends), never this row: one mail is one touchpoint.
 *
 * The row is `automated: true` (nothing reads it as a person's follow-up) and `counts_toward_frequency: true` (the weekly
 * cap counts it), with a non-empty subject label (the cap's de-duplication folds two mails sent close together when one
 * of them has no subject). It holds no address, no subject line and no body.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §6.4.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export const ME_SEND_SOURCE = 'me_send'

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

// A type literal (not an interface) so it is a plain JSON record wherever metadata is read as Record<string, unknown>.
export type SendTouchpointMetadata = {
  automated: true
  transport: 'resend'
  counts_toward_frequency: boolean
  subject_label: string
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
    counts_toward_frequency: state === 'claimed',
    subject_label: `${ME_SEND_SOURCE}:${triggerKey}`,
    triggered_send_id: triggeredSendId,
    trigger_key: triggerKey,
    send_state: state,
  }
}

function inputProblem(input: SendTouchpointInput): string | null {
  if (!UUID_RE.test(input.clientId)) return 'clientId is not a uuid'
  if (!UUID_RE.test(input.contactId)) return 'contactId is not a uuid'
  if (!UUID_RE.test(input.triggeredSendId)) return 'triggeredSendId is not a uuid'
  if (!TRIGGER_KEY_RE.test(input.triggerKey)) return 'triggerKey is malformed'
  if (Number.isNaN(Date.parse(input.occurredAt))) return 'occurredAt is not a time'
  const summary = input.summary.trim()
  if (summary === '' || summary.length > SUMMARY_MAX) return 'summary is empty or too long'
  return null
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
 * The provider definitely refused the mail: the row stays on the timeline but stops counting toward the cap.
 * `updated: 0` means there was no row (the claim crashed before writing it): nothing was counted, nothing to undo.
 */
export async function cancelSendTouchpoint(
  db: SupabaseClient,
  args: { clientId: string; triggeredSendId: string; triggerKey: string },
): Promise<TouchpointCancel> {
  if (!UUID_RE.test(args.clientId) || !UUID_RE.test(args.triggeredSendId) || !TRIGGER_KEY_RE.test(args.triggerKey)) {
    return { ok: false, error: 'invalid touchpoint input' }
  }
  try {
    const { data, error } = await db
      .from(TABLE)
      .update({ metadata: sendTouchpointMetadata(args.triggeredSendId, args.triggerKey, 'cancelled') })
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
