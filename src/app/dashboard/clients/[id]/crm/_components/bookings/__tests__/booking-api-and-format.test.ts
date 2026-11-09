import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  BAD_INPUT_ERROR,
  BOOKINGS_CHANGED_EVENT,
  GENERIC_ERROR,
  STALE_MESSAGE,
  addMember,
  announceBookingsChanged,
  cancelBooking,
  createBooking,
  fetchBookings,
  fetchMembers,
  fetchNudgeList,
  fetchOptions,
  markPaid,
  markUnpaid,
  nudgeMilestone,
  overrideDue,
  patchBooking,
  removeMember,
  confirmDeparture,
} from '../booking-api'
import {
  bookingTitle,
  departureLabel,
  departureStatusNote,
  dueRelative,
  milestoneStatusText,
  nudgeRelative,
  nzToday,
  shortDate,
} from '../booking-format'
import { makeBooking, makeMilestone } from './booking-test-data'

const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const BOOKING = '30000000-0000-4000-8000-0000000000a1'

interface StubCall {
  url: string
  init: RequestInit | undefined
}

function stubFetch(body: unknown, status = 200): StubCall[] {
  const calls: StubCall[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
      calls.push({ url, init })
      return new Response(JSON.stringify(body), { status })
    }),
  )
  return calls
}

function stubFetchRaw(raw: string, status: number): StubCall[] {
  const calls: StubCall[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
      calls.push({ url, init })
      return new Response(raw, { status })
    }),
  )
  return calls
}

function parseBody(init: RequestInit | undefined): Record<string, unknown> {
  if (!init || typeof init.body !== 'string') return {}
  const parsed: unknown = JSON.parse(init.body)
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>
  }
  return {}
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('callApi success and failure mapping', () => {
  it('returns ok with data on 200', async () => {
    stubFetch({ bookings: [] }, 200)
    const result = await fetchBookings(CLIENT, 'c1a1a1a1-0000-4000-8000-000000000001')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({ bookings: [] })
    }
  })

  it('maps 403 to hidden with an empty message', async () => {
    stubFetch({ error: 'forbidden' }, 403)
    const result = await fetchOptions(CLIENT)
    expect(result).toEqual({ ok: false, kind: 'hidden', message: '' })
  })

  it('maps 404 booking_tracker_not_enabled to hidden', async () => {
    stubFetch({ error: 'booking_tracker_not_enabled' }, 404)
    const result = await fetchOptions(CLIENT)
    expect(result).toEqual({ ok: false, kind: 'hidden', message: '' })
  })

  it('maps other 404 to kind other with the generic message', async () => {
    stubFetch({ error: 'not_found' }, 404)
    const result = await fetchOptions(CLIENT)
    expect(result).toEqual({ ok: false, kind: 'other', message: GENERIC_ERROR })
  })

  it('maps 409 stale to kind stale with the stale message', async () => {
    stubFetch({ error: 'stale' }, 409)
    const result = await markPaid(
      CLIENT,
      BOOKING,
      'deposit',
      '2026-10-02T00:00:00.000000+00:00',
      '2026-10-05',
    )
    expect(result).toEqual({ ok: false, kind: 'stale', message: STALE_MESSAGE })
  })

  it('maps 409 duplicate_booking to kind other with the server message', async () => {
    stubFetch({ error: 'duplicate_booking', message: '这个团他已经订过了' }, 409)
    const result = await createBooking(CLIENT, {
      contactId: 'c1a1a1a1-0000-4000-8000-000000000001',
      tourId: '10000000-0000-4000-8000-0000000000a1',
      departureId: null,
      bookedOn: '2026-10-12',
    })
    expect(result).toEqual({
      ok: false,
      kind: 'other',
      message: '这个团他已经订过了',
    })
  })

  it('maps 400 invalid_cancel_note to the plain Chinese message', async () => {
    stubFetch({ error: 'invalid_cancel_note' }, 400)
    const result = await cancelBooking(
      CLIENT,
      BOOKING,
      '2026-10-01T00:00:00.000000+00:00',
      '',
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('other')
      expect(result.message).toBe('请写一句取消原因（不超过 200 字，不要写金额）')
    }
  })

  it('maps an unknown 400 code to BAD_INPUT_ERROR', async () => {
    stubFetch({ error: 'something_new' }, 400)
    const result = await cancelBooking(
      CLIENT,
      BOOKING,
      '2026-10-01T00:00:00.000000+00:00',
      '客人改主意了',
    )
    expect(result).toEqual({ ok: false, kind: 'other', message: BAD_INPUT_ERROR })
  })

  it('maps 500 to the generic message', async () => {
    stubFetch({ error: 'boom' }, 500)
    const result = await fetchOptions(CLIENT)
    expect(result).toEqual({ ok: false, kind: 'other', message: GENERIC_ERROR })
  })

  it('maps a thrown fetch to the generic message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (): Promise<Response> => {
        throw new Error('network down')
      }),
    )
    const result = await fetchOptions(CLIENT)
    expect(result).toEqual({ ok: false, kind: 'other', message: GENERIC_ERROR })
  })

  it('handles a non-JSON body with a 500 status', async () => {
    stubFetchRaw('<html>server error</html>', 500)
    const result = await fetchOptions(CLIENT)
    expect(result).toEqual({ ok: false, kind: 'other', message: GENERIC_ERROR })
  })

  it('never leaks the raw server error code into the message', async () => {
    const cases: Array<{ body: unknown; status: number }> = [
      { body: { error: 'not_found' }, status: 404 },
      { body: { error: 'stale' }, status: 409 },
      { body: { error: 'duplicate_booking', message: '这个团他已经订过了' }, status: 409 },
      { body: { error: 'invalid_cancel_note' }, status: 400 },
      { body: { error: 'something_new' }, status: 400 },
      { body: { error: 'boom' }, status: 500 },
    ]
    for (const c of cases) {
      stubFetch(c.body, c.status)
      const result = await fetchOptions(CLIENT)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        const code =
          c.body !== null && typeof c.body === 'object' && 'error' in c.body
            ? String((c.body as Record<string, unknown>).error)
            : ''
        expect(result.message).not.toBe(code)
        expect(result.message.includes(code)).toBe(false)
      }
      vi.unstubAllGlobals()
    }
  })
})

describe('typed wrappers build the right requests', () => {
  it('markPaid posts to the paid endpoint with the expected body and header', async () => {
    const calls = stubFetch({ ok: true }, 200)
    await markPaid(
      CLIENT,
      BOOKING,
      'deposit',
      '2026-10-02T00:00:00.000000+00:00',
      '2026-10-05',
    )
    expect(calls).toHaveLength(1)
    const call = calls[0]
    expect(call.url).toBe(
      `/api/clients/${CLIENT}/crm/bookings/${BOOKING}/milestones/deposit/paid`,
    )
    expect(call.init?.method).toBe('POST')
    const headers = call.init?.headers as Record<string, string> | undefined
    expect(headers?.['Content-Type']).toBe('application/json')
    expect(parseBody(call.init)).toEqual({
      expectedUpdatedAt: '2026-10-02T00:00:00.000000+00:00',
      paidOn: '2026-10-05',
    })
  })

  it('markUnpaid posts to the unpaid endpoint', async () => {
    const calls = stubFetch({ ok: true }, 200)
    await markUnpaid(CLIENT, BOOKING, 'balance', '2026-10-03T00:00:00.000000+00:00')
    expect(calls[0].url).toBe(
      `/api/clients/${CLIENT}/crm/bookings/${BOOKING}/milestones/balance/unpaid`,
    )
    expect(calls[0].init?.method).toBe('POST')
    expect(parseBody(calls[0].init)).toEqual({
      expectedUpdatedAt: '2026-10-03T00:00:00.000000+00:00',
    })
  })

  it('overrideDue posts the dueOn value', async () => {
    const calls = stubFetch({ ok: true }, 200)
    await overrideDue(
      CLIENT,
      BOOKING,
      'deposit',
      '2026-10-02T00:00:00.000000+00:00',
      '2026-11-01',
    )
    expect(calls[0].url).toBe(
      `/api/clients/${CLIENT}/crm/bookings/${BOOKING}/milestones/deposit/override-due`,
    )
    expect(parseBody(calls[0].init)).toEqual({
      expectedUpdatedAt: '2026-10-02T00:00:00.000000+00:00',
      dueOn: '2026-11-01',
    })
  })

  it('nudgeMilestone omits days unless the mode is snooze', async () => {
    const calls = stubFetch({ ok: true }, 200)
    await nudgeMilestone(
      CLIENT,
      BOOKING,
      'deposit',
      '2026-10-02T00:00:00.000000+00:00',
      'nudged_today',
    )
    expect(parseBody(calls[0].init)).toEqual({
      expectedUpdatedAt: '2026-10-02T00:00:00.000000+00:00',
      mode: 'nudged_today',
    })
    expect('days' in parseBody(calls[0].init)).toBe(false)

    const calls2 = stubFetch({ ok: true }, 200)
    await nudgeMilestone(
      CLIENT,
      BOOKING,
      'deposit',
      '2026-10-02T00:00:00.000000+00:00',
      'snooze',
      7,
    )
    expect(parseBody(calls2[0].init)).toEqual({
      expectedUpdatedAt: '2026-10-02T00:00:00.000000+00:00',
      mode: 'snooze',
      days: 7,
    })
  })

  it('patchBooking uses PATCH and wraps the patch object', async () => {
    const calls = stubFetch({ ok: true }, 200)
    await patchBooking(CLIENT, BOOKING, '2026-10-01T00:00:00.000000+00:00', {
      note: '客人想坐窗边',
      partySize: 4,
    })
    expect(calls[0].url).toBe(`/api/clients/${CLIENT}/crm/bookings/${BOOKING}`)
    expect(calls[0].init?.method).toBe('PATCH')
    expect(parseBody(calls[0].init)).toEqual({
      expectedUpdatedAt: '2026-10-01T00:00:00.000000+00:00',
      patch: { note: '客人想坐窗边', partySize: 4 },
    })
  })

  it('confirmDeparture posts to the confirm-departure endpoint', async () => {
    const calls = stubFetch({ ok: true }, 200)
    await confirmDeparture(CLIENT, BOOKING, '2026-10-01T00:00:00.000000+00:00')
    expect(calls[0].url).toBe(
      `/api/clients/${CLIENT}/crm/bookings/${BOOKING}/confirm-departure`,
    )
    expect(calls[0].init?.method).toBe('POST')
  })

  it('fetchBookings URL-encodes the contactId', async () => {
    const calls = stubFetch({ bookings: [] }, 200)
    await fetchBookings(CLIENT, 'a b/c+d')
    expect(calls[0].url).toBe(
      `/api/clients/${CLIENT}/crm/bookings?contactId=${encodeURIComponent('a b/c+d')}`,
    )
    expect(calls[0].init?.method).toBe('GET')
  })

  it('fetchNudgeList puts the limit in the query string', async () => {
    const calls = stubFetch({ nudge: { rows: [] } }, 200)
    await fetchNudgeList(CLIENT, 25)
    expect(calls[0].url).toBe(`/api/clients/${CLIENT}/crm/bookings/nudge-list?limit=25`)
  })

  it('removeMember URL-encodes the email and uses DELETE', async () => {
    const calls = stubFetch({ members: [] }, 200)
    await removeMember(CLIENT, 'a b+c@example.com')
    expect(calls[0].url).toBe(
      `/api/clients/${CLIENT}/crm/bookings/members?email=${encodeURIComponent(
        'a b+c@example.com',
      )}`,
    )
    expect(calls[0].init?.method).toBe('DELETE')
  })

  it('addMember posts the email', async () => {
    const calls = stubFetch({ members: [] }, 200)
    await addMember(CLIENT, 'staff@example.com')
    expect(calls[0].url).toBe(`/api/clients/${CLIENT}/crm/bookings/members`)
    expect(calls[0].init?.method).toBe('POST')
    expect(parseBody(calls[0].init)).toEqual({ email: 'staff@example.com' })
  })

  it('fetchMembers uses GET', async () => {
    const calls = stubFetch({ members: [] }, 200)
    await fetchMembers(CLIENT)
    expect(calls[0].url).toBe(`/api/clients/${CLIENT}/crm/bookings/members`)
    expect(calls[0].init?.method).toBe('GET')
  })
})

describe('announceBookingsChanged', () => {
  it('dispatches a window event with the expected name', () => {
    const listener = vi.fn()
    window.addEventListener(BOOKINGS_CHANGED_EVENT, listener)
    announceBookingsChanged()
    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener(BOOKINGS_CHANGED_EVENT, listener)
  })
})

describe('booking-format', () => {
  it('shortDate formats valid ISO dates and falls back otherwise', () => {
    expect(shortDate('2026-10-08')).toBe('10月08日')
    expect(shortDate('2026-03-02')).toBe('3月02日')
    expect(shortDate(null)).toBe('（未定）')
    expect(shortDate('bad')).toBe('（未定）')
  })

  it('dueRelative describes the countdown', () => {
    expect(dueRelative(61)).toBe('还有 61 天')
    expect(dueRelative(0)).toBe('今天到期')
    expect(dueRelative(-5)).toBe('已逾期 5 天')
    expect(dueRelative(null)).toBe('')
  })

  it('nudgeRelative describes the countdown for the reminder list', () => {
    expect(nudgeRelative(8)).toBe('8 天后到期')
    expect(nudgeRelative(0)).toBe('今天到期')
    expect(nudgeRelative(-3)).toBe('已逾期 3 天')
    expect(nudgeRelative(null)).toBe('')
  })

  it('milestoneStatusText covers paid, unpaid with due, and unpaid without due', () => {
    const paid = makeMilestone('deposit', {
      state: 'paid',
      paidOn: '2026-10-08',
    })
    expect(milestoneStatusText(paid)).toBe('✅ 已收 2026-10-08')

    const unpaidWithDue = makeMilestone('balance', {
      state: 'unpaid',
      dueOn: '2026-12-12',
      dueInDays: 61,
    })
    expect(milestoneStatusText(unpaidWithDue)).toBe(
      '未收到 · 到期 2026-12-12（还有 61 天）',
    )

    const unpaidNoDue = makeMilestone('balance', {
      state: 'unpaid',
      dueOn: null,
      dueInDays: null,
      dueNote: '等出发日期定了再算',
    })
    expect(milestoneStatusText(unpaidNoDue)).toBe('未收到 · 等出发日期定了再算')

    const unpaidNoDueNoNote = makeMilestone('balance', {
      state: 'unpaid',
      dueOn: null,
      dueInDays: null,
      dueNote: null,
    })
    expect(milestoneStatusText(unpaidNoDueNoNote)).toBe('未收到 · 到期日还没算出来')
  })

  it('bookingTitle handles present and missing tour name and departure', () => {
    expect(bookingTitle(makeBooking())).toBe('新西兰南北岛 · 2027-03-12 出发')
    expect(bookingTitle(makeBooking({ tourName: null }))).toBe(
      '（团目录里已找不到这个团） · 2027-03-12 出发',
    )
    expect(bookingTitle(makeBooking({ departOn: null }))).toBe(
      '新西兰南北岛 · 出发日期未定',
    )
  })

  it('departureLabel includes the return date when present', () => {
    expect(departureLabel('2026-10-08', '2026-10-15')).toBe(
      '2026-10-08 出发（2026-10-15 回）',
    )
    expect(departureLabel('2026-10-08', null)).toBe('2026-10-08 出发')
  })

  it('departureStatusNote maps availability statuses', () => {
    expect(departureStatusNote('sold_out')).toBe('（已满）')
    expect(departureStatusNote('limited')).toBe('（少量名额）')
    expect(departureStatusNote('open')).toBe('')
  })

  it('nzToday uses Pacific/Auckland time', () => {
    expect(nzToday(new Date('2026-10-11T12:00:00Z'))).toBe('2026-10-12')
    expect(nzToday(new Date('2026-10-11T10:00:00Z'))).toBe('2026-10-11')
  })
})
