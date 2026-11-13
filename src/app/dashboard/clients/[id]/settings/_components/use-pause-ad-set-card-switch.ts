'use client'

/**
 * Read/write the per-client «暂停广告组确认卡» switch via
 * GET/POST /api/clients/[id]/ad-strategy-config/pause-ad-set-card.
 */

import { useCallback, useEffect, useState } from 'react'

export type PauseAdSetCardSwitchPhase = 'loading' | 'error' | 'ready'

export interface UsePauseAdSetCardSwitchResult {
  phase: PauseAdSetCardSwitchPhase
  enabled: boolean
  loadError: string | null
  saving: boolean
  saveError: string | null
  reload: () => Promise<void>
  toggle: (next: boolean) => Promise<void>
}

function apiBase(clientId: string): string {
  return `/api/clients/${clientId}/ad-strategy-config/pause-ad-set-card`
}

export function usePauseAdSetCardSwitch(clientId: string): UsePauseAdSetCardSwitchResult {
  const [phase, setPhase] = useState<PauseAdSetCardSwitchPhase>('loading')
  const [enabled, setEnabled] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setPhase('loading')
    setLoadError(null)
    try {
      const res = await fetch(apiBase(clientId), { cache: 'no-store' })
      const json = (await res.json().catch(() => ({}))) as { enabled?: boolean; error?: string }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setEnabled(json.enabled === true)
      setPhase('ready')
    } catch (err) {
      setPhase('error')
      setLoadError(err instanceof Error ? err.message : String(err))
    }
  }, [clientId])

  useEffect(() => {
    void reload()
  }, [reload])

  const toggle = useCallback(
    async (next: boolean) => {
      if (phase !== 'ready') return
      setSaving(true)
      setSaveError(null)
      const prev = enabled
      setEnabled(next)
      try {
        const res = await fetch(apiBase(clientId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: next }),
        })
        const json = (await res.json().catch(() => ({}))) as { enabled?: boolean; error?: string }
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
        setEnabled(json.enabled === true)
      } catch (err) {
        setEnabled(prev)
        setSaveError(err instanceof Error ? err.message : String(err))
      } finally {
        setSaving(false)
      }
    },
    [clientId, enabled, phase],
  )

  return { phase, enabled, loadError, saving, saveError, reload, toggle }
}
