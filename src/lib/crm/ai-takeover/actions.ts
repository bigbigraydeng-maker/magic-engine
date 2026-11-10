/**
 * The two staff buttons: "发送 2027 目录" (send, then mark takeover on) and "收回人工" (mark takeover off).
 * Dependency-injected; the routes only do auth, parsing and HTTP.
 *
 * Takeover-on is written ONLY after a confirmed send (ok: true). A refused send writes nothing. A send whose outcome
 * is unknown (mayHaveSent) writes nothing either: the staff member is told to check the timeline first. A replay of
 * the same click (duplicate: true) re-uses the same source_ref, so an event that already exists is not written twice.
 * Takeover-off is only ever a staff click: a system actor is refused here.
 */

import type { SendCatalogueArgs, SendCatalogueResult } from '@/lib/crm/catalogue-line/send-catalogue'
import { recordTakeover, type TakeoverStoreDeps } from './store'
import { takeoverState } from './state'

export const CATALOGUE_UNKNOWN_MESSAGE = '这封有没有发出去还不确定。请一分钟后看下面的往来记录，先别重发。'
export const CATALOGUE_HALF_MESSAGE = '目录已发出，但「AI 跟进中」没挂上。请再点一下（不会重发目录）。'

export type CatalogueActionResult =
  | { status: 200; body: { ok: true; sent: true; duplicate: boolean; versionLabel: string; since: string | null } }
  | { status: number; body: { ok: false; sent: false | 'unknown' | true; reason: string; message: string } }

export async function sendCatalogueAndTakeOver(
  args: SendCatalogueArgs,
  deps: { sendCatalogue(a: SendCatalogueArgs): Promise<SendCatalogueResult>; store: TakeoverStoreDeps },
): Promise<CatalogueActionResult> {
  // A stale page must not send again (or restart the clock) for a guest already in takeover. A same-request retry
  // after "half written" is allowed through: it is a replay, and the send layer recognises it as a duplicate.
  try {
    const events = await deps.store.loadEvents(args.clientId, args.contactId)
    const already = takeoverState(events).on
    const isReplay = events.some((e) => e.sourceRef === `catalogue:${args.requestId}`)
    if (already && !isReplay) {
      return { status: 409, body: { ok: false, sent: false, reason: 'already_in_takeover', message: '这位客人已经在「AI 跟进中」了，请刷新页面看最新状态。' } }
    }
  } catch {
    return { status: 503, body: { ok: false, sent: false, reason: 'unreadable', message: '暂时读不到这位客人的跟进状态，信没发，请稍后再试。' } }
  }
  const sent = await deps.sendCatalogue(args)
  if (!sent.ok) {
    if (sent.mayHaveSent) {
      return { status: 409, body: { ok: false, sent: 'unknown', reason: 'send_unknown', message: CATALOGUE_UNKNOWN_MESSAGE } }
    }
    return { status: sent.status, body: { ok: false, sent: false, reason: sent.reason, message: sent.message } }
  }
  const written = await recordTakeover(
    {
      clientId: args.clientId,
      contactId: args.contactId,
      kind: 'ai_takeover_on',
      actor: args.actorEmail,
      reason: `发送目录 ${sent.versionLabel}`,
      catalogVersion: sent.versionLabel,
      sourceRef: `catalogue:${args.requestId}`,
    },
    deps.store,
  )
  if (!written.ok) {
    return { status: 500, body: { ok: false, sent: true, reason: written.reason, message: CATALOGUE_HALF_MESSAGE } }
  }
  return {
    status: 200,
    body: { ok: true, sent: true, duplicate: sent.duplicate, versionLabel: sent.versionLabel, since: written.since },
  }
}

export interface TakeoverOffArgs {
  clientId: string
  contactId: string
  /** The signed-in staff member, from the access check only. */
  actorEmail: string
  clientRef: string
}

export type TakeoverOffResult =
  | { status: 200; body: { ok: true; alreadyOff: boolean } }
  | { status: number; body: { ok: false; reason: string; message: string } }

export async function takeOverManually(args: TakeoverOffArgs, store: TakeoverStoreDeps): Promise<TakeoverOffResult> {
  if (args.actorEmail.trim() === '' || args.actorEmail.startsWith('system:')) {
    return { status: 403, body: { ok: false, reason: 'staff_only', message: '只有员工本人能点「收回人工」。' } }
  }
  let on: boolean
  try {
    on = takeoverState(await store.loadEvents(args.clientId, args.contactId)).on
  } catch {
    return { status: 503, body: { ok: false, reason: 'unreadable', message: '暂时读不到这位客人的跟进状态，请稍后再试。' } }
  }
  if (!on) {
    // Already off in the log (e.g. a retry after "half written"): only bring the mirror in line, no new event.
    try {
      await store.setMirror(args.clientId, args.contactId, null)
    } catch {
      return { status: 500, body: { ok: false, reason: 'half_written', message: '只改了一半，再点一下。' } }
    }
    return { status: 200, body: { ok: true, alreadyOff: true } }
  }
  const written = await recordTakeover(
    {
      clientId: args.clientId,
      contactId: args.contactId,
      kind: 'ai_takeover_off',
      actor: args.actorEmail,
      reason: '员工收回人工',
      catalogVersion: null,
      sourceRef: `off:${args.clientRef}`,
    },
    store,
  )
  if (!written.ok) return { status: 500, body: { ok: false, reason: written.reason, message: written.message } }
  if (written.since !== null) {
    // A replayed idempotency key inserted nothing and the log still says "on": do not report success.
    return { status: 409, body: { ok: false, reason: 'not_taken_back', message: '没收回上，请刷新页面再点一下。' } }
  }
  return { status: 200, body: { ok: true, alreadyOff: false } }
}
