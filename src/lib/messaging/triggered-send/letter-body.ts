/**
 * The body of a named letter as it goes out (design 2026-11-17 §4.3, §7.4 W11): after the claim and the timeline
 * record, before the request is built.
 *
 *   first attempt → token the tracked links (`request_id` = the ledger row id) → write onto the row, BEFORE sending, what
 *   went out: tagged or not, the tokens, and the fingerprint of the final text → send that text.
 *   replay        → the row already says what went out: rebuild exactly that text from the same tokens (nothing is
 *   stored again) and check it against the fingerprint. Different = never sent again (`content_changed`): the
 *   provider's idempotency key must always carry one and the same payload.
 *
 * Tracking failing is not a reason to hold a letter: the original text goes out and the row says so (`warning`).
 * The row write failing IS: without it a replay could not rebuild the text, so nothing is sent and the row stays
 * pending (the next call takes it over). No address, no body, no name is written: only counts, tokens and a hash.
 */

import { createHash } from 'node:crypto'
import { onPending, result, type FinalText, type SendCtx } from './send-core'
import type { RenderedLetter } from './send-letter'
import type { LetterLedger, LetterRow, LifetimeRow, NamedLetterDeps } from './send-types'

export const LINK_TRACKING_ANNOTATION = 'link_tracking'
export const REQUEST_REF_ANNOTATION = 'request_ref'

const TOKEN_RE = /^[A-Za-z0-9]{12}$/
const SHA256_RE = /^[0-9a-f]{64}$/
/** A letter has a handful of links; more tokens than this on a row is not something this code wrote. */
const MAX_TOKENS = 50

export interface StoredTracking {
  tagged: number
  tokens: string[]
  final_text_sha256: string
  warning: string | null
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** What an earlier attempt wrote on the row; null when nothing (or nothing readable) is there. */
export function storedTracking(annotations: Record<string, unknown>): StoredTracking | null {
  const raw = annotations[LINK_TRACKING_ANNOTATION]
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const t = raw as Record<string, unknown>
  if (typeof t.tagged !== 'number' || !Number.isInteger(t.tagged) || t.tagged < 0) return null
  if (!Array.isArray(t.tokens) || t.tokens.length > MAX_TOKENS || !t.tokens.every((x) => typeof x === 'string' && TOKEN_RE.test(x))) return null
  if (typeof t.final_text_sha256 !== 'string' || !SHA256_RE.test(t.final_text_sha256)) return null
  if (t.tagged !== t.tokens.length) return null
  const warning = typeof t.warning === 'string' ? t.warning : null
  return { tagged: t.tagged, tokens: t.tokens as string[], final_text_sha256: t.final_text_sha256, warning }
}

export interface LetterBodyArgs {
  deps: NamedLetterDeps
  ledger: LetterLedger
  requestRef: string
}

/** `SendFlow.finalText` of a named letter. */
export async function letterFinalText(a: LetterBodyArgs, c: SendCtx, row: LifetimeRow, letter: RenderedLetter): Promise<FinalText> {
  const rows = await a.deps.letterRows(c.flow.clientId, c.contact.contactId)
  const current = rows.ok ? rows.rows.find((r) => r.id === row.id) ?? null : null
  if (current === null) return { ok: false, result: result('read_failed', 'ledger_unreadable', row.id) }
  const stored = storedTracking(current.annotations)
  if (stored !== null) return replayText(a, c, row, letter, stored)
  // Something is written there but it cannot be read: what went out before cannot be rebuilt, so nothing goes again.
  if (Object.prototype.hasOwnProperty.call(current.annotations, LINK_TRACKING_ANNOTATION)) return { ok: false, result: result('in_flight', 'content_changed', row.id) }
  return firstText(a, c, current, letter)
}

async function replayText(a: LetterBodyArgs, c: SendCtx, row: LifetimeRow, letter: RenderedLetter, stored: StoredTracking): Promise<FinalText> {
  let text = letter.text
  if (stored.tagged > 0) {
    const rebuilt = await a.deps.linkTracking.retag({ clientId: c.flow.clientId, body: letter.text, tokens: stored.tokens })
    if (!rebuilt.ok) return { ok: false, result: result('in_flight', 'content_changed', row.id) }
    text = rebuilt.body
  }
  if (sha256(text) !== stored.final_text_sha256) return { ok: false, result: result('in_flight', 'content_changed', row.id) }
  return { ok: true, text }
}

async function firstText(a: LetterBodyArgs, c: SendCtx, current: LetterRow, letter: RenderedLetter): Promise<FinalText> {
  const tagged = await a.deps.linkTracking.tag({ clientId: c.flow.clientId, contactId: c.contact.contactId, requestId: current.id, body: letter.text })
  const tracking: StoredTracking = {
    tagged: tagged.tagged,
    tokens: tagged.tagged > 0 ? [...tagged.tokens] : [],
    final_text_sha256: sha256(tagged.body),
    warning: tagged.warning,
  }
  const annotations = { ...current.annotations, [REQUEST_REF_ANNOTATION]: a.requestRef, [LINK_TRACKING_ANNOTATION]: tracking }
  const written = await onPending(c, current, (r) => a.ledger.annotate(r, annotations))
  if (written.kind !== 'written') return { ok: false, result: result('write_failed', 'annotations_failed', current.id) }
  return { ok: true, text: tagged.body }
}
