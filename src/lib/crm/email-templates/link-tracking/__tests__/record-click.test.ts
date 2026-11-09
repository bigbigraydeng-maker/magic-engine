import { describe, expect, it, vi } from 'vitest'
import {
  cleanPath,
  createMinuteCap,
  judgeClick,
  parseClickReport,
  recordClick,
  uaClass,
  type ClickReport,
  type ClickRow,
  type ClickStore,
  type TokenInfo,
} from '../record-click'

const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
const SENT_AT = '2026-11-10T00:00:00.000Z'
const MIN = 60_000

function report(over: Partial<ClickReport> = {}): ClickReport {
  return { token: 'AAAAAAAAAAAA', path: '/brochures/b.pdf', method: 'GET', ua: CHROME, fetchSite: 'none', fetchMode: 'navigate', fetchDest: 'document', ...over }
}

const info: TokenInfo = { token: 'AAAAAAAAAAAA', clientId: 'c1', contactId: 'k1', requestId: 'r1', kind: 'catalogue', tour: null, createdAt: SENT_AT }

function store(over: Partial<ClickStore> = {}) {
  const rows: ClickRow[] = []
  const s: ClickStore = {
    findToken: vi.fn(async () => info),
    mailWasSent: vi.fn(async () => true),
    clickStats: vi.fn(async () => ({ count: 0, lastAt: null, hasHuman: false })),
    insertClick: vi.fn(async (row: ClickRow) => {
      rows.push(row)
    }),
    emitFirstHumanClick: vi.fn(async () => undefined),
    ...over,
  }
  return { s, rows }
}

const at = (ms: number) => new Date(Date.parse(SENT_AT) + ms)

describe('parseClickReport', () => {
  it('takes a well-formed report, keeps only the path and date', () => {
    const r = parseClickReport({ token: 'AAAAAAAAAAAA', path: '/tours/a/b/c?date=2027-03-11&utm_source=x&email=a@b.c', method: 'GET', ua: CHROME })
    expect(r).toMatchObject({ ok: true, report: { path: '/tours/a/b/c?date=2027-03-11', method: 'GET' } })
  })

  it.each([
    [null],
    [{ token: 'short', method: 'GET' }],
    [{ token: 'AAAAAAAAAAA!', method: 'GET' }],
    [{ token: 'AAAAAAAAAAAA', method: 'POST' }],
    [{ token: 'AAAAAAAAAAAA' }],
  ])('refuses %j', (body) => {
    expect(parseClickReport(body as Record<string, unknown> | null)).toEqual({ ok: false })
  })

  it('cleanPath refuses anything that is not a path', () => {
    expect(cleanPath('https://evil.com/x')).toBeNull()
    expect(cleanPath('/a?date=not-a-date')).toBe('/a')
  })
})

describe('judgeClick (§4.5)', () => {
  it('a person opening the link after 10 minutes counts', () => {
    expect(judgeClick(report(), 11 * MIN)).toEqual({ uaClass: 'browser', suspectedScan: false, countsAsHuman: true })
  })

  it.each([
    ['a HEAD request', report({ method: 'HEAD' })],
    ['a known checker', report({ ua: 'Mozilla/5.0 (compatible; Microsoft Office SafeLinks)' })],
    ['no user agent', report({ ua: '' })],
    ['not a user navigation', report({ fetchMode: 'no-cors', fetchDest: 'empty' })],
  ])('%s is a suspected scan', (_label, r) => {
    expect(judgeClick(r, 11 * MIN)).toMatchObject({ suspectedScan: true, countsAsHuman: false })
  })

  it('within 60 seconds of sending is a suspected scan; between 1 and 10 minutes is recorded but does not count', () => {
    expect(judgeClick(report(), 30_000)).toMatchObject({ suspectedScan: true, countsAsHuman: false })
    expect(judgeClick(report(), 5 * MIN)).toMatchObject({ suspectedScan: false, countsAsHuman: false })
  })

  it('a browser without fetch headers is recorded but does not count (better to under-count than to send staff to call)', () => {
    expect(judgeClick(report({ fetchMode: null, fetchDest: null }), 11 * MIN)).toMatchObject({ suspectedScan: false, countsAsHuman: false })
  })

  it('uaClass', () => {
    expect(uaClass(CHROME)).toBe('browser')
    expect(uaClass('curl/8.4.0')).toBe('scanner')
    expect(uaClass('SomethingElse/1.0')).toBe('unknown')
  })
})

describe('recordClick', () => {
  it('records a human click and wakes the day-2 reminder once', async () => {
    const { s, rows } = store()
    expect(await recordClick(report(), s, at(11 * MIN))).toBe('recorded')
    expect(rows[0]).toMatchObject({ client_id: 'c1', contact_id: 'k1', suspected_scan: false, counts_as_human: true })
    expect(s.emitFirstHumanClick).toHaveBeenCalledTimes(1)
  })

  it('no second event when the token already had a human click', async () => {
    const { s } = store({ clickStats: vi.fn(async () => ({ count: 1, lastAt: at(-60 * MIN).toISOString(), hasHuman: true })) })
    await recordClick(report(), s, at(30 * MIN))
    expect(s.emitFirstHumanClick).not.toHaveBeenCalled()
  })

  it('a scan is recorded, never counted, and wakes nothing', async () => {
    const { s, rows } = store()
    await recordClick(report({ method: 'HEAD' }), s, at(11 * MIN))
    expect(rows[0]).toMatchObject({ suspected_scan: true, counts_as_human: false })
    expect(s.emitFirstHumanClick).not.toHaveBeenCalled()
  })

  it('an unknown token, or a mail that was not sent, records nothing', async () => {
    const unknown = store({ findToken: vi.fn(async () => null) })
    expect(await recordClick(report(), unknown.s, at(11 * MIN))).toBe('ignored')
    expect(unknown.rows).toHaveLength(0)
    const notSent = store({ mailWasSent: vi.fn(async () => false) })
    expect(await recordClick(report(), notSent.s, at(11 * MIN))).toBe('ignored')
    expect(notSent.rows).toHaveLength(0)
  })

  it('at most one row per 5 minutes per token, and 50 in all', async () => {
    const recent = store({ clickStats: vi.fn(async () => ({ count: 1, lastAt: at(9 * MIN).toISOString(), hasHuman: false })) })
    expect(await recordClick(report(), recent.s, at(11 * MIN))).toBe('ignored')
    const full = store({ clickStats: vi.fn(async () => ({ count: 50, lastAt: null, hasHuman: false })) })
    expect(await recordClick(report(), full.s, at(11 * MIN))).toBe('ignored')
  })
})

describe('createMinuteCap', () => {
  it('lets N through per minute, then refuses until the minute turns', () => {
    const over = createMinuteCap(2)
    expect([over(0), over(1), over(2)]).toEqual([false, false, true])
    expect(over(60_001)).toBe(false)
  })
})

describe('statsFromRows (the 5-minute de-dupe)', () => {
  it('a scan a second before the guest does not swallow the guest\'s click', async () => {
    const { statsFromRows } = await import('../click-store-prod')
    const rows = [{ occurred_at: '2026-11-11T07:03:00Z', counts_as_human: false, suspected_scan: true }]
    expect(statsFromRows(rows)).toEqual({ count: 1, lastAt: null, hasHuman: false })
  })

  it('a real click within 5 minutes does count for the de-dupe', async () => {
    const { statsFromRows } = await import('../click-store-prod')
    const rows = [
      { occurred_at: '2026-11-11T07:05:00Z', counts_as_human: false, suspected_scan: true },
      { occurred_at: '2026-11-11T07:03:00Z', counts_as_human: true, suspected_scan: false },
    ]
    expect(statsFromRows(rows)).toEqual({ count: 2, lastAt: '2026-11-11T07:03:00Z', hasHuman: true })
  })
})
