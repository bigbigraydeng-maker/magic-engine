'use client'

/**
 * Which gated entries the CRM top nav may show. Moved here unchanged from CrmTabs
 * (付款总览 / 销售进度 / 邮件模板 used to be tabs there); the rules are the same:
 *
 *  - 付款总览 / 销售进度 / 到期日历: only when the bookings-access probe answers 200.
 *    403 / 404 / error / not back yet => hidden (we do not reveal that the feature exists).
 *    Answers 200/403/404 are cached per client for 5 minutes; errors are never cached.
 *  - 邮件模板: only when the feature is ready, or I am an admin who can configure it.
 *
 * Both probes wait for the customer list to load first (afterCrmListReady), so they never
 * compete with it for the server.
 */

import { useEffect, useState } from 'react'
import { afterCrmListReady } from '@/lib/crm/list-ready'

const PROBE_TTL_MS = 5 * 60 * 1000
const bookingsCache = new Map<string, { ok: boolean; at: number }>()
const templatesCache = new Map<string, { show: boolean; at: number }>()

/** Test hook: forget every cached probe answer. */
export function resetCrmNavProbeCache(): void {
  bookingsCache.clear()
  templatesCache.clear()
}

function fresh<T extends { at: number }>(hit: T | undefined): T | null {
  return hit !== undefined && Date.now() - hit.at <= PROBE_TTL_MS ? hit : null
}

export function useBookingsAccess(clientId: string): boolean {
  const [allowed, setAllowed] = useState(() => fresh(bookingsCache.get(clientId))?.ok === true)
  useEffect(() => {
    const cached = fresh(bookingsCache.get(clientId))
    setAllowed(cached?.ok === true)
    if (cached !== null) return
    let cancelled = false
    const cancelWait = afterCrmListReady(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/clients/${clientId}/crm/bookings/access`)
          if (res.status === 200 || res.status === 403 || res.status === 404) {
            bookingsCache.set(clientId, { ok: res.status === 200, at: Date.now() })
          }
          if (!cancelled) setAllowed(res.status === 200)
        } catch {
          // Network error: stay hidden and do not cache, so the next page retries.
        }
      })()
    })
    return () => {
      cancelled = true
      cancelWait()
    }
  }, [clientId])
  return allowed
}

export function useTemplatesAccess(clientId: string): boolean {
  const [show, setShow] = useState(() => fresh(templatesCache.get(clientId))?.show === true)
  useEffect(() => {
    const cached = fresh(templatesCache.get(clientId))
    if (cached !== null) {
      setShow(cached.show)
      return
    }
    let cancelled = false
    const cancelWait = afterCrmListReady(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/clients/${clientId}/crm/email-templates`)
          if (!res.ok) return
          const json = (await res.json()) as { featureState?: string; canEditSettings?: boolean }
          const next = json.featureState === 'ready' || json.canEditSettings === true
          templatesCache.set(clientId, { show: next, at: Date.now() })
          if (!cancelled) setShow(next)
        } catch {
          // Cannot read it: hide, and do not cache.
        }
      })()
    })
    return () => {
      cancelled = true
      cancelWait()
    }
  }, [clientId])
  return show
}
