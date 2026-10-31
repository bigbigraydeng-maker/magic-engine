/**
 * Read a headcount from rows Magic Engine already stored. This does not
 * call the mailbox. Mail sync keeps a 255 character preview; the sentence
 * that names the party often sits after that preview, so a miss here means
 * staff still have to type the number.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { choosePartySize, partySizeFromFacts, partySizesInText } from './crm-deal-party'

type TouchRow = { summary?: unknown; raw?: unknown; metadata?: unknown }

export async function readStoredPartySize(
  db: SupabaseClient,
  clientId: string,
  contactId: string,
): Promise<number | null> {
  const touches = await readTouches(db, clientId, contactId)
  const facts = await readFacts(db, clientId, analysisIds(touches))
  const previews = await readEmailPreviews(db, clientId, contactId)
  const groups = [...textGroups(touchTexts(touches)), ...factGroups(facts), ...textGroups(previews)]
  return choosePartySize(null, groups)
}

function touchTexts(touches: TouchRow[]): string[] {
  const out: string[] = []
  for (const touch of touches) {
    if (typeof touch.summary === 'string') out.push(touch.summary)
    if (typeof touch.raw === 'string') out.push(touch.raw)
  }
  return out
}

function textGroups(texts: string[]): number[][] {
  return texts.map((text) => partySizesInText(text.slice(0, 255)))
}

function factGroups(facts: unknown[]): number[][] {
  return facts.map((item) => {
    const n = partySizeFromFacts(item)
    return n == null ? [] : [n]
  })
}

function analysisIds(touches: TouchRow[]): string[] {
  const ids: string[] = []
  for (const touch of touches) {
    const meta = recordOf(touch.metadata)
    const id = meta?.call_analysis_id
    if (typeof id === 'string' && id !== '') ids.push(id)
  }
  return ids
}

async function readTouches(db: SupabaseClient, clientId: string, contactId: string): Promise<TouchRow[]> {
  const { data, error } = await db
    .from('contact_touchpoints')
    .select('summary, raw, metadata')
    .eq('client_id', clientId)
    .eq('contact_id', contactId)
    .limit(40)
  if (error || !Array.isArray(data)) return []
  return data as TouchRow[]
}

async function readFacts(db: SupabaseClient, clientId: string, ids: string[]): Promise<unknown[]> {
  if (ids.length === 0) return []
  const { data, error } = await db
    .from('telephony_call_analyses')
    .select('facts')
    .eq('client_id', clientId)
    .in('id', ids)
    .limit(20)
  if (error || !Array.isArray(data)) return []
  return data.map((row) => (row as { facts?: unknown }).facts)
}

async function readEmailPreviews(db: SupabaseClient, clientId: string, contactId: string): Promise<string[]> {
  const { data, error } = await db
    .from('conversations')
    .select('id, channel')
    .eq('client_id', clientId)
    .eq('contact_id', contactId)
    .limit(20)
  if (error || !Array.isArray(data)) return []
  const ids = data
    .filter((row) => (row as { channel?: unknown }).channel === 'email')
    .map((row) => (row as { id?: unknown }).id)
    .filter((id): id is string => typeof id === 'string')
  if (ids.length === 0) return []
  const { data: msgs, error: msgError } = await db
    .from('conversation_messages')
    .select('body')
    .in('conversation_id', ids)
    .limit(20)
  if (msgError || !Array.isArray(msgs)) return []
  return msgs
    .map((row) => (row as { body?: unknown }).body)
    .filter((body): body is string => typeof body === 'string' && body !== '')
}

function recordOf(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return null
}
