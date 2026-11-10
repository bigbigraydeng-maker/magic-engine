/**
 * "Did the guest get in touch after this mail?": the first inbound email / call / chat message of the same contact
 * after the mail went out. Read-only. A failed read returns `null` (never "nobody reacted").
 * Our own system's inbound records (the one-click unsubscribe line) are not the guest writing to us and do not count.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { EMAIL_UNSUBSCRIBE_SOURCE } from '@/lib/crm/touchpoint-sources'
import type { SendStatReaction } from './types'

export const REACTION_CHANNELS = ['email', 'phone', 'whatsapp', 'messenger', 'sms'] as const
const ID_CHUNK = 100

export interface SentMail {
  /** Any key the caller wants back (the receipt id). */
  key: string
  contactId: string
  sentAt: string
}

interface TouchRead {
  contact_id: string
  channel: string
  occurred_at: string
  source: string | null
}

function isTouchRead(value: unknown): value is TouchRead {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.contact_id === 'string' && typeof v.channel === 'string' && typeof v.occurred_at === 'string'
}

/** Pure: the first qualifying touch after each mail. */
export function firstReactions(sends: readonly SentMail[], touches: readonly TouchRead[]): Map<string, SendStatReaction> {
  const byContact = new Map<string, TouchRead[]>()
  for (const t of touches) {
    if (t.source === EMAIL_UNSUBSCRIBE_SOURCE) continue
    const list = byContact.get(t.contact_id) ?? []
    list.push(t)
    byContact.set(t.contact_id, list)
  }
  const out = new Map<string, SendStatReaction>()
  for (const s of sends) {
    const sentMs = Date.parse(s.sentAt)
    let best: TouchRead | null = null
    for (const t of byContact.get(s.contactId) ?? []) {
      const at = Date.parse(t.occurred_at)
      if (at > sentMs && (best === null || at < Date.parse(best.occurred_at))) best = t
    }
    if (best !== null) out.set(s.key, { at: best.occurred_at, channel: best.channel })
  }
  return out
}

/** Reads the inbound touches of these mails' contacts since the earliest mail. `null` when a read fails. */
export async function loadReactions(
  db: SupabaseClient,
  clientId: string,
  sends: readonly SentMail[],
): Promise<Map<string, SendStatReaction> | null> {
  if (sends.length === 0) return new Map()
  const contactIds = [...new Set(sends.map((s) => s.contactId))]
  const earliest = sends.reduce((min, s) => (Date.parse(s.sentAt) < Date.parse(min) ? s.sentAt : min), sends[0]?.sentAt ?? '')
  const touches: TouchRead[] = []
  try {
    for (let i = 0; i < contactIds.length; i += ID_CHUNK) {
      const { data, error } = await db
        .from('contact_touchpoints')
        .select('contact_id, channel, occurred_at, source')
        .eq('client_id', clientId)
        .eq('direction', 'inbound')
        .in('channel', [...REACTION_CHANNELS])
        .in('contact_id', contactIds.slice(i, i + ID_CHUNK))
        .gte('occurred_at', earliest)
      if (error) throw new Error(error.message)
      for (const row of Array.isArray(data) ? data : []) if (isTouchRead(row)) touches.push(row)
    }
  } catch (err) {
    console.error('[crm/send-stats] 读客人回应失败（页面照常显示，回应那格标「读不到」）:', err instanceof Error ? err.message : err)
    return null
  }
  return firstReactions(sends, touches)
}
