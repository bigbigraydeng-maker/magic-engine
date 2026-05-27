'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { DiagnosticRunStatus } from '@/types/diagnostic'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiagnosticRunSummary {
  id: string
  status: DiagnosticRunStatus
  overall_score: number | null
  dimension_scores: Record<string, number> | null
  started_at: string | null
  completed_at: string | null
  error_message: string | null
}

export interface UseDiagnosticStatusResult {
  status: DiagnosticRunStatus | null
  run: DiagnosticRunSummary | null
  error: string | null
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 3_000
const TERMINAL_STATUSES: DiagnosticRunStatus[] = ['completed', 'failed']

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDiagnosticStatus(
  clientId: string,
  runId: string | null,
): UseDiagnosticStatusResult {
  const [status, setStatus] = useState<DiagnosticRunStatus | null>(null)
  const [run, setRun] = useState<DiagnosticRunSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isTerminalRef = useRef(false)

  const poll = useCallback(async () => {
    if (!runId || isTerminalRef.current) return

    try {
      const res = await fetch(
        `/api/clients/${clientId}/diagnostic/runs/${runId}/status`,
      )
      if (!res.ok) return

      const data = (await res.json()) as { success: boolean; run: DiagnosticRunSummary }
      if (!data.success) return

      const r = data.run
      setRun(r)
      setStatus(r.status)

      if (r.status === 'failed') {
        setError(r.error_message ?? 'Diagnostic run failed')
      }

      if (TERMINAL_STATUSES.includes(r.status)) {
        isTerminalRef.current = true
        if (intervalRef.current !== null) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
        }
      }
    } catch {
      // non-fatal — keep polling
    }
  }, [clientId, runId])

  const startPolling = useCallback(() => {
    if (intervalRef.current !== null) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS)
  }, [poll])

  const stopPolling = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!runId) return

    isTerminalRef.current = false
    poll()
    startPolling()

    const handleVisibility = () => {
      if (document.hidden) {
        stopPolling()
      } else if (!isTerminalRef.current) {
        poll()
        startPolling()
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      stopPolling()
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [runId, poll, startPolling, stopPolling])

  return { status, run, error }
}
