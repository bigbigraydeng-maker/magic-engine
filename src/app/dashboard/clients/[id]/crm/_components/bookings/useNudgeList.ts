'use client'

/**
 * Hook that loads and mutates the CRM "付款要催" reminder list.
 *
 * Wraps the browser API layer (./booking-api) with loading / hidden / error /
 * ready state, a request counter so stale responses never win, and a busy
 * flag so only one reminder can be acted on at a time.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { NudgeList, NudgeMode, NudgeRow } from '@/lib/crm/booking-types'
import { afterCrmListReady } from '@/lib/crm/list-ready'
import {
  BOOKINGS_CHANGED_EVENT,
  fetchNudgeList,
  nudgeMilestone,
} from './booking-api'

export type NudgeState =
  | { status: 'loading' }
  | { status: 'hidden' }
  | { status: 'error'; message: string }
  | { status: 'ready'; nudge: NudgeList }

export const NUDGE_PAGE_SIZE = 10
export const NUDGE_EXPANDED_SIZE = 100

export interface UseNudgeListResult {
  state: NudgeState
  notice: string | null
  expanded: boolean
  busyBookingId: string | null
  expand: () => void
  reload: () => Promise<void>
  act: (row: NudgeRow, mode: NudgeMode, days?: 3 | 7 | 14) => Promise<void>
  clearNotice: () => void
}

/** Remove every row belonging to one booking from a ready list. */
function withoutBooking(nudge: NudgeList, bookingId: string): NudgeList {
  return {
    ...nudge,
    rows: nudge.rows.filter((r) => r.bookingId !== bookingId),
    collapsedRows: nudge.collapsedRows.filter((r) => r.bookingId !== bookingId),
  }
}

/** True when a value looks like a NudgeList (object with an array of rows). */
function isNudgeList(value: unknown): value is NudgeList {
  if (typeof value !== 'object' || value === null) return false
  return Array.isArray((value as { rows?: unknown }).rows)
}

/** Fill in a missing collapsedRows array so older responses do not crash. */
function normaliseNudgeList(nudge: NudgeList): NudgeList {
  if (Array.isArray(nudge.collapsedRows)) return nudge
  return { ...nudge, collapsedRows: [] }
}

export function useNudgeList(clientId: string): UseNudgeListResult {
  const [state, setState] = useState<NudgeState>({ status: 'loading' })
  const [notice, setNotice] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [busyBookingId, setBusyBookingId] = useState<string | null>(null)

  const requestRef = useRef(0)
  const mountedRef = useRef(true)
  const stateRef = useRef<NudgeState>(state)
  stateRef.current = state

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const load = useCallback(
    async (showLoading: boolean) => {
      const requestId = requestRef.current + 1
      requestRef.current = requestId
      if (showLoading) setState({ status: 'loading' })

      const limit = expanded ? NUDGE_EXPANDED_SIZE : NUDGE_PAGE_SIZE
      const result = await fetchNudgeList(clientId, limit)
      if (!mountedRef.current || requestRef.current !== requestId) return

      if (result.ok) {
        if (!isNudgeList(result.data.nudge)) {
          setState({ status: 'hidden' })
          return
        }
        setState({ status: 'ready', nudge: normaliseNudgeList(result.data.nudge) })
        return
      }
      if (result.kind === 'hidden') {
        setState({ status: 'hidden' })
        return
      }
      if (stateRef.current.status === 'ready') {
        setNotice(result.message)
        return
      }
      setState({ status: 'error', message: result.message })
    },
    [clientId, expanded],
  )

  useEffect(() => {
    return afterCrmListReady(() => {
      void load(stateRef.current.status !== 'ready')
    })
  }, [load])

  const reload = useCallback(async () => {
    await load(false)
  }, [load])

  useEffect(() => {
    const handler = () => {
      void reload()
    }
    window.addEventListener(BOOKINGS_CHANGED_EVENT, handler)
    return () => {
      window.removeEventListener(BOOKINGS_CHANGED_EVENT, handler)
    }
  }, [reload])

  const expand = useCallback(() => {
    setExpanded(true)
  }, [])

  const clearNotice = useCallback(() => {
    setNotice(null)
  }, [])

  const act = useCallback(
    async (row: NudgeRow, mode: NudgeMode, days?: 3 | 7 | 14) => {
      if (busyBookingId !== null) return
      setBusyBookingId(row.bookingId)
      setNotice(null)

      const result = await nudgeMilestone(
        clientId,
        row.bookingId,
        row.kind,
        row.milestoneUpdatedAt,
        mode,
        days,
      )
      if (!mountedRef.current) {
        setBusyBookingId(null)
        return
      }

      if (result.ok) {
        setState((prev) =>
          prev.status === 'ready'
            ? { status: 'ready', nudge: withoutBooking(prev.nudge, row.bookingId) }
            : prev,
        )
        await reload()
      } else if (result.kind === 'stale') {
        setNotice(result.message)
        await reload()
      } else if (result.kind === 'hidden') {
        setState({ status: 'hidden' })
      } else {
        setNotice(result.message)
      }

      setBusyBookingId(null)
    },
    [busyBookingId, clientId, reload],
  )

  return { state, notice, expanded, busyBookingId, expand, reload, act, clearNotice }
}
