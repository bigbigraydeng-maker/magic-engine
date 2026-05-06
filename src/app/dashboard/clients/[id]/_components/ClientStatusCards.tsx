'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Summary {
  dnz: { crawled: number; failed: number; total: number }
  strategy: { total: number; critical: number; high: number; medium: number; low: number }
  master_brief: { exists: boolean; updated_at: string | null }
  geo: { active_count: number }
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
      ok ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
    }`}>
      {ok ? '✓' : '–'} {label}
    </span>
  )
}

export function ClientStatusCards({ clientId }: { clientId: string }) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/clients/${clientId}/dashboard-summary`)
      .then((r) => r.json())
      .then((d) => { if (d.success) setSummary(d) })
      .finally(() => setLoading(false))
  }, [clientId])

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-20 bg-slate-100 rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  if (!summary) return null

  const { dnz, strategy, master_brief, geo } = summary

  const dnzStatus = dnz.crawled > 0 ? 'done' : 'empty'
  const strategyStatus = strategy.total > 0 ? 'done' : 'empty'

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      {/* DNZ */}
      <Link href={`/dashboard/clients/${clientId}/site-audit`}
        className="bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-300 hover:shadow-sm transition group">
        <div className="text-xs text-slate-500 mb-1 font-medium uppercase tracking-wide">Site Analyzer</div>
        <div className="text-2xl font-bold text-slate-800 group-hover:text-blue-600">
          {dnz.crawled}
          <span className="text-sm font-normal text-slate-400 ml-1">页</span>
        </div>
        <div className="mt-1">
          <StatusBadge ok={dnzStatus === 'done'} label={dnzStatus === 'done' ? '已采集' : '未采集'} />
          {dnz.failed > 0 && (
            <span className="ml-1 text-xs text-amber-500">{dnz.failed} 失败</span>
          )}
        </div>
      </Link>

      {/* Strategy */}
      <Link href={`/dashboard/clients/${clientId}/strategy`}
        className="bg-white border border-slate-200 rounded-xl p-4 hover:border-purple-300 hover:shadow-sm transition group">
        <div className="text-xs text-slate-500 mb-1 font-medium uppercase tracking-wide">策略候选</div>
        <div className="text-2xl font-bold text-slate-800 group-hover:text-purple-600">
          {strategy.total}
          <span className="text-sm font-normal text-slate-400 ml-1">条</span>
        </div>
        <div className="mt-1 flex gap-1 flex-wrap">
          {strategy.critical > 0 && (
            <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-medium">
              {strategy.critical} 紧急
            </span>
          )}
          {strategy.high > 0 && (
            <span className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full font-medium">
              {strategy.high} 高
            </span>
          )}
          {strategy.total === 0 && (
            <StatusBadge ok={false} label="未分析" />
          )}
        </div>
      </Link>

      {/* Master Brief */}
      <Link href={`/dashboard/clients/${clientId}?tab=brief`}
        className="bg-white border border-slate-200 rounded-xl p-4 hover:border-green-300 hover:shadow-sm transition group">
        <div className="text-xs text-slate-500 mb-1 font-medium uppercase tracking-wide">Brand Brief</div>
        <div className="text-2xl font-bold text-slate-800 group-hover:text-green-600">
          {master_brief.exists ? '✓' : '–'}
        </div>
        <div className="mt-1">
          <StatusBadge ok={master_brief.exists} label={master_brief.exists ? '已建档' : '未建档'} />
        </div>
      </Link>

      {/* GEO */}
      <Link href={`/dashboard/clients/${clientId}?tab=brief`}
        className="bg-white border border-slate-200 rounded-xl p-4 hover:border-teal-300 hover:shadow-sm transition group">
        <div className="text-xs text-slate-500 mb-1 font-medium uppercase tracking-wide">GEO 指令</div>
        <div className="text-2xl font-bold text-slate-800 group-hover:text-teal-600">
          {geo.active_count}
          <span className="text-sm font-normal text-slate-400 ml-1">条</span>
        </div>
        <div className="mt-1">
          <StatusBadge ok={geo.active_count > 0} label={geo.active_count > 0 ? '已注入' : '未注入'} />
        </div>
      </Link>
    </div>
  )
}
