/**
 * The one-click unsubscribe entry behind every automated ME e-mail: /api/u/<token>.
 *
 *  - GET only shows a confirmation page and changes nothing: mail scanners open links before people do.
 *  - POST unsubscribes, without a login, idempotently. Mail apps send it themselves for the List-Unsubscribe-Post
 *    one-click header (RFC 8058); the confirmation page's button sends the same POST.
 *  - The token names a send (unsubscribe-token.ts). The contact and the address fingerprint come from that send's
 *    ledger row, never from the request, so a link can only ever unsubscribe the address its letter went to.
 *  - The pages show no name, no address and no client: whoever opens a forwarded link learns nothing about anyone.
 *  - Logs carry codes and the send id only, never the token.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §6.3 (implementation: §16.10).
 */

import type { EmailUnsubscribeRecord, EmailUnsubscribeWrite } from '@/lib/crm/email-unsubscribe'
import { verifyUnsubscribeToken, type EnvReader } from './unsubscribe-token'

/** The columns of the send ledger row that an unsubscribe needs. */
export interface UnsubscribeSendRow {
  id: string
  clientId: string
  contactId: string
  dedupeScope: string
  toAddressSha256: string | null
}

export type SendRowRead = { ok: true; row: UnsubscribeSendRow | null } | { ok: false }

export interface UnsubscribeEntryDeps {
  env: EnvReader
  loadSend(sendId: string): Promise<SendRowRead>
  record(input: EmailUnsubscribeRecord): Promise<EmailUnsubscribeWrite>
  now(): Date
  log(code: string, sendId?: string): void
}

export interface EntryPage {
  status: number
  html: string
}

/** Sent with every page: nothing cached, nothing indexed, no referrer, no scripts, the form may only post back here. */
export const ENTRY_PAGE_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
}

const STYLE = `
  :root { color-scheme: light; }
  body { margin: 0; background: #f6f5f2; color: #1f2328; font: 17px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  main { max-width: 32rem; margin: 12vh auto 0; padding: 0 20px; }
  h1 { font-size: 1.5rem; line-height: 1.3; margin: 0 0 0.75rem; }
  p { margin: 0 0 1rem; }
  .note { color: #57606a; font-size: 0.95rem; }
  button { font: inherit; font-weight: 600; color: #fff; background: #1f6f4a; border: 0; border-radius: 8px; padding: 0.8rem 1.6rem; min-height: 48px; cursor: pointer; }
  button:focus-visible { outline: 3px solid #f2b705; outline-offset: 2px; }
`

function page(title: string, body: string): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex, nofollow">',
    `<title>${title}</title>`,
    `<style>${STYLE}</style>`,
    '</head>',
    `<body><main>${body}</main></body>`,
    '</html>',
  ].join('\n')
}

// Every page is a fixed string: nothing from the request or the database is ever placed into the HTML.
export const CONFIRM_PAGE = page(
  'Unsubscribe',
  [
    '<h1>Stop these emails?</h1>',
    '<p>Press the button and we will stop sending you emails.</p>',
    '<p class="note">If you write to us later, we can still reply to you. Phone calls are not affected.</p>',
    '<form method="post"><input type="hidden" name="List-Unsubscribe" value="One-Click"><button type="submit">Unsubscribe</button></form>',
  ].join('\n'),
)

export const DONE_PAGE = page(
  'Unsubscribed',
  [
    '<h1>You are unsubscribed</h1>',
    '<p>We will not send you any more emails.</p>',
    '<p class="note">If you write to us later, we can still reply to you. You can close this page.</p>',
  ].join('\n'),
)

export const INVALID_PAGE = page(
  'Link not valid',
  [
    '<h1>This link is not valid</h1>',
    '<p>If you copied it from one of our emails, please check that you copied the whole link.</p>',
  ].join('\n'),
)

export const UNAVAILABLE_PAGE = page(
  'Please try again',
  ['<h1>Sorry, that did not work</h1>', '<p>Please try again in a few minutes.</p>'].join('\n'),
)

export const BUSY_PAGE = page(
  'Please try again',
  ['<h1>Too many requests</h1>', '<p>Please wait a minute and try again.</p>'].join('\n'),
)

export const TOO_LARGE_PAGE = page('Not accepted', ['<h1>Not accepted</h1>', '<p>The request was too large.</p>'].join('\n'))

/** GET: only checks the link and shows the button. Never reads or writes the database. */
export function handleUnsubscribeGet(token: string, deps: Pick<UnsubscribeEntryDeps, 'env' | 'log'>): EntryPage {
  const verified = verifyUnsubscribeToken(token, deps.env)
  if (verified.ok) return { status: 200, html: CONFIRM_PAGE }
  if (verified.code === 'no_secret') {
    deps.log('no_secret')
    return { status: 503, html: UNAVAILABLE_PAGE }
  }
  deps.log(`get_${verified.code}`)
  return { status: 404, html: INVALID_PAGE }
}

/** POST: unsubscribe the address the letter of this link went to. Repeats are harmless. */
export async function handleUnsubscribePost(token: string, deps: UnsubscribeEntryDeps): Promise<EntryPage> {
  const verified = verifyUnsubscribeToken(token, deps.env)
  if (!verified.ok) {
    if (verified.code === 'no_secret') {
      deps.log('no_secret')
      return { status: 503, html: UNAVAILABLE_PAGE }
    }
    deps.log(`post_${verified.code}`)
    return { status: 404, html: INVALID_PAGE }
  }
  const { sendId, clientId } = verified.payload
  const read = await deps.loadSend(sendId).catch((): SendRowRead => ({ ok: false }))
  if (!read.ok) {
    deps.log('send_unreadable', sendId)
    return { status: 503, html: UNAVAILABLE_PAGE }
  }
  const row = read.row
  // A real letter is a live ledger row of the same client that has an address: anything else is not a link we sent.
  if (row === null || row.clientId !== clientId || row.dedupeScope !== 'lifetime' || row.toAddressSha256 === null) {
    deps.log('send_not_found', sendId)
    return { status: 404, html: INVALID_PAGE }
  }
  const written = await deps
    .record({
      clientId: row.clientId,
      contactId: row.contactId,
      addressSha256: row.toAddressSha256,
      triggeredSendId: row.id,
      via: 'link',
      occurredAt: deps.now().toISOString(),
    })
    .catch((): EmailUnsubscribeWrite => ({ ok: false, error: 'exception' }))
  if (!written.ok) {
    deps.log('record_failed', sendId)
    return { status: 503, html: UNAVAILABLE_PAGE }
  }
  deps.log(written.created ? 'unsubscribed' : 'already_unsubscribed', sendId)
  return { status: 200, html: DONE_PAGE }
}

/**
 * A small per-address limiter for this public entry (per server process). A valid link costs one ledger read and one
 * idempotent write; a forged one costs one HMAC. The limit is generous because mail providers send their one-click
 * POSTs from shared addresses.
 */
export function createRateLimiter(opts: { limit: number; windowMs: number; maxKeys: number; now?: () => number }) {
  const hits = new Map<string, { windowStart: number; count: number }>()
  const now = opts.now ?? (() => Date.now())
  return {
    allow(key: string): boolean {
      const t = now()
      const entry = hits.get(key)
      if (entry === undefined || t - entry.windowStart >= opts.windowMs) {
        if (entry === undefined && hits.size >= opts.maxKeys) hits.clear()
        hits.set(key, { windowStart: t, count: 1 })
        return true
      }
      entry.count += 1
      return entry.count <= opts.limit
    },
  }
}

/** The first address of X-Forwarded-For (set by the hosting proxy), or 'unknown'. Only used as a limiter key. */
export function clientKeyOf(forwardedFor: string | null): string {
  const first = (forwardedFor ?? '').split(',')[0]?.trim() ?? ''
  return first === '' ? 'unknown' : first.slice(0, 64)
}
