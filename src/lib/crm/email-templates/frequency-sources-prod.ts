/**
 * The real sources behind the rolling per-guest email cap. Each answers "which emails did we send this guest since X";
 * a source that cannot answer returns { ok:false } and the cap fails closed (it is never read as zero).
 * Design: docs/specs/2026-10-28-crm-post-call-email-templates-design-v0.md §8.4.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { readAudienceId, type AudienceIdRead } from '@/lib/mailchimp/audience-config'
import { getCampaignRecipientStatus, listSentCampaigns, type MailchimpCampaign } from '@/lib/mailchimp/client'
import { collectSentItems, toOutboundItems, type PageFetcher } from './gates/sent-items'
import type { FrequencySources, OutboundItem, SourceResult } from './gates/types'

export interface MailboxRef {
  connectionId: string
  account: string
}

export interface MailchimpPort {
  apiKey(): string | undefined
  readAudience(clientId: string): Promise<AudienceIdRead>
  listSentCampaigns(apiKey: string, opts: { sinceSentAt: string }): Promise<MailchimpCampaign[]>
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
      .filter((r) => r.metadata?.automated !== true) // out-of-office / auto-replies are not "emails we sent"
      .map((r) => ({ source: 'touchpoint', id: r.source_ref, at: r.occurred_at, subject: null, address: '' })),
  }
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
  const campaigns = await port.listSentCampaigns(apiKey, { sinceSentAt: sinceIso })
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
  }
}
