'use client'

import { useEffect, useRef, useState } from 'react'
import type { StatusResponse } from '@/app/api/clients/[id]/site-audit/status/route'

interface Options {
  /** Polling interval in ms. Default 5000. */
  intervalMs?: number
  /** When false, polling is paused. */
  enabled?: boolean
}

/**
 * Polls /api/clients/:id/site-audit/status every `intervalMs` while a job is
 * active (pending | in_progress). Stops automatically once the job reaches
 * a terminal state (completed | failed) or when no job exists.
 *
 * Reference: ROADMAP.md P8.3.1 — used in the onboarding wizard Step 3.
 */
export function useSiteAuditPolling(
  clientId: string,
  { intervalMs = 5000, enabled = true }: Options = {}
) {
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelledRef = useRef(false)

  useEffect(() => {
    if (!enabled || !clientId) return
    cancelledRef.current = false

    const tick = async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/site-audit/status`, {
          cache: 'no-store',
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `HTTP ${res.status}`)
        }
        const json = (await res.json()) as StatusResponse
        if (cancelledRef.current) return
        setStatus(json)
        setError(null)

        const jobStatus = json.job?.status
        const terminal = jobStatus === 'completed' || jobStatus === 'failed'
        if (!terminal) {
          timerRef.current = setTimeout(tick, intervalMs)
        }
      } catch (err) {
        if (cancelledRef.current) return
        setError(err instanceof Error ? err.message : 'Failed to load status')
        // Keep polling on error — likely transient
        timerRef.current = setTimeout(tick, intervalMs)
      }
    }

    tick()

    return () => {
      cancelledRef.current = true
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [clientId, enabled, intervalMs])

  return { status, error }
}
