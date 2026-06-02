'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SuggestionFeedbackState } from './useWorkbenchSuggestionFeedback'

const STORAGE_KEY = 'me:zhuge-suggestion-events:v1'

export interface SuggestionFeedbackEvent {
  localId: string
  clientId: string
  suggestionId: string
  suggestionKey: string
  suggestionTitle: string
  state: SuggestionFeedbackState
  currentAreaLabel: string
  currentHref?: string
  clientLabel: string
  campaignLabel?: string | null
  taskLabel?: string | null
  packageLabel?: string | null
  recordedAt: string
  source: 'workbench_beta'
}

function isSuggestionFeedbackEvent(value: unknown): value is SuggestionFeedbackEvent {
  if (!value || typeof value !== 'object') return false

  const row = value as Record<string, unknown>
  return (
    typeof row.localId === 'string' &&
    typeof row.clientId === 'string' &&
    typeof row.suggestionId === 'string' &&
    typeof row.suggestionKey === 'string' &&
    typeof row.suggestionTitle === 'string' &&
    typeof row.state === 'string' &&
    typeof row.currentAreaLabel === 'string' &&
    typeof row.clientLabel === 'string' &&
    typeof row.recordedAt === 'string' &&
    typeof row.source === 'string'
  )
}

function readQueue(): SuggestionFeedbackEvent[] {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    return parsed.filter(isSuggestionFeedbackEvent)
  } catch {
    return []
  }
}

function writeQueue(events: SuggestionFeedbackEvent[]) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(events))
  } catch {
    // Ignore storage errors so the workbench never blocks the page.
  }
}

function makeLocalId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `feedback-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function useWorkbenchSuggestionEvents() {
  const [pendingCount, setPendingCount] = useState(0)
  const flushingRef = useRef(false)

  const flushQueue = useCallback(async () => {
    if (flushingRef.current) return

    const initialQueue = readQueue()
    if (initialQueue.length === 0) {
      setPendingCount(0)
      return
    }

    flushingRef.current = true
    try {
      let queue = initialQueue

      while (queue.length > 0) {
        const event = queue[0]
        const res = await fetch(`/api/clients/${event.clientId}/workbench-feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(event),
        })

        if (!res.ok) break

        queue = queue.slice(1)
        writeQueue(queue)
      }

      setPendingCount(queue.length)
    } catch {
      setPendingCount(readQueue().length)
    } finally {
      flushingRef.current = false
    }
  }, [])

  useEffect(() => {
    const queue = readQueue()
    setPendingCount(queue.length)
    void flushQueue()
  }, [flushQueue])

  const trackFeedbackEvent = useCallback((event: Omit<SuggestionFeedbackEvent, 'localId' | 'recordedAt' | 'source'>) => {
    const nextEvent: SuggestionFeedbackEvent = {
      ...event,
      localId: makeLocalId(),
      recordedAt: new Date().toISOString(),
      source: 'workbench_beta',
    }

    const nextQueue = [...readQueue(), nextEvent]
    writeQueue(nextQueue)
    setPendingCount(nextQueue.length)
    void flushQueue()
  }, [flushQueue])

  return {
    pendingCount,
    trackFeedbackEvent,
    flushQueue,
  }
}
