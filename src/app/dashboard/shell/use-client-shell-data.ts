'use client'

import { useEffect, useMemo, useState } from 'react'
import { normalizeGoalList } from '@/lib/strategy/normalize'
import type { GoalRow } from '@/types/strategy'

export type ClientListRow = {
  id: string
  name: string
  domain: string | null
  plan_tier?: string | null
}

export function useClientShellData(clientId: string | null) {
  const [clients, setClients] = useState<ClientListRow[]>([])
  const [industry, setIndustry] = useState<string | null>(null)
  const [goalHref, setGoalHref] = useState<string | null>(null)
  const [currentName, setCurrentName] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/clients', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => {
        if (!cancelled) setClients(j.clients ?? [])
      })
      .catch(() => {
        if (!cancelled) setClients([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!clientId) {
      setIndustry(null)
      setGoalHref(null)
      setCurrentName(null)
      return
    }
    const row = clients.find((c) => c.id === clientId)
    if (row) setCurrentName(row.name)

    let cancelled = false
    fetch(`/api/clients/${clientId}/industry`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => {
        if (!cancelled) setIndustry((j.industry as string | null) ?? null)
      })
      .catch(() => {
        if (!cancelled) setIndustry(null)
      })

    fetch(`/api/clients/${clientId}/goals/active-list`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => {
        if (cancelled) return
        const goals = normalizeGoalList((j.goals ?? []) as GoalRow[])
        const href =
          goals.length > 0
            ? `/dashboard/clients/${clientId}/goal/${goals[0].id}`
            : `/dashboard/clients/${clientId}/goal/new`
        setGoalHref(href)
      })
      .catch(() => {
        if (!cancelled) setGoalHref(`/dashboard/clients/${clientId}/goal/new`)
      })

    return () => {
      cancelled = true
    }
  }, [clientId, clients])

  const resolvedGoalHref = useMemo(
    () => goalHref ?? (clientId ? `/dashboard/clients/${clientId}/goal/new` : '/dashboard'),
    [clientId, goalHref],
  )

  return { clients, industry, goalHref: resolvedGoalHref, currentName }
}
