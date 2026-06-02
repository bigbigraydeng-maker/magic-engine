'use client'

import { useEffect, useState } from 'react'

const STORAGE_KEY = 'me:zhuge-recent-threads:v1'
const MAX_THREADS = 5

export interface RecentWorkbenchThread {
  clientId: string
  clientLabel: string
  currentAreaLabel: string
  campaignLabel?: string | null
  taskLabel?: string | null
  packageLabel?: string | null
  href: string
  savedAt: string
}

function isRecentThread(value: unknown): value is RecentWorkbenchThread {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.clientId === 'string' &&
    typeof row.clientLabel === 'string' &&
    typeof row.currentAreaLabel === 'string' &&
    typeof row.href === 'string' &&
    typeof row.savedAt === 'string'
  )
}

function readThreads(): RecentWorkbenchThread[] {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    return parsed.filter(isRecentThread).slice(0, MAX_THREADS)
  } catch {
    return []
  }
}

function writeThreads(threads: RecentWorkbenchThread[]) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(threads.slice(0, MAX_THREADS)))
  } catch {
    // Ignore storage errors so the workbench never blocks the page.
  }
}

export function useRecentWorkbenchThreads(currentThread: Omit<RecentWorkbenchThread, 'savedAt'> | null) {
  const [threads, setThreads] = useState<RecentWorkbenchThread[]>([])

  useEffect(() => {
    setThreads(readThreads())
  }, [])

  useEffect(() => {
    if (!currentThread) return

    const nextThread: RecentWorkbenchThread = {
      ...currentThread,
      savedAt: new Date().toISOString(),
    }

    const nextThreads = [
      nextThread,
      ...readThreads().filter(thread => thread.href !== currentThread.href),
    ].slice(0, MAX_THREADS)

    writeThreads(nextThreads)
    setThreads(nextThreads)
  }, [currentThread])

  return threads.filter(thread => !currentThread || thread.href !== currentThread.href)
}
