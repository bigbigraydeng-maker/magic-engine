/**
 * Reads the 「发信统计」 page's data (see `types.ts`). Receipts and names are required (a failure throws, so the page
 * shows an error, never an empty table); clicks and "got in touch" are extra: when one cannot be read it is marked
 * unreadable instead of being shown as zero.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { listReceiptsSince } from '@/lib/crm/email-templates/receipt-store'
import { listCurrentTemplates } from '@/lib/crm/email-templates/template-store'
import { humanClicksByRequest } from '@/lib/crm/email-templates/link-tracking/click-summary'
import { loadReactions } from './reactions'
import type { SendStatRow, SendStatsPayload } from './types'

export const SEND_STATS_MAX_ROWS = 500
export const SEND_STATS_DEFAULT_DAYS = 7
export const SEND_STATS_MAX_DAYS = 90

export function clampDays(raw: string | null): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1) return SEND_STATS_DEFAULT_DAYS
  return Math.min(Math.floor(n), SEND_STATS_MAX_DAYS)
}

async function readNames(db: SupabaseClient, clientId: string, contactIds: readonly string[]): Promise<Map<string, string | null>> {
  const names = new Map<string, string | null>()
  for (let i = 0; i < contactIds.length; i += 100) {
    const { data, error } = await db.from('contacts').select('id, display_name').eq('client_id', clientId).in('id', contactIds.slice(i, i + 100))
    if (error) throw new Error(`contacts: ${error.message}`)
    for (const row of (data as Array<{ id: string; display_name: string | null }> | null) ?? []) names.set(row.id, row.display_name)
  }
  return names
}

export async function readSendStats(db: SupabaseClient, clientId: string, days: number, now: Date = new Date()): Promise<SendStatsPayload> {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString()
  const receipts = await listReceiptsSince(db, clientId, since, SEND_STATS_MAX_ROWS + 1)
  const truncated = receipts.length > SEND_STATS_MAX_ROWS
  const kept = truncated ? receipts.slice(0, SEND_STATS_MAX_ROWS) : receipts
  const names = await readNames(db, clientId, [...new Set(kept.map((r) => r.contactId))])
  const templates = new Map((await listCurrentTemplates(db, clientId)).map((t) => [t.templateKey, t.name]))
  const sent = kept.filter((r) => r.outcome === 'sent')
  const clicks = await humanClicksByRequest(db, clientId, [...new Set(sent.map((r) => r.requestId))])
  const reactions = await loadReactions(db, clientId, sent.map((r) => ({ key: r.id, contactId: r.contactId, sentAt: r.createdAt })))
  const rows: SendStatRow[] = kept.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    contactId: r.contactId,
    contactName: names.get(r.contactId) ?? null,
    templateKey: r.templateKey,
    templateName: r.templateKey === null ? null : (templates.get(r.templateKey) ?? null),
    outcome: r.outcome,
    blockReason: r.blockReason,
    clicks: r.outcome !== 'sent' ? [] : clicks === null ? null : (clicks[r.requestId] ?? []),
    reaction: reactions?.get(r.id) ?? null,
  }))
  return { days, truncated, reactionsReadable: reactions !== null, rows }
}
