/**
 * The real sources behind the rolling per-guest email cap. Each answers "which emails did we send this guest since X";
 * a source that cannot answer returns { ok:false } and the cap fails closed (it is never read as zero).
 * Design: docs/specs/2026-10-28-crm-post-call-email-templates-design-v0.md §8.4.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { emailAddressSha256s } from '@/lib/crm/address-sha256'
import { readAudienceId, type AudienceIdRead } from '@/lib/mailchimp/audience-config'
import { getCampaignRecipientStatus, listSentCampaigns, type MailchimpCampaign } from '@/lib/mailchimp/client'
import { collectSentItems, toOutboundItems, type PageFetcher } from './gates/sent-items'
import type { FrequencySources, OutboundItem, SourceResult } from './gates/types'

const CAMPAIGN_PAGE = 100

export interface MailboxRef {
  connectionId: string
  account: string
}

export interface MailchimpPort {
  apiKey(): string | undefined
  readAudience(clientId: string): Promise<AudienceIdRead>
  listSentCampaigns(apiKey: string, opts: { sinceSentAt: string; listId: string; count: number }): Promise<MailchimpCampaign[]>
  getCampaignRecipientStatus(apiKey: string, campaignId: string, email: string): Promise<'sent' | 'soft' | 'hard' | 'not_recipient'>
}

export interface FrequencySourceDeps {
  db: SupabaseClient
  clientId: string
  listActiveMailboxes(clientId: string): Promise<MailboxRef[]>
  graphGetPage(connectionId: string, pathOrUrl: string): Promise<{ ok: true; json: unknown } | { ok: false; error: string }>
  mailchimp?: MailchimpPort
}

const REAL_MAILCHIMP: MailchimpPort = {
  apiKey: () => process.env.MAILCHIMP_API_KEY,
  readAudience: readAudienceId,
  listSentCampaigns,
  getCampaignRecipientStatus,
}

function failure(err: unknown): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error ? err.message : String(err) }
}

/** `req:<requestId>|msg:<id>` or `req:<requestId>|draft:<id>` -> the Graph message id, else null. */
export function messageIdOfAudit(meta: string | null): string | null {
  const match = /\|(?:msg|draft):(.+)$/.exec(meta ?? '')
  return match ? match[1] : null
}

async function sentItemsSource(deps: FrequencySourceDeps, addresses: readonly string[], sinceIso: string): Promise<SourceResult> {
  const boxes = await deps.listActiveMailboxes(deps.clientId)
  if (boxes.length === 0) return { ok: false, error: 'no connected mailbox to read sent items from' }
  const items: OutboundItem[] = []
  for (const box of boxes) {
    const fetchPage: PageFetcher = (path) => deps.graphGetPage(box.connectionId, path)
    const collected = await collectSentItems(fetchPage, sinceIso)
    if (!collected.ok) return { ok: false, error: `${box.account}: ${collected.error}` }
    items.push(...toOutboundItems(collected.messages, addresses))
  }
  return { ok: true, items }
}

async function auditSource(deps: FrequencySourceDeps, contactId: string, sinceIso: string): Promise<SourceResult> {
  const convos = await deps.db
    .from('conversations')
    .select('id')
    .eq('client_id', deps.clientId)
    .eq('contact_id', contactId)
    .eq('channel', 'email')
  if (convos.error) return { ok: false, error: `conversations: ${convos.error.message}` }
  const ids = ((convos.data as Array<{ id: string }> | null) ?? []).map((c) => c.id)
  if (ids.length === 0) return { ok: true, items: [] }
  const rows = await deps.db
    .from('conversation_outbound_log')
    .select('id, meta_message_id, created_at')
    .eq('client_id', deps.clientId)
    .in('conversation_id', ids)
    .eq('messaging_type', 'email')
    .in('status', ['pending', 'sent'])
    .gte('created_at', sinceIso)
  if (rows.error) return { ok: false, error: `audit: ${rows.error.message}` }
  const list = (rows.data as Array<{ id: string; meta_message_id: string | null; created_at: string }> | null) ?? []
  return {
    ok: true,
    items: list.map((r) => ({ source: 'audit', id: messageIdOfAudit(r.meta_message_id), at: r.created_at, subject: null, address: '' })),
  }
}

async function touchpointSource(deps: FrequencySourceDeps, contactId: string, sinceIso: string): Promise<SourceResult> {
  const rows = await deps.db
    .from('contact_touchpoints')
    .select('source_ref, occurred_at, metadata')
    .eq('client_id', deps.clientId)
    .eq('contact_id', contactId)
    .eq('channel', 'email')
    .eq('direction', 'outbound')
    .gte('occurred_at', sinceIso)
    .limit(500)
  if (rows.error) return { ok: false, error: `touchpoints: ${rows.error.message}` }
  const list =
    (rows.data as Array<{ source_ref: string | null; occurred_at: string; metadata: Record<string, unknown> | null }> | null) ?? []
  return {
    ok: true,
    items: list
      // out-of-office / auto-replies are not "emails we sent"; ME's own automated mails are counted by meSends instead
      .filter((r) => r.metadata?.automated !== true)
      .map((r) => ({ source: 'touchpoint', id: r.source_ref, at: r.occurred_at, subject: null, address: '' })),
  }
}

// Send-ledger rows of a mail that went out or may have gone out: exactly the ledger's own "one address, one welcome"
// index (supabase/migrations/20261102130000_triggered_send_ledger.sql, triggered_sends_lifetime_address_idx; a test pins
// the two together): these statuses, plus `failed` with reason `not_sent_confirmed` (a person marked it "not sent";
// a late receipt can still prove otherwise, so it is counted — counting too many can only block a send). Any other
// `failed` (the provider refused it), blocked, skipped and rehearsal rows are not mail.
export const ME_SEND_COUNTED_STATUSES = [
  'pending',
  'unknown_outcome',
  'sent',
  'delivery_delayed',
  'delivered',
  'suppressed',
  'bounced',
  'complained',
] as const
export const ME_SEND_NOT_SENT_CONFIRMED = 'not_sent_confirmed'
// The ledger never (re)sends a mail more than 20 hours after its first attempt. A mail counts from when it went out
// (sent_at); while that is not known, from the LATEST moment it could have gone out (first attempt + 20 hours, or now
// if that is still ahead), so it never leaves the window early. Rows are read from a day before the window.
const ME_SEND_LATEST_SEND_MS = 20 * 3_600_000
const ME_SEND_LOOKBACK_MS = 24 * 3_600_000
const ME_SEND_PAGE = 500
const ME_SEND_SUBJECT = 'ME 自动发的信'

/**
 * ME's own automated mails to these addresses, read from the send ledger by address fingerprint: one item per mail,
 * `automated: true`, never folded into another record (gates/frequency.ts). Reading by address, not by contact, is the
 * point: the same address on two contact records must not let a second mail through.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §16.8.
 */
async function meSendSource(deps: FrequencySourceDeps, addresses: readonly string[], sinceIso: string): Promise<SourceResult> {
  const fingerprints = emailAddressSha256s(addresses)
  if (fingerprints.length === 0) return { ok: true, items: [] }
  const sinceMs = Date.parse(sinceIso)
  if (Number.isNaN(sinceMs)) return { ok: false, error: 'me sends: the window start is not a time' }
  const rows = await deps.db
    .from('triggered_sends')
    .select('id, status, reason_code, first_attempt_at, sent_at')
    .eq('client_id', deps.clientId)
    .eq('channel', 'email')
    // every scope but the rehearsal: a later kind of letter with its own scope is still real mail
    .neq('dedupe_scope', 'shadow')
    .in('status', [...ME_SEND_COUNTED_STATUSES, 'failed'])
    .in('to_address_sha256', fingerprints)
    .gte('first_attempt_at', new Date(sinceMs - ME_SEND_LOOKBACK_MS).toISOString())
    .limit(ME_SEND_PAGE)
  if (rows.error) return { ok: false, error: `me sends: ${rows.error.message}` }
  const list =
    (rows.data as Array<{
      id: string
      status: string
      reason_code: string | null
      first_attempt_at: string | null
      sent_at: string | null
    }> | null) ?? []
  // A full page means there may be more than we saw: then we cannot vouch for the count.
  if (list.length >= ME_SEND_PAGE) return { ok: false, error: 'me sends: too many rows to check them all' }
  const nowMs = Date.now()
  return {
    ok: true,
    items: list
      .filter((r) => r.status !== 'failed' || r.reason_code === ME_SEND_NOT_SENT_CONFIRMED)
      .map((r) => ({
        source: 'me_send',
        id: r.id,
        at: countedAt(r.sent_at, r.first_attempt_at, nowMs),
        subject: ME_SEND_SUBJECT,
        address: '',
        automated: true,
      })),
  }
}

/** When a ledger row counts from. An unreadable time stays unreadable, and the cap counts unreadable times anyway. */
function countedAt(sentAt: string | null, firstAttemptAt: string | null, nowMs: number): string {
  if (sentAt !== null) return sentAt
  const firstMs = firstAttemptAt === null ? NaN : Date.parse(firstAttemptAt)
  if (Number.isNaN(firstMs)) return firstAttemptAt ?? ''
  return new Date(Math.min(firstMs + ME_SEND_LATEST_SEND_MS, nowMs)).toISOString()
}

async function recipientItems(
  port: MailchimpPort,
  apiKey: string,
  campaign: MailchimpCampaign,
  addresses: readonly string[],
): Promise<OutboundItem[]> {
  const items: OutboundItem[] = []
  for (const address of addresses) {
    const status = await port.getCampaignRecipientStatus(apiKey, campaign.id, address)
    if (status === 'sent' || status === 'soft') {
      items.push({ source: 'mailchimp', id: `mc:${campaign.id}:${address.toLowerCase()}`, at: campaign.sentAt as string, subject: campaign.subject, address: address.toLowerCase() })
    }
  }
  return items
}

async function mailchimpSource(
  deps: FrequencySourceDeps,
  addresses: readonly string[],
  sinceIso: string,
): ReturnType<FrequencySources['mailchimp']> {
  const port = deps.mailchimp ?? REAL_MAILCHIMP
  const audience = await port.readAudience(deps.clientId)
  if (!audience.ok) return { ok: false, error: `mailchimp audience: ${audience.message}` }
  if (audience.audienceId === '') return { ok: true, items: [], applicable: false }
  const apiKey = port.apiKey()
  if (!apiKey) return { ok: false, error: 'MAILCHIMP_API_KEY is not set' }
  // Only THIS client's audience, and one full page means there may be more we did not see: then we cannot vouch for the count.
  const campaigns = await port.listSentCampaigns(apiKey, { sinceSentAt: sinceIso, listId: audience.audienceId, count: CAMPAIGN_PAGE })
  if (campaigns.length >= CAMPAIGN_PAGE) return { ok: false, error: 'too many Mailchimp campaigns in the window to check them all' }
  const items: OutboundItem[] = []
  for (const campaign of campaigns) {
    if (campaign.sentAt === null || campaign.sentAt < sinceIso) continue
    items.push(...(await recipientItems(port, apiKey, campaign, addresses)))
  }
  return { ok: true, items }
}

export function createFrequencySources(deps: FrequencySourceDeps): FrequencySources {
  return {
    sentItems: (addresses, sinceIso) => sentItemsSource(deps, addresses, sinceIso).catch(failure),
    audit: (contactId, sinceIso) => auditSource(deps, contactId, sinceIso).catch(failure),
    touchpoints: (contactId, sinceIso) => touchpointSource(deps, contactId, sinceIso).catch(failure),
    mailchimp: (addresses, sinceIso) => mailchimpSource(deps, addresses, sinceIso).catch(failure),
    meSends: (addresses, sinceIso) => meSendSource(deps, addresses, sinceIso).catch(failure),
  }
}
