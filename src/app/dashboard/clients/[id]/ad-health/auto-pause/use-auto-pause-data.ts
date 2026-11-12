'use client'

import { useCallback, useEffect, useState } from 'react'
import { toCardPayload, type CardPayload } from '@/components/confirmation-card/HeldCards'

export interface PendingItem {
  readonly runId: string
  readonly expectedDecisionId: string | null
  readonly adsetId: string | null
  readonly adsetName: string | null
  readonly adAccountId: string | null
  readonly diagnosisTitle: string | null
  readonly insightDate: string | null
  readonly createdAt: string
}

export interface LedgerAction {
  readonly id: string
  readonly executedAt: string | null
  readonly status: string
  readonly adsetName: string | null
  readonly diagnosisTitle: string | null
  readonly actionRunId: string | null
  readonly reason: string | null
}

export interface AutoPauseSnapshot {
  readonly pending: PendingItem[] | null
  readonly hasMore: boolean
  readonly cards: CardPayload[]
  readonly ledger: LedgerAction[]
  readonly dryRun: boolean | null
  readonly error: string | null
}

function readLedger(rows: unknown): LedgerAction[] {
  if (!rows || typeof rows !== 'object') return []
  const actions = (rows as { actions?: unknown }).actions
  if (!Array.isArray(actions)) return []
  const out: LedgerAction[] = []
  for (const row of actions) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    if (r.action_type !== 'ads.auto_pause_on_d3') continue
    const payload = r.payload && typeof r.payload === 'object' ? r.payload as Record<string, unknown> : null
    const status = typeof payload?.status === 'string' ? payload.status : ''
    if (!status || status === 'dry_run_logged') continue
    out.push({
      id: typeof r.id === 'string' ? r.id : '',
      executedAt: typeof r.executed_at === 'string' ? r.executed_at : null,
      status,
      adsetName: typeof payload?.adset_name === 'string' ? payload.adset_name : null,
      diagnosisTitle: typeof payload?.diagnosis_title === 'string' ? payload.diagnosis_title : null,
      actionRunId: typeof payload?.action_run_id === 'string' ? payload.action_run_id : null,
      reason: typeof payload?.reason === 'string' ? payload.reason : null,
    })
  }
  return out
}

export function useAutoPauseData(clientId: string): AutoPauseSnapshot & { reload: () => void } {
  const [pending, setPending] = useState<PendingItem[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [cards, setCards] = useState<CardPayload[]>([])
  const [ledger, setLedger] = useState<LedgerAction[]>([])
  const [dryRun, setDryRun] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [pendingRes, cardsRes, actionsRes, configRes] = await Promise.all([
        fetch(`/api/clients/${clientId}/ad-health/auto-pause`, { cache: 'no-store' }),
        fetch(`/api/clients/${clientId}/confirmation-cards`, { cache: 'no-store' }),
        fetch(`/api/clients/${clientId}/meta-ads/actions?limit=50`, { cache: 'no-store' }),
        fetch(`/api/clients/${clientId}/ad-strategy-config`, { cache: 'no-store' }),
      ])
      if (!pendingRes.ok) {
        setError(`读取暂停建议失败（${pendingRes.status}）`)
        return
      }
      const pendingJson = await pendingRes.json()
      setPending(pendingJson.items ?? [])
      setHasMore(pendingJson.hasMore === true)
      if (cardsRes.ok) {
        const cardsJson = await cardsRes.json()
        const parsed = (cardsJson.cards ?? []).map(toCardPayload).filter(Boolean) as CardPayload[]
        setCards(parsed.filter((c) => c.status === 'waiting' && /暂停/.test(`${c.what} ${c.scope}`)))
      } else {
        setCards([])
      }
      if (actionsRes.ok) {
        const actionsJson = await actionsRes.json()
        setLedger(readLedger(actionsJson))
      } else {
        setLedger([])
      }
      if (configRes.ok) {
        const cfg = await configRes.json()
        const row = cfg?.config && typeof cfg.config === 'object' ? cfg.config as Record<string, unknown> : null
        setDryRun(row?.autopilot_dry_run === true)
      } else {
        setDryRun(null)
      }
      setError(null)
    } catch {
      setError('读取失败，请检查网络后点「重试」')
    }
  }, [clientId])

  useEffect(() => {
    if (clientId) void load()
  }, [clientId, load])

  return { pending, hasMore, cards, ledger, dryRun, error, reload: load }
}
