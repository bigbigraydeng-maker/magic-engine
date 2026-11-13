/**
 * Weekly plan reads the newest stored Monday readback suggestion for this client.
 * Source: social-readback-weekly → cron_run_logs.summary.clients[].suggestion (read-only).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import type { ReadState } from './types'

export const WEEKLY_READBACK_JOB = 'social-readback-weekly'
/** Same window as pm-daily-todo readback items — older receipts are ignored. */
export const READBACK_SUGGESTION_FRESH_DAYS = 8

export interface ReadbackSuggestionInput {
  read: ReadState
  asOf: string | null
  /** Reference lines for downstream drafting; never changes settings. */
  draftBasis: string[]
}

export function emptyReadbackSuggestion(read: ReadState = 'none'): ReadbackSuggestionInput {
  return { read, asOf: null, draftBasis: [] }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const s = (v: unknown): string => (typeof v === 'string' ? v : '')

export function latestClientReadbackReceipt(
  rows: ReadonlyArray<{ summary: unknown }>,
  clientId: string,
): unknown | null {
  for (const row of rows) {
    const summary = isRecord(row.summary) ? row.summary : null
    if (!summary) continue
    for (const client of Array.isArray(summary.clients) ? summary.clients : []) {
      if (isRecord(client) && client.client_id === clientId) return client
    }
  }
  return null
}

/** Turn one client receipt into draft basis lines. Does not throw. */
export function parseReadbackSuggestion(receipt: unknown): ReadbackSuggestionInput {
  if (!isRecord(receipt)) return emptyReadbackSuggestion()
  const asOf = s(receipt.as_of) || null
  if (receipt.error) return { ...emptyReadbackSuggestion('unreadable'), asOf }
  const suggestion = isRecord(receipt.suggestion) ? receipt.suggestion : null
  const lines = Array.isArray(suggestion?.lines)
    ? suggestion.lines.filter((line): line is string => typeof line === 'string' && line.trim().length > 0)
    : []
  if (suggestion?.status === 'ok' && lines.length > 0) {
    return {
      read: 'ok',
      asOf,
      draftBasis: [
        `读回建议（${asOf ?? '日期未知'}，Facebook Reel 每周回看）：`,
        ...lines.map((line) => `读回：${line.trim()}`),
      ],
    }
  }
  return { read: 'none', asOf, draftBasis: [] }
}

export async function loadReadbackSuggestionRows(
  db: SupabaseClient,
  now: Date,
): Promise<{ error: boolean; rows: Array<{ summary: unknown }> }> {
  const since = new Date(now.getTime() - READBACK_SUGGESTION_FRESH_DAYS * 86_400_000).toISOString()
  const { data, error } = await db
    .from('cron_run_logs')
    .select('summary, started_at')
    .eq('job_name', WEEKLY_READBACK_JOB)
    .in('status', ['completed', 'partial', 'failed'])
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(20)
  if (error) return { error: true, rows: [] }
  const rows = (Array.isArray(data) ? data : []).flatMap((row) => (isRecord(row) ? [{ summary: row.summary }] : []))
  return { error: false, rows }
}

export async function readReadbackSuggestionForClient(
  db: SupabaseClient,
  clientId: string,
  now: Date,
): Promise<ReadbackSuggestionInput> {
  const loaded = await loadReadbackSuggestionRows(db, now)
  if (loaded.error) return emptyReadbackSuggestion('unreadable')
  const receipt = latestClientReadbackReceipt(loaded.rows, clientId)
  if (!receipt) return emptyReadbackSuggestion()
  return parseReadbackSuggestion(receipt)
}
