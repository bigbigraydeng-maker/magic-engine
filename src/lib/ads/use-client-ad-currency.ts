'use client'

import { useEffect, useState } from 'react'

/** Currency already resolved by the snapshots route (ad account, else client country). */
export function useClientAdCurrency(clientId: string | null | undefined): string | null {
  const [currency, setCurrency] = useState<string | null>(null)
  useEffect(() => {
    if (!clientId) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/meta-ads/snapshots?limit=1`)
        if (!res.ok) return
        const body = await res.json() as { currency?: string | null }
        if (!cancelled) setCurrency(body.currency ?? null)
      } catch {
        if (!cancelled) setCurrency(null)
      }
    })()
    return () => { cancelled = true }
  }, [clientId])
  return currency
}
