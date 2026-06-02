'use client'

import { useEffect, useMemo, useState } from 'react'

const STORAGE_KEY = 'me:zhuge-suggestion-feedback:v1'

export type SuggestionFeedbackState = 'done' | 'dismissed' | 'irrelevant'

export interface SuggestionFeedbackEntry {
  clientId: string
  suggestionId: string
  suggestionKey: string
  state: SuggestionFeedbackState
  savedAt: string
}

function isFeedbackEntry(value: unknown): value is SuggestionFeedbackEntry {
  if (!value || typeof value !== 'object') return false

  const row = value as Record<string, unknown>
  return (
    typeof row.clientId === 'string' &&
    typeof row.suggestionId === 'string' &&
    typeof row.suggestionKey === 'string' &&
    typeof row.state === 'string' &&
    typeof row.savedAt === 'string'
  )
}

function readFeedback(): SuggestionFeedbackEntry[] {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    return parsed.filter(isFeedbackEntry)
  } catch {
    return []
  }
}

function writeFeedback(entries: SuggestionFeedbackEntry[]) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // Ignore storage errors so the workbench never blocks the page.
  }
}

export function useWorkbenchSuggestionFeedback(clientId?: string) {
  const [entries, setEntries] = useState<SuggestionFeedbackEntry[]>([])

  useEffect(() => {
    setEntries(readFeedback())
  }, [])

  const visibleEntries = useMemo(
    () => entries.filter(entry => !clientId || entry.clientId === clientId),
    [clientId, entries],
  )

  const suppressedKeys = useMemo(
    () => new Set(visibleEntries.map(entry => entry.suggestionKey)),
    [visibleEntries],
  )

  const recordFeedback = (entry: Omit<SuggestionFeedbackEntry, 'savedAt'>) => {
    const nextEntry: SuggestionFeedbackEntry = {
      ...entry,
      savedAt: new Date().toISOString(),
    }

    const nextEntries = [
      nextEntry,
      ...readFeedback().filter(saved => saved.suggestionKey !== entry.suggestionKey),
    ]

    writeFeedback(nextEntries)
    setEntries(nextEntries)
  }

  const clearFeedbackForKeys = (suggestionKeys: string[]) => {
    if (suggestionKeys.length === 0) return

    const nextEntries = readFeedback().filter(entry => !suggestionKeys.includes(entry.suggestionKey))
    writeFeedback(nextEntries)
    setEntries(nextEntries)
  }

  return {
    suppressedKeys,
    recordFeedback,
    clearFeedbackForKeys,
    visibleEntries,
  }
}
