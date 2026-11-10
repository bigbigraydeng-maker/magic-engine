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
import type { SendStatClick, SendStatRow, SendStatsPayload } from './types'

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

/** Human clicks per send request, asked for 100 requests at a time (the ids travel in the URL). `null` when any batch fails. */
async function readClicks(db: SupabaseClient, clientId: string, requestIds: readonly string[]): Promise<Record<string, SendStatClick[]> | null> {
  const merged: Record<string, SendStatClick[]> = {}
  for (let i = 0; i < requestIds.length; i += 100) {
    const part = await humanClicksByRequest(db, clientId, requestIds.slice(i, i + 100))
    if (part === null) return null
    Object.assign(merged, part)
  }
  return merged
}

/**
 * The receipts table only ever gains rows: settling an `unknown` send, or sending again under the same request, adds a
 * row and leaves the old one. One request is one mail: it takes the LATEST row's result and the EARLIEST row's time
 * (the moment it was actually sent, not the moment it was settled). `newestFirst` is newest first.
 */
export function latestPerRequest<T extends { requestId: string; contactId: string; createdAt: string }>(newestFirst: readonly T[]): T[] {
  const byKey = new Map<string, { row: T; firstAt: string }>()
  for (const r of newestFirst) {
    const key = `${r.contactId}|${r.requestId}`
    const seen = byKey.get(key)
    if (!seen) byKey.set(key, { row: r, firstAt: r.createdAt })
    else if (Date.parse(r.createdAt) < Date.parse(seen.firstAt)) seen.firstAt = r.createdAt
  }
  return [...byKey.values()].map(({ row, firstAt }) => (firstAt === row.createdAt ? row : { ...row, createdAt: firstAt }))
}

export async function readSendStats(db: SupabaseClient, clientId: string, days: number, now: Date = new Date()): Promise<SendStatsPayload> {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString()
  const receipts = await listReceiptsSince(db, clientId, since, SEND_STATS_MAX_ROWS + 1)
  const truncated = receipts.length > SEND_STATS_MAX_ROWS
  const kept = latestPerRequest(truncated ? receipts.slice(0, SEND_STATS_MAX_ROWS) : receipts)
  const names = await readNames(db, clientId, [...new Set(kept.map((r) => r.contactId))])
  const templates = new Map((await listCurrentTemplates(db, clientId)).map((t) => [t.templateKey, t.name]))
  const sent = kept.filter((r) => r.outcome === 'sent')
  const clicks = await readClicks(db, clientId, [...new Set(sent.map((r) => r.requestId))])
  const reactions = await loadReactions(db, clientId, sent.map((r) => ({ key: r.id, contactId: r.contactId, sentAt: r.createdAt })), now)
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
