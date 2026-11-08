'use client'
import React from 'react'

// 等 PM 批的加预算：只读列表 + 批准 / 不批
type RawItem = {
  id: string
  status: string
  input: Record<string, unknown> | null
  evidence: Record<string, unknown> | null
  authorization_decision_id: string | null
  created_at: string
}

type Item = {
  id: string
  decisionId: string
  campaignId: string | null
  adsetId: string | null
  beforeCents: number | null
  afterCents: number | null
  currency: string | null
  createdAt: string
}

type Outcome = { kind: 'ok' | 'rejected' | 'error'; text: string }

const readString = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)
const readNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

const money = (c: number | null, currency: string | null): string => {
  if (c === null) return '—'
  return `${currency ?? ''} ${(c / 100).toFixed(2)}`.trim()
}

const submittedAt = (iso: string): string => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '提交时间未知'
  return `提交于 ${d.toLocaleString('zh-CN', { timeZone: 'Pacific/Auckland' })}`
}

// 只留成绩单来的、等批的、带决策 id 的
function toItem(raw: RawItem): Item | null {
  if (raw.status !== 'pending_approval') return null
  if (raw.evidence?.source !== 'ads_health_scorecard') return null
  const decisionId = readString(raw.authorization_decision_id)
  if (decisionId === null) return null
  const input = raw.input ?? {}
  const evidence = raw.evidence ?? {}
  return {
    id: raw.id,
    decisionId,
    campaignId: readString(input.campaign_id),
    adsetId: readString(input.adset_id),
    beforeCents: readNumber(input.before_cents),
    afterCents: readNumber(input.after_cents),
    currency: readString(evidence.currency),
    createdAt: raw.created_at,
  }
}

function targetText(it: Item): string {
  if (it.campaignId !== null) return `系列 ${it.campaignId}`
  if (it.adsetId !== null) return `广告组 ${it.adsetId}`
  return '目标未知'
}

function outcomeFromStatus(status: number, body: unknown): Outcome {
  if (status === 202) return { kind: 'ok', text: '已批，正在改 Meta' }
  if (status === 200) return { kind: 'rejected', text: '已不批' }
  const err = body !== null && typeof body === 'object' ? readString((body as { error?: unknown }).error) : null
  return { kind: 'error', text: err ?? '没有成功，请刷新再看' }
}

type RowProps = {
  item: Item
  busy: boolean
  outcome: Outcome | null
  onDecide: (item: Item, resolution: 'approve' | 'reject') => void
}

function PendingRow({ item, busy, outcome, onDecide }: RowProps): JSX.Element {
  const [reviewed, setReviewed] = React.useState(false)
  const btn = 'rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-700 hover:bg-white disabled:opacity-50'
  return (
    <div className="rounded-lg bg-white px-3 py-2 space-y-1">
      <p className="text-sm text-gray-800">{targetText(item)}</p>
      <p className="text-xs text-gray-700">
        {money(item.beforeCents, item.currency)} → {money(item.afterCents, item.currency)}
      </p>
      <p className="text-xs text-gray-500">{submittedAt(item.createdAt)}</p>
      <label className="flex items-center gap-1 text-xs text-gray-700">
        <input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} disabled={busy} />
        我看过更长周期的表现和 Meta 变更记录
      </label>
      <div className="flex gap-2">
        <button type="button" className={btn} disabled={busy || !reviewed} onClick={() => onDecide(item, 'approve')}>
          批准
        </button>
        <button type="button" className={btn} disabled={busy} onClick={() => onDecide(item, 'reject')}>
          不批
        </button>
      </div>
      {outcome && (
        <p className={`text-xs ${outcome.kind === 'error' ? 'text-red-700' : 'text-gray-700'}`}>{outcome.text}</p>
      )}
    </div>
  )
}

export default function PendingScalePanel(props: { clientId: string; refreshKey: number }): JSX.Element | null {
  const { clientId, refreshKey } = props
  const [items, setItems] = React.useState<Item[] | null>(null)
  const [hidden, setHidden] = React.useState(false)
  const [loadError, setLoadError] = React.useState(false)
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [outcomes, setOutcomes] = React.useState<Record<string, Outcome>>({})
  const [reloadTick, setReloadTick] = React.useState(0)

  React.useEffect(() => {
    let alive = true
    setLoadError(false)
    fetch(`/api/clients/${clientId}/ad-health/o1-scale`)
      .then(async res => {
        if (!alive) return
        if (res.status === 401 || res.status === 403) {
          setHidden(true)
          return
        }
        if (!res.ok) {
          setLoadError(true)
          return
        }
        const body = (await res.json()) as { items?: RawItem[] }
        if (!alive) return
        const list = Array.isArray(body.items) ? body.items : []
        setItems(list.map(toItem).filter((x): x is Item => x !== null))
      })
      .catch(() => {
        if (alive) setLoadError(true)
      })
    return () => {
      alive = false
    }
  }, [clientId, refreshKey, reloadTick])

  const decide = React.useCallback(
    (item: Item, resolution: 'approve' | 'reject') => {
      setBusyId(item.id)
      const payload =
        resolution === 'approve'
          ? { resolution, expectedDecisionId: item.decisionId, historyReviewed: true }
          : { resolution, expectedDecisionId: item.decisionId, reason: '成绩单上不批' }
      fetch(`/api/clients/${clientId}/ad-health/o1-scale/${item.id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then(async res => {
          let body: unknown = null
          try {
            body = await res.json()
          } catch {
            body = null
          }
          setOutcomes(prev => ({ ...prev, [item.id]: outcomeFromStatus(res.status, body) }))
        })
        .catch(() => {
          setOutcomes(prev => ({ ...prev, [item.id]: { kind: 'error', text: '没有成功，请刷新再看' } }))
        })
        .finally(() => {
          setBusyId(null)
          setReloadTick(t => t + 1)
        })
    },
    [clientId],
  )

  if (hidden) return null
  if (loadError) return <p className="text-xs text-red-700">读不到等批的加预算</p>
  if (items === null || items.length === 0) return null

  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
      <h3 className="text-sm font-semibold text-gray-800">等 PM 批的加预算（{items.length} 条）</h3>
      <p className="text-xs text-gray-600">只有 PM 本人能批；批了几分钟内会改 Meta 并回读。</p>
      {items.map(it => (
        <PendingRow key={it.id} item={it} busy={busyId === it.id} outcome={outcomes[it.id] ?? null} onDecide={decide} />
      ))}
    </section>
  )
}
