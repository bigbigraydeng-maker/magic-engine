'use client'

/**
 * Client hook for the CRM "订单与付款" block.
 *
 * Owns the loading / hidden / error / ready state machine for a single
 * contact's bookings, plus a `run` helper that wraps a mutating API call
 * with busy tracking, stale handling and a follow-up reload.
 *
 * Only imports the browser-side API layer and shared types, so it stays
 * safe to use from client components.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import type { BookingView } from '@/lib/crm/booking-types'
import {
  announceBookingsChanged,
  fetchBookings,
  type ApiResult,
} from './booking-api'

export type BookingsState =
  | { status: 'loading' }
  | { status: 'hidden' }
  | { status: 'error'; message: string }
  | { status: 'ready'; bookings: BookingView[] }

export type RunAction = (action: () => Promise<ApiResult<unknown>>) => Promise<boolean>

export interface UseBookingsResult {
  state: BookingsState
  notice: string | null
  busy: boolean
  reload: () => Promise<void>
  run: RunAction
  clearNotice: () => void
}

const REFRESH_FAILED_MESSAGE = '已保存，刷新没成功，请手动刷新'

/** Keep only well-formed booking entries from an unknown list. */
function sanitizeBookings(value: unknown): BookingView[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is BookingView => {
    if (typeof entry !== 'object' || entry === null) return false
    const record = entry as Record<string, unknown>
    return (
      typeof record.id === 'string' &&
      Array.isArray(record.milestones) &&
      Array.isArray(record.warnings)
    )
  })
}

/** Apply a fetch result to the current state, returning the next state. */
function applyLoadResult(
  current: BookingsState,
  result: ApiResult<{ bookings: BookingView[] }>,
): { next: BookingsState; notice: string | null } {
  if (result.ok) {
    if (!Array.isArray(result.data.bookings)) {
      return { next: { status: 'hidden' }, notice: null }
    }
    return { next: { status: 'ready', bookings: sanitizeBookings(result.data.bookings) }, notice: null }
  }
  if (result.kind === 'hidden') {
    return { next: { status: 'hidden' }, notice: null }
  }
  if (current.status === 'ready') {
    return { next: current, notice: result.message }
  }
  return { next: { status: 'error', message: result.message }, notice: null }
}

export function useBookings(clientId: string, contactId: string): UseBookingsResult {
  const [state, setState] = useState<BookingsState>({ status: 'loading' })
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const requestIdRef = useRef(0)
  const mountedRef = useRef(true)
  const busyRef = useRef(false)
  const stateRef = useRef<BookingsState>(state)
  stateRef.current = state

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const load = useCallback(
    async (showLoading: boolean): Promise<boolean> => {
      const requestId = ++requestIdRef.current
      if (showLoading) {
        setState({ status: 'loading' })
        setNotice(null)
      }
      const result = await fetchBookings(clientId, contactId)
      if (!mountedRef.current || requestId !== requestIdRef.current) return true
      const { next, notice: nextNotice } = applyLoadResult(stateRef.current, result)
      setState(next)
      if (nextNotice !== null) setNotice(nextNotice)
      return result.ok
    },
    [clientId, contactId],
  )

  useEffect(() => {
    void load(true)
  }, [load])

  const reloadOk = useCallback((): Promise<boolean> => load(false), [load])

  const reload = useCallback(async (): Promise<void> => {
    await load(false)
  }, [load])

  const run = useCallback<RunAction>(
    async (action) => {
      if (busyRef.current) return false
      busyRef.current = true
      setBusy(true)
      setNotice(null)
      try {
        const result = await action()
        if (!mountedRef.current) return false
        if (result.ok) {
          const loaded = await reloadOk()
          if (!loaded) setNotice(REFRESH_FAILED_MESSAGE)
          announceBookingsChanged()
          return true
        }
        if (result.kind === 'stale') {
          setNotice(result.message)
          await reload()
          return false
        }
        if (result.kind === 'hidden') {
          setState({ status: 'hidden' })
          return false
        }
        setNotice(result.message)
        return false
      } finally {
        busyRef.current = false
        if (mountedRef.current) setBusy(false)
      }
    },
    [reload, reloadOk],
  )

  const clearNotice = useCallback((): void => {
    setNotice(null)
  }, [])

  return { state, notice, busy, reload, run, clearNotice }
}
