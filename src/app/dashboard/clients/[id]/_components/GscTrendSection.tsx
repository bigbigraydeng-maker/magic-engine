'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

// ─── Types ────────────────────────────────────────────────────────────────────

interface GscTrendPoint {
  period_end: string
  total_clicks: number
  avg_position: number
}

interface GscSnapshotsResponse {
  snapshots: Array<{
    total_clicks: number
    total_impressions: number
    avg_ctr: number
    avg_position: number
    period_end: string
    period_start: string
    synced_at: string
    top_queries: unknown[]
    top_pages: unknown[]
  }>
  latest: unknown | null
}

// ─── Sparkline SVG ────────────────────────────────────────────────────────────

function Sparkline({
  values,
  inverted = false,
  color,
  gradId,
}: {
  values: number[]
  inverted?: boolean
  color: string
  gradId: string
}) {
  if (values.length < 2) return null

  const w = 160
  const h = 40
  const pad = 3

  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1

  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2)
    const normalized = inverted ? (max - v) / range : (v - min) / range
    const y = pad + (1 - normalized) * (h - pad * 2)
    return { x, y }
  })

  const polylineStr = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')

  const areaPath =
    `M ${pts[0].x.toFixed(1)},${(h - pad).toFixed(1)} ` +
    pts.map(p => `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') +
    ` L ${pts[pts.length - 1].x.toFixed(1)},${(h - pad).toFixed(1)} Z`

  const last = pts[pts.length - 1]

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxWidth: 160, height: h }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <polyline points={polylineStr} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last.x.toFixed(1)} cy={last.y.toFixed(1)} r="2.5" fill={color} />
    </svg>
  )
}

// ─── Trend row ────────────────────────────────────────────────────────────────

function TrendRow({ date, value }: { date: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 px-1 py-1 text-[11px]">
      <span className="font-mono text-slate-400">{date}</span>
      <span className="font-bold tabular-nums text-slate-700">{value}</span>
    </div>
  )
}

// ─── Delta helper ─────────────────────────────────────────────────────────────

function computeDelta(
  cur: number,
  prev: number | null,
  inverted = false,
): { label: string; cls: string } | null {
  if (prev == null) return null
  const diff = cur - prev
  if (diff === 0) return null
  const positive = inverted ? diff < 0 : diff > 0
  const abs = Math.abs(diff)
  const label = `${positive ? '+' : '-'}${abs % 1 === 0 ? abs : abs.toFixed(1)}`
  return { label, cls: positive ? 'text-emerald-600' : 'text-red-500' }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function GscTrendSection({ clientId }: { clientId: string }) {
  const [points, setPoints] = useState<GscTrendPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/gsc/snapshots?limit=12`)
        if (!res.ok) { setError(true); return }
        const body = await res.json() as GscSnapshotsResponse
        if (cancelled) return
        const mapped: GscTrendPoint[] = (body.snapshots ?? [])
          .map(s => ({
            period_end: s.period_end,
            total_clicks: s.total_clicks,
            avg_position: s.avg_position,
          }))
          .sort((a, b) => a.period_end.localeCompare(b.period_end))
        setPoints(mapped)
      } catch {
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [clientId])

  if (loading) {
    return (
      <div className="animate-pulse rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-3 h-3 w-44 rounded bg-slate-100" />
        <div className="h-20 rounded bg-slate-50" />
      </div>
    )
  }

  if (error || points.length === 0) {
    return (
      <div className="flex items-center justify-between gap-4 rounded-xl border border-dashed border-slate-200 bg-white p-5">
        <div>
          <p className="text-sm font-black text-slate-500">暂无 GSC 历史趋势数据</p>
          <p className="mt-0.5 text-[11px] text-slate-400">
            请先连接 Google Search Console 并完成至少一次同步
          </p>
        </div>
        <Link
          href={`/dashboard/clients/${clientId}/connectors`}
          className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-black text-slate-600 transition-colors hover:bg-slate-50"
        >
          前往连接 →
        </Link>
      </div>
    )
  }

  const clickValues = points.map(p => p.total_clicks)
  const posValues   = points.map(p => p.avg_position)

  const latest = points[points.length - 1]
  const prev   = points.length >= 2 ? points[points.length - 2] : null

  const clickDelta = computeDelta(latest.total_clicks, prev?.total_clicks ?? null)
  const posDelta   = computeDelta(latest.avg_position, prev?.avg_position ?? null, true)

  function fmtClicks(n: number): string {
    return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n)
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="text-base leading-none">📊</span>
        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-cyan-800">
          搜索洞察 历史趋势
        </p>
        <span className="ml-auto text-[10px] text-slate-400">最近 {points.length} 期</span>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {/* Clicks */}
        <div>
          <div className="mb-1 flex items-baseline gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">总点击量</p>
            <span className="text-lg font-black tabular-nums text-slate-800">
              {fmtClicks(latest.total_clicks)}
            </span>
            {clickDelta && (
              <span className={`text-[11px] font-bold ${clickDelta.cls}`}>{clickDelta.label}</span>
            )}
          </div>
          <Sparkline values={clickValues} color="#6366f1" gradId="gsc-clicks-grad" />
          <div className="mt-2 max-h-28 divide-y divide-slate-50 overflow-y-auto rounded border border-slate-50">
            {[...points].reverse().map(p => (
              <TrendRow key={p.period_end} date={p.period_end} value={fmtClicks(p.total_clicks)} />
            ))}
          </div>
        </div>

        {/* Avg position — lower is better */}
        <div>
          <div className="mb-1 flex items-baseline gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">平均排名</p>
            <span className="text-lg font-black tabular-nums text-slate-800">
              {latest.avg_position.toFixed(1)}
            </span>
            {posDelta && (
              <span className={`text-[11px] font-bold ${posDelta.cls}`}>{posDelta.label}</span>
            )}
            <span className="text-[10px] text-slate-300">越小越好</span>
          </div>
          <Sparkline values={posValues} inverted color="#f59e0b" gradId="gsc-pos-grad" />
          <div className="mt-2 max-h-28 divide-y divide-slate-50 overflow-y-auto rounded border border-slate-50">
            {[...points].reverse().map(p => (
              <TrendRow key={p.period_end} date={p.period_end} value={p.avg_position.toFixed(1)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
