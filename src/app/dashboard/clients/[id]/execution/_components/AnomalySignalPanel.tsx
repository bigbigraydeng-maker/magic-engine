'use client'

/**
 * AnomalySignalPanel
 *
 * Displays active anomaly signals (high / medium severity) detected by the
 * Phase 22.D AnomalyDetector rules engine.  Rendered at the top of the
 * execution kanban so FDE can immediately spot metric drops before acting.
 *
 * - Fetches from GET /api/clients/[id]/anomaly-signals
 * - Only shows when there are high or medium severity, non-dismissed signals
 * - "× 全部忽略" calls PATCH to dismiss all visible signals
 */

import { useEffect, useState } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type SignalSeverity = 'high' | 'medium' | 'low'
type SignalStatus   = 'fresh' | 'processed' | 'dismissed'
type Flywheel       = 'seo' | 'geo' | 'ads' | 'social'

interface AnomalySignal {
  id:              string
  client_id:       string
  flywheel:        Flywheel
  metric_key:      string
  rule_id:         string
  severity:        SignalSeverity
  current_value:   number
  reference_value: number
  delta_pct:       number
  description:     string
  status:          SignalStatus
  created_at:      string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SEVERITY_META: Record<SignalSeverity, { label: string; cls: string }> = {
  high:   { label: '高危', cls: 'bg-red-100 text-red-700 border-red-200' },
  medium: { label: '中危', cls: 'bg-orange-100 text-orange-700 border-orange-200' },
  low:    { label: '低危', cls: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
}

const FLYWHEEL_META: Record<Flywheel, { label: string; cls: string }> = {
  seo:    { label: 'SEO',    cls: 'bg-blue-100 text-blue-700' },
  geo:    { label: 'GEO',    cls: 'bg-purple-100 text-purple-700' },
  ads:    { label: 'Ads',    cls: 'bg-emerald-100 text-emerald-700' },
  social: { label: 'Social', cls: 'bg-pink-100 text-pink-700' },
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AnomalySignalPanel({ clientId }: { clientId: string }) {
  const [signals, setSignals]     = useState<AnomalySignal[]>([])
  const [loaded, setLoaded]       = useState(false)
  const [dismissing, setDismissing] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/anomaly-signals?limit=20`)
        if (!res.ok) return
        const data = await res.json() as { success: boolean; signals: AnomalySignal[] }
        if (!cancelled && data.success) {
          // Only surface high / medium signals — low is ambient noise
          setSignals(data.signals.filter(s => s.severity !== 'low'))
        }
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => { cancelled = true }
  }, [clientId])

  // Nothing to show
  if (!loaded || signals.length === 0) return null

  const handleDismissAll = async () => {
    if (dismissing) return
    setDismissing(true)
    const ids = signals.map(s => s.id)
    try {
      await fetch(`/api/clients/${clientId}/anomaly-signals`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ids, status: 'dismissed' }),
      })
      setSignals([])
    } finally {
      setDismissing(false)
    }
  }

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm leading-none">⚡</span>
          <p className="text-[11px] font-black uppercase tracking-[0.12em] text-red-700">
            系统检测
          </p>
          <span className="inline-flex items-center justify-center rounded-full bg-red-200 text-red-800 text-[10px] font-bold w-5 h-5 leading-none">
            {signals.length}
          </span>
        </div>
        <button
          onClick={() => { void handleDismissAll() }}
          disabled={dismissing}
          className="text-[11px] text-red-500 hover:text-red-700 disabled:opacity-50 transition-colors"
        >
          {dismissing ? '处理中…' : '× 全部忽略'}
        </button>
      </div>

      {/* Signal list */}
      <div className="space-y-2">
        {signals.map(signal => (
          <SignalRow key={signal.id} signal={signal} />
        ))}
      </div>
    </div>
  )
}

// ─── Signal row ───────────────────────────────────────────────────────────────

function SignalRow({ signal }: { signal: AnomalySignal }) {
  const sev = SEVERITY_META[signal.severity] ?? SEVERITY_META.medium
  const fw  = FLYWHEEL_META[signal.flywheel] ?? { label: signal.flywheel, cls: 'bg-slate-100 text-slate-600' }

  const deltaAbs  = Math.abs(signal.delta_pct)
  const deltaSign = signal.delta_pct < 0 ? '▼' : '▲'
  const deltaColor = signal.delta_pct < 0 ? 'text-red-600' : 'text-emerald-600'

  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-white px-3 py-2">
      {/* Severity badge */}
      <span className={`shrink-0 mt-0.5 inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-none ${sev.cls}`}>
        {sev.label}
      </span>

      {/* Flywheel tag */}
      <span className={`shrink-0 mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium leading-none ${fw.cls}`}>
        {fw.label}
      </span>

      {/* Description */}
      <p className="flex-1 text-[12px] text-slate-700 leading-snug min-w-0">
        {signal.description}
      </p>

      {/* Delta */}
      <span className={`shrink-0 text-[12px] font-semibold ${deltaColor} whitespace-nowrap`}>
        {deltaSign} {deltaAbs.toFixed(1)}%
      </span>
    </div>
  )
}
