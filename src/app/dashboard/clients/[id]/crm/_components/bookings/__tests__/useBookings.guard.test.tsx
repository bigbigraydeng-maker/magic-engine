/** The write helper itself must refuse a second write while one is in flight (not only the disabled button). */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useBookings } from '../useBookings'
import { CLIENT, CONTACT, installFetch, jsonResponse, makeBooking, route } from './booking-test-data'

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
  })
})
