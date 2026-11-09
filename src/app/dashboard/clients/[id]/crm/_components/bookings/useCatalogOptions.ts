'use client'

/**
 * Loads the tour/departure catalog options for the booking form.
 *
 * The hook fetches once on mount and again whenever `retry` is called. Results
 * that arrive after unmount are ignored via a cancelled flag.
 */

import { useCallback, useEffect, useState } from 'react'
import type { BookingOptionTour } from '@/lib/crm/booking-options'
import { fetchOptions } from './booking-api'

export type CatalogOptionsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; tours: BookingOptionTour[] }

const LOAD_ERROR = '读不到团目录，请稍后再试'

export function useCatalogOptions(clientId: string): {
  state: CatalogOptionsState
  retry: () => void
} {
  const [state, setState] = useState<CatalogOptionsState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })

    void fetchOptions(clientId).then((result) => {
      if (cancelled) return
      if (result.ok) {
        if (!Array.isArray(result.data.tours)) {
          setState({ status: 'error', message: LOAD_ERROR })
          return
        }
        setState({ status: 'ready', tours: result.data.tours })
      } else {
        setState({ status: 'error', message: result.message || LOAD_ERROR })
      }
    })

    return () => {
      cancelled = true
    }
  }, [clientId, attempt])

  const retry = useCallback(() => {
    setAttempt((n) => n + 1)
  }, [])

  return { state, retry }
}
