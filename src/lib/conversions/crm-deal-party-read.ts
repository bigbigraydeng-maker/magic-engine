/**
 * Read a headcount from rows Magic Engine already stored. This does not
 * call the mailbox. Only the guest's own messages are read. Our outgoing
 * mail is skipped. Rows are ordered by time so a cap cannot shuffle them.
 * An AI conversation summary is the first source. Disagreeing summaries
 * are not filled in.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { choosePartySize, legalPartySize, partySizeFromFacts, partySizesInText } from './crm-deal-party'

export type PartyHintSource = 'ai_summary' | 'guest_message' | 'call'
export type PartyHint = { size: number; source: PartyHintSource }

type TouchRow = {
  summary?: unknown
  raw?: unknown
  metadata?: unknown
  direction?: unknown
  channel?: unknown
  occurred_at?: unknown
}

export async function readStoredPartySize(
  db: SupabaseClient,
  clientId: string,
  contactId: string,
): Promise<number | null> {
  const hint = await readPartyHint(db, clientId, contactId)
  return hint?.size ?? null
}

export async function readPartyHint(
  db: SupabaseClient,
  clientId: string,
  contactId: string,
): Promise<PartyHint | null> {
  const fromSummary = await briefPartySize(db, clientId, contactId)
  if (fromSummary === 'disagree') return null
  if (fromSummary != null) return { size: fromSummary, source: 'ai_summary' }
  const touches = await readTouches(db, clientId, contactId)
  const facts = await readFacts(db, clientId, analysisIds(touches))
  const previews = await readGuestEmailPreviews(db, clientId, contactId)
  const factGroups = groupsFromFacts(facts)
  const textGroups = groupsFromText([...guestTouchTexts(touches), ...previews])
  const size = choosePartySize(null, [...factGroups, ...textGroups])
  if (size == null) return null
  const fromCall = factGroups.some((group) => group.length === 1 && group[0] === size)
  return { size, source: fromCall ? 'call' : 'guest_message' }
}

async function briefPartySize(
  db: SupabaseClient,
  clientId: string,
  contactId: string,
): Promise<number | null | 'disagree'> {
  const conversationIds = await conversationIdsFor(db, clientId, contactId)
  if (conversationIds.length === 0) return null
  const rows = await many(db, 'conversation_briefs', 'trip, generated_at', (query) =>
    query.in('conversation_id', conversationIds).order('generated_at', { ascending: true }),
  )
  const sizes: number[] = []
  for (const row of rows) {
    const trip = recordOf(row.trip)
    const size = legalPartySize(trip?.party_size)
    if (size != null) sizes.push(size)
  }
  const unique = new Set(sizes)
  if (unique.size > 1) return 'disagree'
  if (unique.size === 1) return [...unique][0]
  return null
}

function guestTouchTexts(touches: TouchRow[]): string[] {
  const out: string[] = []
  for (const touch of touches) {
    if (touch.direction !== 'inbound') continue
    if (typeof touch.summary === 'string') out.push(touch.summary)
    if (typeof touch.raw === 'string') out.push(touch.raw)
  }
  return out
}

function groupsFromText(texts: string[]): number[][] {
  return texts.map((text) => partySizesInText(text.slice(0, 255)))
}

function groupsFromFacts(facts: unknown[]): number[][] {
  return facts.map((item) => {
    const size = partySizeFromFacts(item)
    return size == null ? [] : [size]
  })
}

function analysisIds(touches: TouchRow[]): string[] {
  const ids: string[] = []
  for (const touch of touches) {
    if (touch.channel !== 'phone' && touch.direction !== 'inbound') continue
    const id = recordOf(touch.metadata)?.call_analysis_id
    if (typeof id === 'string' && id !== '') ids.push(id)
  }
  return ids
}

async function readTouches(db: SupabaseClient, clientId: string, contactId: string): Promise<TouchRow[]> {
  const rows = await many(db, 'contact_touchpoints', 'summary, raw, metadata, direction, channel, occurred_at', (query) =>
    query.eq('client_id', clientId).eq('contact_id', contactId).order('occurred_at', { ascending: true }),
  )
  return rows as TouchRow[]
}

async function readFacts(db: SupabaseClient, clientId: string, ids: string[]): Promise<unknown[]> {
  if (ids.length === 0) return []
  const rows = await many(db, 'telephony_call_analyses', 'id, facts', (query) =>
    query.eq('client_id', clientId).in('id', ids),
  )
  const byId = new Map(rows.map((row) => [row.id, row.facts]))
  return ids.map((id) => byId.get(id)).filter((facts) => facts !== undefined)
}

async function readGuestEmailPreviews(db: SupabaseClient, clientId: string, contactId: string): Promise<string[]> {
  const conversations = await many(db, 'conversations', 'id, channel', (query) =>
    query.eq('client_id', clientId).eq('contact_id', contactId).order('last_message_at', { ascending: true }),
  )
  const ids = conversations
    .filter((row) => row.channel === 'email' && typeof row.id === 'string')
    .map((row) => row.id as string)
  if (ids.length === 0) return []
  const messages = await many(db, 'conversation_messages', 'body, sent_at', (query) =>
    query.in('conversation_id', ids).eq('direction', 'inbound').order('sent_at', { ascending: true }),
  )
  return messages
    .map((row) => row.body)
    .filter((body): body is string => typeof body === 'string' && body !== '')
}

async function conversationIdsFor(db: SupabaseClient, clientId: string, contactId: string): Promise<string[]> {
  const rows = await many(db, 'conversations', 'id', (query) =>
    query.eq('client_id', clientId).eq('contact_id', contactId).order('last_message_at', { ascending: true }),
  )
  return rows.map((row) => row.id).filter((id): id is string => typeof id === 'string')
}

interface Chain {
  eq(column: string, value: string): Chain
  in(column: string, values: string[]): Chain
  order(column: string, options: { ascending: boolean }): Chain
  then<T>(onfulfilled: (value: { data: unknown; error: { message: string } | null }) => T): Promise<T>
}

async function many(
  db: SupabaseClient,
  table: string,
  columns: string,
  refine: (query: Chain) => Chain,
): Promise<Array<Record<string, unknown>>> {
  const selected = (db.from(table) as unknown as { select(cols: string): Chain }).select(columns)
  const { data, error } = await refine(selected)
  if (error || !Array.isArray(data)) return []
  return data.filter(isRow)
}

function recordOf(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return null
}

function isRow(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
