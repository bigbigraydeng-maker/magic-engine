import { describe, it, expect, vi } from 'vitest'
import {
  CLIENT_WEEKLY_REPORT_FLAG,
  loadWeeklyReportRoster,
  parseWeeklyReportDue,
  runOneWeeklyReport,
  weeklyReportEventId,
} from '../fanout'
import type { WeeklyReportInput } from '../build'
import type { DraftReceipt } from '../deliver'

const CLIENT = '19e025b7-555b-44fd-ba87-debc62a447a7'
const due = { client_id: CLIENT, week_key: '2026-W45' }

const input = (over: Partial<WeeklyReportInput> = {}): WeeklyReportInput => ({
  clientLabel: 'X',
  window: { start: '2026-10-22', end: '2026-10-28' },
  previousWindow: { start: '2026-10-15', end: '2026-10-21' },
  gsc: { current: { clicks: 1, impressions: 2, position: 3 }, previous: { clicks: 0, impressions: 0, position: 0 }, queries: [], pages: [] },
  ga4: { periodStart: 'a', periodEnd: 'b', totalPageviews: 1, totalSessions: 1, totalUsers: 1, pages: [] },
  leadsInWindow: 0,
  brandTerms: [],
  siteUpdates: [],
  nextSteps: [],
  ...over,
})

const receipt = (status: DraftReceipt['status']): DraftReceipt => ({
  status,
  requestId: 'r1',
  clientLabel: 'X',
  windowStart: 'a',
  windowEnd: 'b',
  noClientSend: true,
  createdAt: 'now',
})

describe('roster', () => {
  it('only asks for clients with the explicit flag (default = nobody)', async () => {
    const contains = vi.fn().mockResolvedValue({ data: [{ id: CLIENT }, { id: 5 }], error: null })
    const select = vi.fn().mockReturnValue({ contains })
    const supabase = { from: vi.fn().mockReturnValue({ select }) } as never
    const r = await loadWeeklyReportRoster(supabase)
    expect(contains).toHaveBeenCalledWith('seo_config', { [CLIENT_WEEKLY_REPORT_FLAG]: true })
    expect(r).toEqual({ ok: true, entries: [{ clientId: CLIENT }] })
  })

  it('a read error is a failed roster, never an empty "healthy" one', async () => {
    const supabase = { from: () => ({ select: () => ({ contains: async () => ({ data: null, error: { message: 'boom' } }) }) }) } as never
    expect(await loadWeeklyReportRoster(supabase)).toEqual({ ok: false, reason: 'boom' })
  })
})

describe('parseWeeklyReportDue / eventId', () => {
  it('rejects malformed payloads', () => {
    expect(parseWeeklyReportDue(null).ok).toBe(false)
    expect(parseWeeklyReportDue({ client_id: 'x', week_key: '2026-W45' }).ok).toBe(false)
    expect(parseWeeklyReportDue({ client_id: CLIENT, week_key: '2026-45' }).ok).toBe(false)
    expect(parseWeeklyReportDue(due)).toEqual({ ok: true, value: due })
  })

  it('event id is stable per client and week', () => {
    expect(weeklyReportEventId(CLIENT, '2026-W45')).toBe(`client-weekly-report-2026-W45-${CLIENT}`)
    expect(weeklyReportEventId(CLIENT, '2026-W45', 'retry')).toBe(`client-weekly-report-2026-W45-${CLIENT}-retry`)
  })
})

describe('runOneWeeklyReport', () => {
  it('sends an internal review draft and never claims a client send', async () => {
    const send = vi.fn().mockResolvedValue(receipt('sent_to_internal_review'))
    const out = await runOneWeeklyReport(due, { gather: async () => input(), send })
    expect(out.status).toBe('sent_to_internal_review')
    expect(out.no_client_send).toBe(true)
    expect(send).toHaveBeenCalledOnce()
  })

  it('does not send when both GSC and GA4 could not be read', async () => {
    const send = vi.fn()
    const out = await runOneWeeklyReport(due, { gather: async () => input({ gsc: null, ga4: null }), send })
    expect(out.status).toBe('no_data')
    expect(send).not.toHaveBeenCalled()
  })

  it('still sends when only one source is readable, and says which', async () => {
    const send = vi.fn().mockResolvedValue(receipt('sent_to_internal_review'))
    const out = await runOneWeeklyReport(due, { gather: async () => input({ ga4: null }), send })
    expect(out).toMatchObject({ status: 'sent_to_internal_review', gsc_read: true, ga4_read: false })
  })

  it('reports a failed send as failed, and a missing client as not found', async () => {
    const failed = await runOneWeeklyReport(due, { gather: async () => input(), send: async () => receipt('failed') })
    expect(failed.status).toBe('send_failed')
    const notFound = await runOneWeeklyReport(due, { gather: async () => null, send: vi.fn() })
    expect(notFound.status).toBe('client_not_found')
  })
})
