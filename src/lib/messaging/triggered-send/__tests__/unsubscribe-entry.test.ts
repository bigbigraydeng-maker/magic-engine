// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { EmailUnsubscribeRecord, EmailUnsubscribeWrite } from '@/lib/crm/email-unsubscribe'
import { UNSUBSCRIBE_SECRET_ENV, signUnsubscribeToken } from '../unsubscribe-token'
import {
  CONFIRM_PAGE,
  DONE_PAGE,
  ENTRY_PAGE_HEADERS,
  INVALID_PAGE,
  UNAVAILABLE_PAGE,
  clientKeyOf,
  createRateLimiter,
  handleUnsubscribeGet,
  handleUnsubscribePost,
  type SendRowRead,
  type UnsubscribeEntryDeps,
  type UnsubscribeSendRow,
} from '../unsubscribe-entry'

const SECRET = 'test-secret-0123456789-abcdefghijklmnop'
const ENV = (name: string): string | undefined => (name === UNSUBSCRIBE_SECRET_ENV ? SECRET : undefined)
const SEND = '0b0e8a4e-5d7c-4f0e-9a43-2b1f3c4d5e6f'
const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const CONTACT = 'c0000000-0000-4000-8000-000000000002'
const ADDRESS_SHA = 'a'.repeat(64)
const NOW = new Date('2026-11-10T01:02:03.000Z')

function token(sendId = SEND, clientId = CLIENT): string {
  const signed = signUnsubscribeToken({ sendId, clientId, issuedAt: 1_789_000_000 }, ENV)
  if (!signed.ok) throw new Error('sign failed')
  return signed.token
}

const ROW: UnsubscribeSendRow = { id: SEND, clientId: CLIENT, contactId: CONTACT, dedupeScope: 'lifetime', toAddressSha256: ADDRESS_SHA }

function deps(over: { read?: SendRowRead | Error; write?: EmailUnsubscribeWrite | Error } = {}) {
  const records: EmailUnsubscribeRecord[] = []
  const logs: Array<[string, string | undefined]> = []
  const loadSend = vi.fn(async (): Promise<SendRowRead> => {
    if (over.read instanceof Error) throw over.read
    return over.read ?? { ok: true, row: ROW }
  })
  const d: UnsubscribeEntryDeps = {
    env: ENV,
    loadSend,
    record: async (input) => {
      if (over.write instanceof Error) throw over.write
      records.push(input)
      return over.write ?? { ok: true, created: true }
    },
    now: () => NOW,
    log: (code, sendId) => {
      logs.push([code, sendId])
    },
  }
  return { d, records, logs, loadSend }
}

describe('GET /api/u/<token>: shows the button, changes nothing', () => {
  it('a valid link gets the confirmation page and never touches the database', () => {
    const { d, loadSend, records } = deps()
    expect(handleUnsubscribeGet(token(), d)).toEqual({ status: 200, html: CONFIRM_PAGE })
    expect(loadSend).not.toHaveBeenCalled()
    expect(records).toEqual([])
  })

  it('the confirmation page posts back to the same address and holds no personal data', () => {
    expect(CONFIRM_PAGE).toContain('<form method="post">')
    expect(CONFIRM_PAGE).not.toContain('action=')
    expect(CONFIRM_PAGE).not.toMatch(/<script/i)
  })

  it('a bad link gets the "not valid" page (404) and the log has no token in it', () => {
    const { d, logs } = deps()
    const bad = `${token().slice(0, -1)}A`
    expect(handleUnsubscribeGet(bad, d)).toEqual({ status: 404, html: INVALID_PAGE })
    expect(JSON.stringify(logs)).not.toContain(bad.slice(0, 20))
  })

  it('without the signing secret the entry says "try again" (503), not "not valid"', () => {
    const { d } = deps()
    expect(handleUnsubscribeGet(token(), { ...d, env: () => undefined })).toEqual({ status: 503, html: UNAVAILABLE_PAGE })
  })
})

describe('POST /api/u/<token>: one click unsubscribes the address the letter went to', () => {
  it('records the unsubscribe for the contact and address of the send row, not of the request', async () => {
    const { d, records, logs, loadSend } = deps()
    expect(await handleUnsubscribePost(token(), d)).toEqual({ status: 200, html: DONE_PAGE })
    expect(loadSend).toHaveBeenCalledWith(SEND)
    expect(records).toEqual([
      { clientId: CLIENT, contactId: CONTACT, addressSha256: ADDRESS_SHA, triggeredSendId: SEND, via: 'link', occurredAt: NOW.toISOString() },
    ])
    expect(logs).toEqual([['unsubscribed', SEND]])
  })

  it('a second click is harmless and gets the same page', async () => {
    const { d, logs } = deps({ write: { ok: true, created: false } })
    expect(await handleUnsubscribePost(token(), d)).toEqual({ status: 200, html: DONE_PAGE })
    expect(logs).toEqual([['already_unsubscribed', SEND]])
  })

  it('a link whose send is missing, of another client, a rehearsal row or without an address writes nothing (404)', async () => {
    const reads: SendRowRead[] = [
      { ok: true, row: null },
      { ok: true, row: { ...ROW, clientId: 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84' } },
      { ok: true, row: { ...ROW, dedupeScope: 'shadow' } },
      { ok: true, row: { ...ROW, toAddressSha256: null } },
    ]
    for (const read of reads) {
      const { d, records } = deps({ read })
      expect(await handleUnsubscribePost(token(), d)).toEqual({ status: 404, html: INVALID_PAGE })
      expect(records).toEqual([])
    }
  })

  it('a forged or changed link reads nothing and writes nothing', async () => {
    const { d, loadSend, records } = deps()
    expect(await handleUnsubscribePost(`${token().slice(0, -1)}A`, d)).toEqual({ status: 404, html: INVALID_PAGE })
    expect(loadSend).not.toHaveBeenCalled()
    expect(records).toEqual([])
  })

  it('an unreadable send row or a failed write is "try again" (503), never "done"', async () => {
    for (const over of [{ read: { ok: false } as SendRowRead }, { read: new Error('down') }, { write: { ok: false, error: 'x' } as EmailUnsubscribeWrite }, { write: new Error('down') }]) {
      const { d } = deps(over)
      expect(await handleUnsubscribePost(token(), d)).toEqual({ status: 503, html: UNAVAILABLE_PAGE })
    }
  })

  it('without the signing secret nothing is read or written (503)', async () => {
    const { d, loadSend } = deps()
    expect(await handleUnsubscribePost(token(), { ...d, env: () => undefined })).toEqual({ status: 503, html: UNAVAILABLE_PAGE })
    expect(loadSend).not.toHaveBeenCalled()
  })
})

describe('the pages', () => {
  it('are fixed text: no name, no address, no client, no script', () => {
    for (const html of [CONFIRM_PAGE, DONE_PAGE, INVALID_PAGE, UNAVAILABLE_PAGE]) {
      expect(html).not.toContain('@')
      expect(html).not.toMatch(/<script/i)
      expect(html).toContain('<meta name="robots" content="noindex, nofollow">')
    }
  })

  it('are sent uncached, unindexed, without referrer and with a policy that only lets the form post back here', () => {
    expect(ENTRY_PAGE_HEADERS['Cache-Control']).toBe('no-store')
    expect(ENTRY_PAGE_HEADERS['Referrer-Policy']).toBe('no-referrer')
    expect(ENTRY_PAGE_HEADERS['Content-Security-Policy']).toContain("form-action 'self'")
    expect(ENTRY_PAGE_HEADERS['Content-Security-Policy']).toContain("default-src 'none'")
  })
})

describe('createRateLimiter / clientKeyOf', () => {
  it('lets `limit` requests through per window and per key, then refuses until the window passes', () => {
    let t = 0
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, maxKeys: 10, now: () => t })
    expect([limiter.allow('a'), limiter.allow('a'), limiter.allow('a')]).toEqual([true, true, false])
    expect(limiter.allow('b')).toBe(true)
    t = 1000
    expect(limiter.allow('a')).toBe(true)
  })

  it('stays bounded: past maxKeys it starts over instead of growing', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 2, now: () => 0 })
    limiter.allow('a')
    limiter.allow('b')
    expect(limiter.allow('c')).toBe(true)
    expect(limiter.allow('a')).toBe(true)
  })

  it('keys by the first forwarded address', () => {
    expect(clientKeyOf('203.0.113.7, 10.0.0.1')).toBe('203.0.113.7')
    expect(clientKeyOf(null)).toBe('unknown')
    expect(clientKeyOf('  ')).toBe('unknown')
  })
})
