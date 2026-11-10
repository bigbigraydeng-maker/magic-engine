/**
 * The welcome letter as it is really sent: render the template (127's renderer, only `first_name`), fingerprint what was
 * rendered, and build the provider request with its unsubscribe link, headers and tag. Pure: no I/O, no clock.
 *
 * 🔴 **What the fingerprint covers**: the subject and the rendered body, NOT the unsubscribe link. The link carries the
 *    letter's own ledger id and its first-attempt time, which exist only after the claim; the claim needs the fingerprint
 *    first. Both are frozen in the ledger, so a replay of the same row builds the very same link and the very same
 *    request (the provider's idempotency key must always carry one and the same payload, design P2 §6.1).
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §5.2 H, §6.1–6.3, §16.10 (contracts for the third order).
 */

import { createHash } from 'node:crypto'
import { renderTemplate, type RenderContext } from '@/lib/crm/email-templates/render'
import type { EmailTemplateVersion } from '@/lib/crm/email-templates/types'
import type { ResendEmailRequest } from '@/lib/messaging/adapters/resend-email'
import { SEND_ID_TAG } from './receipt-consumer'
import type { SendableRule } from './rule'
import { signUnsubscribeToken, type EnvReader } from './unsubscribe-token'

export interface RenderedLetter {
  subject: string
  /** The rendered body, without the unsubscribe line. */
  text: string
  /** sha256 of the subject and the rendered body (see the header). */
  renderedSha256: string
}

export type RenderOutcome =
  | { ok: true; letter: RenderedLetter }
  /** `missing_first_name`: the template greets by first name and this guest has none usable (final for this letter). */
  | { ok: false; reason: 'missing_first_name' | 'render_failed'; detail: string }

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** Render the welcome letter for one guest. Nothing but `first_name` can resolve: there are no facts, inputs or catalogue. */
export function renderWelcomeLetter(template: Pick<EmailTemplateVersion, 'subject' | 'body' | 'pickMode'>, contactName: string | null, today: string): RenderOutcome {
  const ctx: RenderContext = { contactName, senderDisplayName: null, callWhen: null, inputs: {}, facts: null, provider: null, catalogue: null, today }
  const rendered = renderTemplate(template, ctx)
  if (rendered.missing.length > 0) {
    const onlyName = rendered.missing.every((m) => m === 'first_name')
    return { ok: false, reason: onlyName ? 'missing_first_name' : 'render_failed', detail: `missing: ${rendered.missing.join(',')}` }
  }
  if (rendered.problems.length > 0) return { ok: false, reason: 'render_failed', detail: rendered.problems.join(',') }
  const renderedSha256 = sha256(JSON.stringify({ subject: rendered.subject, text: rendered.body }))
  return { ok: true, letter: { subject: rendered.subject, text: rendered.body, renderedSha256 } }
}

/** ME's own public origin (the unsubscribe entry lives there): https, nothing after the host. null = not usable. */
export function publicOriginOf(env: EnvReader): string | null {
  const raw = (env('APP_URL') ?? env('NEXT_PUBLIC_APP_URL') ?? '').trim()
  if (raw === '') return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return null
    if (url.pathname !== '/' && url.pathname !== '') return null
    return url.origin
  } catch {
    return null
  }
}

export interface LetterAddressing {
  account: string
  rule: SendableRule
  clientId: string
  to: string
  idempotencyKey: string
  /** triggered_sends.id of this letter. */
  sendId: string
  /** The letter's first attempt (triggered_sends.first_attempt_at): frozen, so a replay carries the same link. */
  firstAttemptAt: string
  attempt: 'first' | 'replay'
}

export type RequestBuild = { ok: true; request: ResendEmailRequest } | { ok: false; code: 'no_unsubscribe_secret' | 'no_app_url' | 'invalid_payload' }

/** The visible unsubscribe line at the end of the body (the header alone is not enough for every mail client, §6.1). */
export function unsubscribeLine(url: string): string {
  return `\n\n—\nTo stop these emails, open this link: ${url}`
}

/** The full provider request of one letter. Deterministic in its inputs (so a replay is byte-for-byte the same). */
export function buildLetterRequest(letter: RenderedLetter, a: LetterAddressing, env: EnvReader): RequestBuild {
  const origin = publicOriginOf(env)
  if (origin === null) return { ok: false, code: 'no_app_url' }
  const issuedAt = Math.floor(Date.parse(a.firstAttemptAt) / 1000)
  if (!Number.isFinite(issuedAt)) return { ok: false, code: 'invalid_payload' }
  const signed = signUnsubscribeToken({ sendId: a.sendId, clientId: a.clientId, issuedAt }, env)
  if (!signed.ok) return { ok: false, code: signed.code === 'no_secret' ? 'no_unsubscribe_secret' : 'invalid_payload' }
  const url = `${origin}/api/u/${signed.token}`
  return {
    ok: true,
    request: {
      account: a.account,
      from: a.rule.send.identity.from,
      to: a.to,
      replyTo: a.rule.send.identity.reply_to,
      subject: letter.subject,
      text: `${letter.text}${unsubscribeLine(url)}`,
      headers: { 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      idempotencyKey: a.idempotencyKey,
      tags: [{ name: SEND_ID_TAG, value: a.sendId }],
      attempt: a.attempt,
    },
  }
}

/** A placeholder ledger id for checking the request BEFORE the claim (§16.8 ①): same length and shape as a real one. */
export const PRECHECK_SEND_ID = '00000000-0000-4000-8000-000000000000'
