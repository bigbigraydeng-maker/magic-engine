/**
 * Writing the AI takeover mark. Dependency-injected; the real Supabase deps are in prod.ts.
 *
 * Write order (same as the do-not-contact correction route, contacts/[cid]/dnc/route.ts):
 *   1. append the event (idempotent on source_ref: a double click or a retry records one event);
 *   2. re-read the guest's event log and set contacts.ai_takeover_since from it (latest event wins);
 *   3. if step 2 fails, say so plainly: "half written, click again". The retry re-uses the same source_ref, so it
 *      adds no second event and only repairs the mirror.
 * The mirror is computed from the whole log, never from the event just written: a late retry of an old "on" cannot
 * undo a later "收回人工".
 */

import { mirrorValue, type TakeoverEvent, type TakeoverKind } from './state'

export interface NewTakeoverEvent {
  clientId: string
  contactId: string
  kind: TakeoverKind
  actor: string
  reason: string | null
  catalogVersion: string | null
  sourceRef: string
}

export interface TakeoverStoreDeps {
  /** Insert unless (client_id, source_ref) exists. Throws on a write error. */
  insertEvent(e: NewTakeoverEvent): Promise<{ inserted: boolean }>
  /** The guest's whole takeover log. Throws on a read error. */
  loadEvents(clientId: string, contactId: string): Promise<TakeoverEvent[]>
  /** Throws on a write error. */
  setMirror(clientId: string, contactId: string, since: string | null): Promise<void>
}

export type RecordTakeoverResult =
  | { ok: true; inserted: boolean; since: string | null }
  | { ok: false; reason: 'event_failed' | 'half_written'; message: string }

export const STORE_MESSAGES = {
  event_failed: '没记上，请再点一下。',
  half_written: '只改了一半，再点一下。',
} as const

export async function recordTakeover(e: NewTakeoverEvent, deps: TakeoverStoreDeps): Promise<RecordTakeoverResult> {
  let inserted: boolean
  try {
    inserted = (await deps.insertEvent(e)).inserted
  } catch (err) {
    console.error('[ai-takeover] 写记录失败:', err instanceof Error ? err.message : err)
    return { ok: false, reason: 'event_failed', message: STORE_MESSAGES.event_failed }
  }
  try {
    const since = mirrorValue(await deps.loadEvents(e.clientId, e.contactId))
    await deps.setMirror(e.clientId, e.contactId, since)
    return { ok: true, inserted, since }
  } catch (err) {
    console.warn('[ai-takeover] 记录已写，contacts 镜像列没更新上:', err instanceof Error ? err.message : err)
    return { ok: false, reason: 'half_written', message: STORE_MESSAGES.half_written }
  }
}
