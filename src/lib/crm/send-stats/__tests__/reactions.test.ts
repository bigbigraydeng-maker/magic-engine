import { describe, expect, it, vi } from 'vitest'
import { firstReactions, loadReactions, REACTION_WINDOW_DAYS, type ContactTouchRow } from '../reactions'

const NOW = new Date('2026-11-11T00:00:00.000Z')
const send = { key: 's1', contactId: 'p1', sentAt: '2026-11-10T02:00:00.000Z' }
const touch = (over: Partial<ContactTouchRow> = {}): ContactTouchRow => ({
  contact_id: 'p1',
  channel: 'email',
  direction: 'inbound',
  occurred_at: '2026-11-10T05:00:00.000Z',
  summary: 'Re: your China tour options',
  raw: 'Hi, can you send me the price for March?',
  metadata: null,
  source: 'microsoft_mail',
  ...over,
})

describe('firstReactions — what counts as the guest getting in touch', () => {
  it('a real email reply counts', () => {
    expect(firstReactions([send], [touch()], NOW).get('s1')).toEqual({ at: '2026-11-10T05:00:00.000Z', kind: 'email' })
  })

  it('🔴 a Mailchimp open / click is the guest reading a mass mail, not writing to us (378 of them in 30 days at CTS)', () => {
    expect(firstReactions([send], [touch({ source: 'mailchimp', summary: '打开了《Your China tour options》', raw: null })], NOW).size).toBe(0)
  })

  it('🔴 an auto-reply ("out of office") is not the guest writing to us', () => {
    expect(firstReactions([send], [touch({ summary: 'Automatic reply: Out of office', raw: 'I am away until Monday.' })], NOW).size).toBe(0)
  })

  it('🔴 a STOP / "please stop contacting me" is the guest leaving, not coming back', () => {
    expect(firstReactions([send], [touch({ raw: 'Please stop contacting me.' })], NOW).size).toBe(0)
  })

  it('an answered inbound call counts; a missed or a few-seconds one does not', () => {
    const call = (over: Partial<ContactTouchRow> = {}) =>
      touch({ channel: 'phone', source: 'twilio', summary: '来电', raw: null, metadata: { talk_seconds: 120 }, ...over })
    expect(firstReactions([send], [call()], NOW).get('s1')?.kind).toBe('inbound_call')
    expect(firstReactions([send], [call({ metadata: { talk_seconds: 3 } })], NOW).size).toBe(0)
    expect(firstReactions([send], [call({ metadata: { outcome: 'missed_inbound', talk_seconds: 0 } })], NOW).size).toBe(0)
  })

  it('a chat row with words counts; the real WhatsApp / Messenger rows have no text, so today they do not (known gap)', () => {
    const chat = (raw: string | null) => touch({ channel: 'whatsapp', source: 'whatsapp', summary: null, raw })
    expect(firstReactions([send], [chat('Hello, is the March tour full?')], NOW).get('s1')?.kind).toBe('message')
    expect(firstReactions([send], [chat(null)], NOW).size).toBe(0)
  })

  it('the first one AFTER the mail counts; earlier ones and another guest\'s do not', () => {
    const got = firstReactions(
      [send],
      [
        touch({ occurred_at: '2026-11-10T01:00:00.000Z' }),
        touch({ contact_id: 'p2', occurred_at: '2026-11-10T02:30:00.000Z' }),
        touch({ occurred_at: '2026-11-10T07:00:00.000Z' }),
        touch({ occurred_at: '2026-11-10T05:00:00.000Z', channel: 'phone', source: 'twilio', summary: null, raw: null, metadata: { talk_seconds: 90 } }),
      ],
      NOW,
    )
    expect(got.get('s1')).toEqual({ at: '2026-11-10T05:00:00.000Z', kind: 'inbound_call' })
  })

  it('🔴 a call long after the mail is not credited to it (window)', () => {
    const late = new Date(Date.parse(send.sentAt) + (REACTION_WINDOW_DAYS + 1) * 86_400_000).toISOString()
    expect(firstReactions([send], [touch({ occurred_at: late })], new Date(late)).size).toBe(0)
  })
})

function db(result: { data: unknown; error: { message: string } | null } | Array<{ data: unknown; error: { message: string } | null }>) {
  const calls: Record<string, unknown[]> = {}
  const pages = Array.isArray(result) ? [...result] : null
  const api: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'gte', 'order', 'range']) api[m] = (...a: unknown[]) => { calls[m] = a; return api }
  api.then = (r: (v: unknown) => unknown) => Promise.resolve(pages ? (pages.shift() ?? { data: [], error: null }) : result).then(r)
  return { client: { from: () => api } as never, calls }
}

describe('loadReactions', () => {
  it('reads only this client\'s inbound touches of the channels a guest can reach us on, since the earliest mail', async () => {
    const { client, calls } = db({ data: [touch()], error: null })
    const out = await loadReactions(client, 'c1', [send], NOW)
    expect(out?.get('s1')?.kind).toBe('email')
    expect(calls.eq).toEqual(['direction', 'inbound'])
    expect(calls.gte).toEqual(['occurred_at', '2026-11-10T02:00:00.000Z'])
    expect(calls.in?.[0]).toBe('contact_id')
  })

  it('🔴 a failed read is null (never "nobody reacted")', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { client } = db({ data: null, error: { message: 'boom' } })
    expect(await loadReactions(client, 'c1', [send], NOW)).toBeNull()
    spy.mockRestore()
  })

  it('🔴 a full page means there may be more: it reads the next page (a silent cut would show "no reply" for a guest who did reply)', async () => {
    const full = Array.from({ length: 1000 }, () => touch({ contact_id: 'someone-else' }))
    const { client, calls } = db([{ data: full, error: null }, { data: [touch()], error: null }])
    const out = await loadReactions(client, 'c1', [send], NOW)
    expect(out?.get('s1')?.kind).toBe('email')
    expect(calls.range).toEqual([1000, 1999])
    expect(calls.order).toEqual(['id', { ascending: true }])
  })

  it('🔴 too many pages → unreadable (null), never a shortened list', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const full = Array.from({ length: 1000 }, () => touch({ contact_id: 'someone-else' }))
    const { client } = db(Array.from({ length: 10 }, () => ({ data: full, error: null })))
    expect(await loadReactions(client, 'c1', [send], NOW)).toBeNull()
    spy.mockRestore()
  })

  it('no mails, no query', async () => {
    const { client, calls } = db({ data: [], error: null })
    expect((await loadReactions(client, 'c1', [], NOW))?.size).toBe(0)
    expect(calls.select).toBeUndefined()
  })
})
