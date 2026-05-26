'use client'

import { useEffect, useState } from 'react'

const API_KEY = process.env.NEXT_PUBLIC_INTERNAL_API_KEY ?? ''

// ─── Types ────────────────────────────────────────────────────────────────────

interface GscSnapshot {
  id: string
  site_url: string
  period_start: string
  period_end: string
  total_clicks: number
  total_impressions: number
  avg_ctr: number
  avg_position: number
  top_queries: Array<{ query?: string; clicks: number; impressions: number }>
  synced_at: string
}

interface Ga4Snapshot {
  id: string
  property_id: string
  period_start: string
  period_end: string
  total_sessions: number
  total_users: number
  total_pageviews: number
  bounce_rate: number
  top_sources: Array<{ source: string; medium: string; sessions: number }>
  synced_at: string
}

// ─── Main component ───────────────────────────────────────────────────────────

export function DataPullbackSection({ clientId }: { clientId: string }) {
  const [gsc, setGsc] = useState<GscSnapshot | null>(null)
  const [ga4, setGa4] = useState<Ga4Snapshot | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [gscRes, ga4Res] = await Promise.allSettled([
        fetch(`/api/clients/${clientId}/gsc/snapshots?limit=1`, {
          headers: { Authorization: `Bearer ${API_KEY}` },
        }),
        fetch(`/api/clients/${clientId}/ga4/snapshots?limit=1`, {
          headers: { Authorization: `Bearer ${API_KEY}` },
        }),
      ])

      if (cancelled) return

      if (gscRes.status === 'fulfilled' && gscRes.value.ok) {
        const data = await gscRes.value.json() as { latest: GscSnapshot | null }
        setGsc(data.latest ?? null)
      }
      if (ga4Res.status === 'fulfilled' && ga4Res.value.ok) {
        const data = await ga4Res.value.json() as { latest: Ga4Snapshot | null }
        setGa4(data.latest ?? null)
      }
      setLoaded(true)
    })()
    return () => { cancelled = true }
  }, [clientId])

  if (!loaded || (!gsc && !ga4)) return null

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">
          数据回流
        </p>
        <a
          href={`/dashboard/clients/${clientId}/connectors`}
          className="text-[11px] text-indigo-500 hover:underline"
        >
          管理数据源 →
        </a>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {gsc && <GscCard snapshot={gsc} clientId={clientId} />}
        {ga4 && <Ga4Card snapshot={ga4} clientId={clientId} />}
      </div>
    </div>
  )
}

// ─── GSC card ─────────────────────────────────────────────────────────────────

function GscCard({ snapshot, clientId }: { snapshot: GscSnapshot; clientId: string }) {
  const syncedLabel = new Date(snapshot.synced_at).toLocaleDateString('en-NZ', {
    day: 'numeric', month: 'short',
  })
  const topQueries = snapshot.top_queries.slice(0, 3)
  const period = `${snapshot.period_start} – ${snapshot.period_end}`

  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
      <div className="flex items-center gap-1.5 mb-2.5">
        <span className="text-base leading-none">🔎</span>
        <p className="text-xs font-semibold text-slate-800">Search Console</p>
        <span className="ml-auto text-[10px] text-slate-400">同步 {syncedLabel}</span>
      </div>

      <div className="grid grid-cols-2 gap-1.5 mb-2.5">
        <MetricTile label="点击量"  value={fmtNum(snapshot.total_clicks)} />
        <MetricTile label="展示量"  value={fmtNum(snapshot.total_impressions)} />
        <MetricTile label="平均 CTR" value={`${(snapshot.avg_ctr * 100).toFixed(1)}%`} />
        <MetricTile label="平均排名" value={snapshot.avg_position.toFixed(1)} />
      </div>

      {topQueries.length > 0 && (
        <div className="mb-2">
          <p className="text-[10px] font-medium text-slate-400 mb-1">热门关键词（过去 28 天）</p>
          <div className="space-y-0.5">
            {topQueries.map((q, i) => (
              <div key={i} className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-600 truncate">{q.query ?? '—'}</span>
                <span className="text-[10px] text-slate-400 whitespace-nowrap shrink-0">
                  {fmtNum(q.clicks)} 点击
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-100">
        <span className="text-[10px] text-slate-400">{period}</span>
        <a
          href={`/dashboard/clients/${clientId}/connectors/gsc`}
          className="text-[10px] text-indigo-500 hover:text-indigo-700"
        >
          同步新数据 →
        </a>
      </div>
    </div>
  )
}

// ─── GA4 card ─────────────────────────────────────────────────────────────────

function Ga4Card({ snapshot, clientId }: { snapshot: Ga4Snapshot; clientId: string }) {
  const syncedLabel = new Date(snapshot.synced_at).toLocaleDateString('en-NZ', {
    day: 'numeric', month: 'short',
  })
  const topSources = snapshot.top_sources.slice(0, 3)
  const period = `${snapshot.period_start} – ${snapshot.period_end}`

  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
      <div className="flex items-center gap-1.5 mb-2.5">
        <span className="text-base leading-none">📈</span>
        <p className="text-xs font-semibold text-slate-800">Analytics 4</p>
        <span className="ml-auto text-[10px] text-slate-400">同步 {syncedLabel}</span>
      </div>

      <div className="grid grid-cols-2 gap-1.5 mb-2.5">
        <MetricTile label="会话数"  value={fmtNum(snapshot.total_sessions)} />
        <MetricTile label="用户数"  value={fmtNum(snapshot.total_users)} />
        <MetricTile label="页面浏览" value={fmtNum(snapshot.total_pageviews)} />
        <MetricTile label="跳出率"  value={`${(snapshot.bounce_rate * 100).toFixed(1)}%`} />
      </div>

      {topSources.length > 0 && (
        <div className="mb-2">
          <p className="text-[10px] font-medium text-slate-400 mb-1">主要流量来源</p>
          <div className="space-y-0.5">
            {topSources.map((s, i) => (
              <div key={i} className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-600 truncate">
                  {s.source}{s.medium && s.medium !== '(none)' ? ` / ${s.medium}` : ''}
                </span>
                <span className="text-[10px] text-slate-400 whitespace-nowrap shrink-0">
                  {fmtNum(s.sessions)} 会话
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-100">
        <span className="text-[10px] text-slate-400">{period}</span>
        <a
          href={`/dashboard/clients/${clientId}/connectors/ga4`}
          className="text-[10px] text-indigo-500 hover:text-indigo-700"
        >
          同步新数据 →
        </a>
      </div>
    </div>
  )
}

// ─── Shared primitives ────────────────────────────────────────────────────────

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-100 bg-white px-2 py-1.5">
      <p className="text-[9px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-sm font-bold leading-tight text-slate-800">{value}</p>
    </div>
  )
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
