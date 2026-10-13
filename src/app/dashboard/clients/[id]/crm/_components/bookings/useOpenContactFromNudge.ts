'use client'

/**
 * Hook that opens a guest's drawer from a click in the reminder list.
 *
 * The CRM page only keeps one page of guests in memory, so the guest may
 * not be loaded yet. When that happens we search the page list by the
 * guest's name first and open the drawer once the filtered list has
 * loaded.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export interface OpenContactArgs {
  contactIds: string[]
  loading: boolean
  sectionsLoading: boolean
  debouncedQuery: string
  setQuery: (q: string) => void
  openDrawer: (contactId: string) => void
  notify: (message: string) => void
}

interface PendingContact {
  contactId: string
  query: string
  started: boolean
}

const NOT_ON_PAGE_MESSAGE = '这个人不在当前这一页，请用上面的搜索框找他。'
const NOT_IN_LIST_MESSAGE = '他不在这份名单里了 —— 用上面的搜索框找找看'
const PENDING_TIMEOUT_MS = 8000

export function useOpenContactFromNudge(
  args: OpenContactArgs,
): (contactId: string, contactName: string | null) => void {
  const argsRef = useRef(args)
  argsRef.current = args

  const [pending, setPending] = useState<PendingContact | null>(null)

  useEffect(() => {
    if (!pending) return

    const current = argsRef.current
    if (current.debouncedQuery !== pending.query) return

    if (current.loading || current.sectionsLoading) {
      if (!pending.started) setPending({ ...pending, started: true })
      return
    }

    if (!pending.started) return

    if (current.contactIds.includes(pending.contactId)) {
      current.openDrawer(pending.contactId)
    } else {
      current.notify(NOT_IN_LIST_MESSAGE)
    }
    setPending(null)
  }, [pending, args.contactIds, args.loading, args.sectionsLoading, args.debouncedQuery])

  const pendingId = pending?.contactId ?? null

  useEffect(() => {
    if (pendingId === null) return

    const timer = setTimeout(() => {
      argsRef.current.notify(NOT_IN_LIST_MESSAGE)
      setPending(null)
    }, PENDING_TIMEOUT_MS)

    return () => {
      clearTimeout(timer)
    }
  }, [pendingId])

  return useCallback((contactId: string, contactName: string | null) => {
    const current = argsRef.current

    if (current.contactIds.includes(contactId)) {
      current.openDrawer(contactId)
      return
    }

    const trimmed = contactName?.trim() ?? ''
    if (trimmed.length === 0) {
      current.notify(NOT_ON_PAGE_MESSAGE)
      return
    }

    if (current.debouncedQuery === trimmed) {
      current.notify(NOT_IN_LIST_MESSAGE)
      setPending(null)
      return
    }

    setPending({ contactId, query: trimmed, started: false })
    current.setQuery(trimmed)
  }, [])
}
