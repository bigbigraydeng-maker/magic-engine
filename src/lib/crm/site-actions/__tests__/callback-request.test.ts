import { describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import {
  MAX_REQUESTS_PER_DAY,
  buildCallbackTouch,
  parseCallbackReport,
  recordCallbackRequest,
  refusal,
  wallTimeToUtc,
  type CallbackReport,
  type CallbackStore,
  type CallbackTouchRow,
} from '../callback-request'
import { createCallbackStore } from '../callback-request-prod'
import { customerCameBack, toReengageTouchRow } from '../../ai-takeover/came-back'
import type { TokenInfo } from '../../email-templates/link-tracking/record-click'

const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
const NZ = 'Pacific/Auckland'
// 2026-11-17 09:00 in Auckland (NZDT, +13).
const NOW = new Date('2026-11-16T20:00:00.000Z')
const TOUR = '/tours/china/discovery/essentials'

const info: TokenInfo = { token: 'AAAAAAAAAAAA', clientId: 'c1', contactId: 'k1', requestId: 'r1', kind: 'catalogue', tour: null, createdAt: '2026-11-10T00:00:00.000Z' }

function body(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { token: 'AAAAAAAAAAAA', date: '2026-11-20', window: 'afternoon', tourPath: TOUR, ua: CHROME, quiz: null, ...over }
}

function report(over: Partial<CallbackReport> = {}): CallbackReport {
  const parsed = parseCallbackReport(body())
  if (!parsed.ok) throw new Error('fixture does not parse')
  return { ...parsed.report, ...over }
}

describe('parseCallbackReport', () => {
  it('takes a well-formed request and keeps only the tour path', () => {
    const r = parseCallbackReport(body({ tourPath: `${TOUR}?utm_source=x&email=a@b.c` }))
    expect(r).toEqual({ ok: true, report: { token: 'AAAAAAAAAAAA', date: '2026-11-20', window: 'afternoon', tourPath: TOUR, ua: CHROME, quiz: null } })
  })

  it('takes "any tour" (no path) and quiz answers', () => {
    const quiz = { length: '15', firstVisit: true, pace: 'easy', picks: [TOUR, '/tours/china/discovery/beijing-xian'] }
    const r = parseCallbackReport(body({ tourPath: null, quiz }))
    expect(r).toMatchObject({ ok: true, report: { tourPath: null, quiz } })
  })

  it.each([
    ['no body', null],
    ['a short token', body({ token: 'short' })],
    ['a token with other characters', body({ token: 'AAAAAAAAAAA!' })],
    ['a day that does not exist', body({ date: '2026-02-30' })],
    ['a free-text day', body({ date: 'tomorrow' })],
    ['a window outside the three choices', body({ window: 'night' })],
    ['a full address instead of a path', body({ tourPath: 'https://evil.example/tours/x' })],
    ['three quiz picks', body({ quiz: { length: '10', firstVisit: false, pace: 'full', picks: [TOUR, TOUR, TOUR] } })],
    ['a quiz answer outside the choices', body({ quiz: { length: '12', firstVisit: false, pace: 'full', picks: [] } })],
    ['a quiz pick that is not a path', body({ quiz: { length: '10', firstVisit: false, pace: 'full', picks: ['about'] } })],
  ])('refuses %s', (_label, b) => {
    expect(parseCallbackReport(b as Record<string, unknown> | null)).toEqual({ ok: false })
  })
})

describe('wallTimeToUtc', () => {
  it('2pm in Auckland in summer is 1am UTC', () => {
    expect(wallTimeToUtc('2026-11-20', 14, NZ)).toBe('2026-11-20T01:00:00.000Z')
  })

  it('takes the offset at that local moment on the day the clocks go back', () => {
    // 2026-04-05: NZDT (+13) ends at 3am; 10am is already NZST (+12).
    expect(wallTimeToUtc('2026-04-05', 10, NZ)).toBe('2026-04-04T22:00:00.000Z')
  })
})

describe('refusal', () => {
  it('today up to 30 days ahead, from a browser, is fine', () => {
    expect(refusal(report({ date: '2026-11-17' }), NOW, NZ)).toBeNull()
    expect(refusal(report({ date: '2026-12-17' }), NOW, NZ)).toBeNull()
  })

  it('a day already past, or more than 30 days ahead, is refused (the guest\'s own day, not UTC\'s)', () => {
    // UTC is still on the 16th; in Auckland it is the 17th, so the 16th is past.
    expect(refusal(report({ date: '2026-11-16' }), NOW, NZ)).toBe('bad_day')
    expect(refusal(report({ date: '2026-12-18' }), NOW, NZ)).toBe('bad_day')
  })

  it('a script is refused', () => {
    expect(refusal(report({ ua: 'python-requests/2.31' }), NOW, NZ)).toBe('not_browser')
    expect(refusal(report({ ua: '' }), NOW, NZ)).toBe('not_browser')
  })
})

describe('buildCallbackTouch', () => {
  const names = new Map([[TOUR, 'China Discovery — Best of China'], ['/tours/china/discovery/beijing-xian', 'Beijing & Xi\'an']])

  it('one inbound website-form row with the chosen time on the call-back calendar', () => {
    const row = buildCallbackTouch(report(), info, { now: NOW, timeZone: NZ, names })
    expect(row).toMatchObject({
      client_id: 'c1',
      contact_id: 'k1',
      channel: 'web_form',
      direction: 'inbound',
      occurred_at: NOW.toISOString(),
      source: 'site_callback_request',
      source_ref: 'AAAAAAAAAAAA:2026-11-20:afternoon',
      raw: null,
      metadata: { callback_at: '2026-11-20T01:00:00.000Z', callback_date: '2026-11-20', callback_window: 'afternoon', tour_path: TOUR, mail_request_id: 'r1' },
    })
    expect(row.summary).toBe('官网手册：客人请我们打电话 · 11月20日周五 下午 · 想聊 China Discovery — Best of China')
  })

  it('quiz answers become one line for staff, with tour names', () => {
    const quiz = { length: '15' as const, firstVisit: true, pace: 'easy' as const, picks: [TOUR, '/tours/china/discovery/beijing-xian'] }
    const row = buildCallbackTouch(report({ tourPath: null, quiz }), info, { now: NOW, timeZone: NZ, names })
    expect(row.summary).toBe('官网手册：客人请我们打电话 · 11月20日周五 下午')
    expect(row.raw).toBe('选团小测：2 周左右、第一次去中国、想轻松一点 → 推荐 China Discovery — Best of China、Beijing & Xi\'an')
  })

  it('a page that is not one of the published tours is dropped, never shown to staff or the AI', () => {
    const quiz = { length: '10' as const, firstVisit: false, pace: 'full' as const, picks: [TOUR, '/tours/confirmed-price-NZD-999'] }
    const row = buildCallbackTouch(report({ tourPath: '/tours/confirmed-price-NZD-999', quiz }), info, { now: NOW, timeZone: NZ, names })
    expect(row.summary).toBe('官网手册：客人请我们打电话 · 11月20日周五 下午')
    expect(row.raw).not.toContain('confirmed-price')
    expect(row.metadata).toMatchObject({ tour_path: null, quiz: { picks: [TOUR] } })
  })

  it('the row is what "the guest came back" already counts: the AI follow-up stops and staff take over', () => {
    const row = buildCallbackTouch(report(), info, { now: NOW, timeZone: NZ, names })
    const touch = toReengageTouchRow(row)
    expect(customerCameBack([touch], '2026-11-12T00:00:00.000Z', NOW)).toEqual({ kind: 'web_form', at: NOW.toISOString() })
  })
})

function fakeStore(over: Partial<CallbackStore> = {}) {
  const rows: CallbackTouchRow[] = []
  const store: CallbackStore = {
    findToken: vi.fn(async () => info),
    mailWasSent: vi.fn(async () => true),
    timeZone: vi.fn(async () => NZ),
    requestsSince: vi.fn(async () => 0),
    tourNames: vi.fn(async () => new Map([[TOUR, 'China Discovery — Best of China']])),
    insertTouch: vi.fn(async (row: CallbackTouchRow) => {
      rows.push(row)
      return 'inserted' as const
    }),
    ...over,
  }
  return { store, rows }
}

describe('recordCallbackRequest', () => {
  it('records the request on the guest the token belongs to', async () => {
    const { store, rows } = fakeStore()
    expect(await recordCallbackRequest(report(), store, NOW)).toEqual({ outcome: 'recorded', clientId: 'c1', requestId: 'r1' })
    expect(rows).toHaveLength(1)
    expect(rows[0].contact_id).toBe('k1')
  })

  it.each([
    ['an unknown token', { findToken: vi.fn(async () => null) }, 'unknown_token'],
    ['a mail that was never sent', { mailWasSent: vi.fn(async () => false) }, 'mail_not_sent'],
    [`${MAX_REQUESTS_PER_DAY} requests already today`, { requestsSince: vi.fn(async () => MAX_REQUESTS_PER_DAY) }, 'daily_cap'],
  ] as const)('%s: nothing is written, and the log says why', async (_label, over, reason) => {
    const { store, rows } = fakeStore(over)
    expect(await recordCallbackRequest(report(), store, NOW)).toMatchObject({ outcome: 'ignored', reason })
    expect(rows).toHaveLength(0)
  })

  it('a day already past is not written', async () => {
    const { store, rows } = fakeStore()
    expect(await recordCallbackRequest(report({ date: '2026-11-01' }), store, NOW)).toMatchObject({ outcome: 'ignored', reason: 'bad_day' })
    expect(rows).toHaveLength(0)
  })

  it('a script is not written (the browser check is part of the whole flow)', async () => {
    const { store, rows } = fakeStore()
    expect(await recordCallbackRequest(report({ ua: 'curl/8.4.0' }), store, NOW)).toMatchObject({ outcome: 'ignored', reason: 'not_browser' })
    expect(rows).toHaveLength(0)
  })

  it('the daily cap counts the last 24 hours', async () => {
    const { store } = fakeStore()
    await recordCallbackRequest(report(), store, NOW)
    expect(store.requestsSince).toHaveBeenCalledWith('c1', 'k1', new Date(NOW.getTime() - 86_400_000).toISOString())
  })

  it('the endpoint allowance is spent only on real tokens', async () => {
    const cap = vi.fn(() => true)
    const unknown = fakeStore({ findToken: vi.fn(async () => null) })
    expect(await recordCallbackRequest(report(), unknown.store, NOW, cap)).toMatchObject({ outcome: 'ignored' })
    expect(cap).not.toHaveBeenCalled()
    const real = fakeStore()
    expect(await recordCallbackRequest(report(), real.store, NOW, cap)).toMatchObject({ outcome: 'busy' })
    expect(real.rows).toHaveLength(0)
  })

  it('the same request again is a duplicate, not a second row', async () => {
    const { store } = fakeStore({ insertTouch: vi.fn(async () => 'duplicate' as const) })
    expect(await recordCallbackRequest(report(), store, NOW)).toMatchObject({ outcome: 'duplicate' })
  })

  it('does not look up tour names when there is no tour', async () => {
    const { store } = fakeStore()
    await recordCallbackRequest(report({ tourPath: null }), store, NOW)
    expect(store.tourNames).not.toHaveBeenCalled()
  })
})

describe('createCallbackStore (real Supabase client, stub network)', () => {
  function world(response: unknown[]) {
    const calls: Array<{ method: string; url: URL; prefer: string | null; body: string | null }> = []
    const fetchStub = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers)
      calls.push({ method: init?.method ?? 'GET', url: new URL(String(input)), prefer: headers.get('prefer'), body: typeof init?.body === 'string' ? init.body : null })
      return new Response(JSON.stringify(response), { status: 201, headers: { 'content-type': 'application/json', 'content-range': '0-0/2' } })
    }
    const db = createClient('https://proj.supabase.co', 'service-key', { global: { fetch: fetchStub } })
    const mail = { findPriorSend: vi.fn(async () => null) }
    return { store: createCallbackStore(db, mail), calls }
  }

  const row = buildCallbackTouch(report(), info, { now: NOW, timeZone: NZ, names: new Map() })

  it('inserts with the shared idempotency key and ignores a repeat', async () => {
    const { store, calls } = world([{ id: 't1' }])
    expect(await store.insertTouch(row)).toBe('inserted')
    expect(calls[0].method).toBe('POST')
    expect(calls[0].url.pathname).toBe('/rest/v1/contact_touchpoints')
    expect(calls[0].url.searchParams.get('on_conflict')).toBe('client_id,source,source_ref')
    expect(calls[0].prefer).toContain('resolution=ignore-duplicates')
    expect(JSON.parse(calls[0].body ?? '{}')).toMatchObject({ channel: 'web_form', source: 'site_callback_request', source_ref: row.source_ref })
  })

  it('an empty answer means the row was already there', async () => {
    const { store } = world([])
    expect(await store.insertTouch(row)).toBe('duplicate')
  })

  it('counts only this guest\'s call-back requests since the given time', async () => {
    const { store, calls } = world([])
    expect(await store.requestsSince('c1', 'k1', '2026-11-16T00:00:00.000Z')).toBe(2)
    const q = calls[0].url.searchParams
    expect([q.get('client_id'), q.get('contact_id'), q.get('source'), q.get('occurred_at')]).toEqual(['eq.c1', 'eq.k1', 'eq.site_callback_request', 'gte.2026-11-16T00:00:00.000Z'])
  })
})
