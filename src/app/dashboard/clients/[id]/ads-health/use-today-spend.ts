'use client'

import { useEffect, useState } from 'react'
import type { LiveTodayView } from '@/lib/ads-strategy/heartbeat/live-view'

export interface TodaySpendSummary {
  spendToday: number | null
  capMajor: number | null
  currency: string | null
  readAtIso: string | null
}

const EMPTY: TodaySpendSummary = { spendToday: null, capMajor: null, currency: null, readAtIso: null }

function sumSpendToday(view: LiveTodayView): { spend: number | null; currency: string | null } {
  let sum = 0
  let any = false
  const currencies = new Set<string>()
  for (const acc of view.accounts) {
    if (acc.readState === 'unreadable') continue
    for (const a of acc.active) {
      if (a.spendToday === null) continue
      sum += a.spendToday
      any = true
      if (acc.currency) currencies.add(acc.currency)
    }
  }
  if (!any) return { spend: null, currency: currencies.size === 1 ? [...currencies][0] : null }
  return { spend: sum, currency: currencies.size === 1 ? [...currencies][0] : null }
}

export function useTodaySpend(clientId: string): TodaySpendSummary {
  const [out, setOut] = useState<TodaySpendSummary>(EMPTY)

  useEffect(() => {
    let alive = true
    Promise.all([
      fetch(`/api/clients/${clientId}/ad-health/live`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null),
      fetch(`/api/clients/${clientId}/ad-accounts`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null),
    ])
      .then(([liveJson, acctJson]) => {
        if (!alive) return
        const view = (liveJson as { view?: LiveTodayView } | null)?.view ?? null
        const capCents = (acctJson as { client_total_cap_cents?: unknown } | null)?.client_total_cap_cents
        const capMajor = typeof capCents === 'number' ? capCents / 100 : null
        if (!view) {
          setOut({ ...EMPTY, capMajor })
          return
        }
        const { spend, currency } = sumSpendToday(view)
        setOut({
          spendToday: spend,
          capMajor,
          currency,
          readAtIso: view.readAtIso ?? null,
        })
      })
      .catch(() => { if (alive) setOut(EMPTY) })
    return () => { alive = false }
  }, [clientId])

  return out
}
