/**
 * Failures that happen after the person agrees, but before that item is authorised,
 * are written onto the confirmation card that was just approved.
 * The card already lives on action_runs. This only fills its evidence field.
 * Status, input and the execution lease are left alone: the confirmation action
 * never runs a handler, so nothing else is writing this field.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { CONFIRMATION_ACTION_KEY } from '@/lib/kernel/registry-confirmation'

import type { WeekPackLine } from './types'

export const WEEK_PACK_UNPUBLISHED_KEY = 'week_pack_unpublished'

const FAILURE_CODES = new Set([
  'story_forbidden',
  'story_failed',
  'story_unread',
  'preview_required',
  'reel_failed',
  'reel_forbidden',
  'reel_unread',
  'first_comment_failed',
])

export function unpublishedFailures(lines: readonly WeekPackLine[]): WeekPackLine[] {
  return lines.filter((line) => !line.ok && FAILURE_CODES.has(line.code))
}

export function heldEvidence(lines: readonly WeekPackLine[], recordedAt: string): { recorded_at: string; items: WeekPackLine[] } {
  return {
    recorded_at: recordedAt,
    items: lines.map((line) => ({
      kind: line.kind,
      stable_id: line.stable_id,
      code: line.code,
      ok: false,
      text: plain(line.text),
    })),
  }
}

/** `none` when this card has no unpublished note. `invalid` when the note is unreadable. */
export function readHeldEvidence(evidence: unknown): WeekPackLine[] | 'none' | 'invalid' {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return 'none'
  const block = (evidence as Record<string, unknown>)[WEEK_PACK_UNPUBLISHED_KEY]
  if (block === undefined) return 'none'
  if (!block || typeof block !== 'object' || Array.isArray(block)) return 'invalid'
  const items = (block as { items?: unknown }).items
  if (!Array.isArray(items)) return 'invalid'
  const lines: WeekPackLine[] = []
  for (const item of items) {
    const line = readLine(item)
    if (!line) return 'invalid'
    lines.push(line)
  }
  return lines
}

function readLine(item: unknown): WeekPackLine | null {
  if (!item || typeof item !== 'object') return null
  const row = item as Record<string, unknown>
  if (row.kind !== 'story' && row.kind !== 'post' && row.kind !== 'reel') return null
  if (typeof row.code !== 'string' || !FAILURE_CODES.has(row.code)) return null
  if (typeof row.text !== 'string' || row.text.trim().length === 0) return null
  const stable = row.stable_id
  if (stable !== null && typeof stable !== 'string') return null
  return { kind: row.kind, stable_id: stable, code: row.code, ok: false, text: plain(row.text) }
}

function plain(text: string): string {
  const tidy = text.replace(/[{}[\]`]/g, ' ').replace(/\d{6,}/g, '…').replace(/\s+/g, ' ').trim()
  return (tidy || '这一条没有发出去。').slice(0, 180)
}

export async function recordUnpublishedOnCard(
  db: SupabaseClient,
  input: { runId: string; clientId: string; lines: readonly WeekPackLine[]; now: Date },
): Promise<'saved' | 'failed'> {
  const failures = unpublishedFailures(input.lines)
  if (failures.length === 0) return 'saved'
  const { data, error } = await db
    .from('action_runs')
    .select('evidence')
    .eq('id', input.runId)
    .eq('client_id', input.clientId)
    .eq('action_key', CONFIRMATION_ACTION_KEY)
    .eq('status', 'authorized')
    .maybeSingle()
  if (error || !data) return 'failed'
  const prev = data.evidence
  const base = prev && typeof prev === 'object' && !Array.isArray(prev) ? { ...prev as Record<string, unknown> } : {}
  base[WEEK_PACK_UNPUBLISHED_KEY] = heldEvidence(failures, input.now.toISOString())
  const written = await db
    .from('action_runs')
    .update({ evidence: base })
    .eq('id', input.runId)
    .eq('client_id', input.clientId)
    .eq('action_key', CONFIRMATION_ACTION_KEY)
    .eq('status', 'authorized')
    .select('id')
  if (written.error || !written.data || written.data.length === 0) return 'failed'
  return 'saved'
}
