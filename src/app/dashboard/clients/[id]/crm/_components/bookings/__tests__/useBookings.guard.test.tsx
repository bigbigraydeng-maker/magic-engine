/** The write helper itself must refuse a second write while one is in flight (not only the disabled button). */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useBookings } from '../useBookings'
import { BOOKING_ID, CLIENT, CONTACT, DEPOSIT_UPDATED_AT, installFetch, jsonResponse, makeBooking, makeMilestone, route } from './booking-test-data'

afterEach(() => vi.unstubAllGlobals())

describe('useBookings run()', () => {
  it('runs only ONE action when called twice in the same tick', async () => {
    installFetch([route('GET', '/crm/bookings?contactId=', () => jsonResponse({ bookings: [makeBooking()] }))])
    const { result } = renderHook(() => useBookings(CLIENT, CONTACT))
    await waitFor(() => expect(result.current.state.status).toBe('ready'))

    const action = vi.fn(async () => ({ ok: true as const, data: {} }))
    let outcomes: boolean[] = []
    await act(async () => {
      outcomes = await Promise.all([result.current.run(action), result.current.run(action)])
    })

    expect(action).toHaveBeenCalledTimes(1)
    expect(outcomes).toEqual([true, false])
    expect(result.current.dealRetry).toBeNull()
  })

  it('shows the deal message and a retry entry when payment succeeded but the deal was not recorded', async () => {
    const paid = makeBooking({
      partySize: null,
      milestones: [makeMilestone('deposit', { state: 'paid', paidOn: '2026-10-08' })],
    })
    const calls = installFetch([
      route('GET', '/crm/bookings?contactId=', () => jsonResponse({ bookings: [paid] })),
      route('POST', '/milestones/deposit/paid', () => jsonResponse({
        booking: paid,
        milestoneKind: 'deposit',
        deal: { recorded: true, alreadyRecorded: false, message: '记下了，等审核后再发给广告平台。' },
      })),
    ])
    const { result } = renderHook(() => useBookings(CLIENT, CONTACT))
    await waitFor(() => expect(result.current.state.status).toBe('ready'))

    const message = '订单没有人数，不能按标价估算，成交记录没有写成。'
    await act(async () => {
      await result.current.run(async () => ({
        ok: true as const,
        data: {
          booking: { id: BOOKING_ID, milestones: [{ kind: 'deposit', paidOn: '2026-10-08' }] },
          milestoneKind: 'deposit',
          deal: { recorded: false, alreadyRecorded: false, reason: 'missing_party_size', message },
        },
      }))
    })

    expect(result.current.notice).toBe(message)
    expect(result.current.dealRetry).toMatchObject({ bookingId: BOOKING_ID, kind: 'deposit', paidOn: '2026-10-08' })

    await act(async () => {
      await result.current.retryDeal()
    })
    expect(calls.calls.some((call) => call.method === 'POST' && call.url.includes('/milestones/deposit/paid'))).toBe(true)
    expect(calls.calls.find((call) => call.method === 'POST')?.body).toMatchObject({
      expectedUpdatedAt: DEPOSIT_UPDATED_AT,
      paidOn: '2026-10-08',
    })
  })
})
