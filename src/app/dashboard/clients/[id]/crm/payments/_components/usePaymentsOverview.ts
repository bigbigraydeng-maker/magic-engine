'use client'

/**
 * Loads the 付款总览 data for one query.
 *
 * One request per distinct query string. Every request gets an id and an AbortController;
 * only the newest request may write state, so a slow older response can never overwrite
 * a newer one. While a newer query loads, the previous good data stays on screen (marked
 * `refreshing`); an error or a not-available answer replaces it, so no stale number is
 * ever shown next to an error.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { OverviewPayload } from '@/lib/crm/booking-overview-load'
import { fetchOverview } from './payments-api'
import { parsePaymentsQuery, toSearchString, type PaymentsQuery } from './payments-query'

export type OverviewState =
  | { status: 'loading' }
  | { status: 'hidden' }
  | { status: 'error' }
  | { status: 'ready'; data: OverviewPayload; refreshing: boolean }

export function usePaymentsOverview(clientId: string, query: PaymentsQuery) {
  const [state, setState] = useState<OverviewState>({ status: 'loading' })
  const [retryTick, setRetryTick] = useState(0)
  const latestId = useRef(0)
  const key = toSearchString(query)

  useEffect(() => {
    const requestId = ++latestId.current
    const controller = new AbortController()
    setState((prev) => (prev.status === 'ready' ? { ...prev, refreshing: true } : { status: 'loading' }))
    void fetchOverview(clientId, parsePaymentsQuery(new URLSearchParams(key)), controller.signal).then((result) => {
      if (requestId !== latestId.current) return
      if (result.kind === 'ok') setState({ status: 'ready', data: result.data, refreshing: false })
      else setState({ status: result.kind })
    })
    return () => controller.abort()
  }, [clientId, key, retryTick])

  const retry = useCallback(() => setRetryTick((n) => n + 1), [])
  return { state, retry }
}
