'use client'

/**
 * 「今天每小时进线」卡 —— 读 /api/clients/[id]/ad-health/hourly-leads，只展示。
 */

import React, { useEffect, useState } from 'react'
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { HourlyLeadChart } from '@/lib/ads-strategy/hourly-meta-leads'

type StaffPayload = {
  unreadable: boolean
  message?: string
  chart?: HourlyLeadChart
  lastSyncAt?: string | null
  jobName?: string
}

type ClientPayload = {
  viewer: 'client'
  unreadable: boolean
  message?: string
  chart?: HourlyLeadChart
  lastSyncLabel?: string | null
}

type Payload = StaffPayload | ClientPayload

function isClient(p: Payload): p is ClientPayload {
  return 'viewer' in p && p.viewer === 'client'
}

function formatSyncStaff(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('zh-CN', {
    timeZone: 'Pacific/Auckland',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export default function HourlyLeadsPanel({ clientId }: { clientId: string }) {
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    fetch(`/api/clients/${clientId}/ad-health/hourly-leads`)
      .then(r => r.json())
      .then((json: Payload & { error?: string }) => {
        if (!alive) return
        if (json.error) setError(true)
        else setData(json)
      })
      .catch(() => alive && setError(true))
    return () => { alive = false }
  }, [clientId])

  if (error) {
    return (
      <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        今天每小时进线读不到。
      </div>
    )
  }

  if (!data) {
    return <div className="mb-4 text-sm text-gray-400 py-4 text-center">进线图表加载中…</div>
  }

  if (data.unreadable) {
    return (
      <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
        读不到
      </div>
    )
  }

  const chart = data.chart
  if (!chart) {
    return (
      <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
        读不到
      </div>
    )
  }

  const rows = chart.bars.map(b => ({
    label: `${b.hour}:00`,
    hour: b.hour,
    today: b.today,
    avg7d: b.avg7d,
    provisional: b.provisional,
  }))

  const syncLabel = isClient(data)
    ? data.lastSyncLabel
    : formatSyncStaff(data.lastSyncAt)

  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="text-base font-semibold text-gray-800">今天每小时进线</h2>
      <p className="mt-1 text-xs text-gray-500">
        表单进线（CRM）· 新西兰时间 · 0 点到现在的每小时一根柱
      </p>

      <div className="mt-3 text-sm text-gray-700 space-y-0.5">
        <p>今天到现在共 <b>{chart.totals.todaySoFar}</b> 条</p>
        <p>昨天同一时间 <b>{chart.totals.yesterdaySameTime}</b> 条</p>
        <p>上周同一天同一时间 <b>{chart.totals.lastWeekSameWeekdaySameTime}</b> 条</p>
      </div>

      <div className="mt-3" style={{ width: '100%', height: 220 }}>
        <ResponsiveContainer>
          <ComposedChart data={rows} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} interval="preserveStartEnd" />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} width={32} />
            <Tooltip
              formatter={(v: number, name: string) => [
                `${v} 条`,
                name === 'today' ? '今天' : '近 7 天同时段均值',
              ]}
            />
            <Legend formatter={(v) => (v === 'today' ? '今天' : '近 7 天均值')} />
            <Bar dataKey="today" name="today" radius={[3, 3, 0, 0]} maxBarSize={12}>
              {rows.map(entry => (
                <Cell
                  key={entry.hour}
                  fill="#0891b2"
                  fillOpacity={entry.provisional ? 0.45 : 1}
                  stroke="#0891b2"
                  strokeDasharray={entry.provisional ? '4 2' : undefined}
                />
              ))}
            </Bar>
            <Line type="monotone" dataKey="avg7d" name="avg7d" stroke="#6366f1" dot={false} strokeWidth={2} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-2 text-xs text-amber-700">
        最近 2 小时的柱子为虚线：可能还在路上（系统每 2 小时同步一次表单）
      </p>

      {syncLabel && (
        <p className="mt-1 text-xs text-gray-500">表单最后一次同步：{syncLabel}（新西兰时间）</p>
      )}

      {/* 需求 ② 预测：产品拍板后再接 */}
      <div
        className="mt-4 rounded-lg border border-dashed border-gray-200 bg-gray-50/80 px-3 py-2 text-xs text-gray-400"
        aria-hidden
      >
        全天预测（按历史钟点规律）将显示在这里 —— 等产品定稿后再做。
      </div>
    </div>
  )
}
