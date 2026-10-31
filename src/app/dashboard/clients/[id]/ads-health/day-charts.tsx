'use client'

/**
 * 「按天」的图：柱状图 = 每天花费 + 每天进线（两张小图，各一条轴，不做双轴）；走势图 = 每条进线成本（当天 / 近 7 天合计）。
 * 数据来自 buildDaySeries（纯函数）；图用项目里已有的 recharts。
 *
 * 🔴 没有进线的那天没有「每条进线成本」，画成断口，不画成 0。
 * 🔴 单独一天样本很少：走势图同时画近 7 天合计那条线，别只看当天。
 * 🔴 表格视图一直保留（切换回「表格」就是原来的表），图只是另一种看法。
 */

import React from 'react'
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { DayPoint } from '@/lib/ads-strategy/breakdown-stats/day-series'

const SPEND_COLOR = '#2563eb'
const LEADS_COLOR = '#0891b2'
const DAILY_LINE_COLOR = '#94a3b8'
const TREND_LINE_COLOR = '#2563eb'
const GRID = '#e2e8f0'
const TICK = { fontSize: 11, fill: '#64748b' }

function ChartBox({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 min-w-0">
      <p className="text-xs font-medium text-gray-700">{title}</p>
      {note && <p className="text-xs text-gray-500">{note}</p>}
      <div style={{ width: '100%', height: 190 }}>{children}</div>
    </div>
  )
}

function fmt(n: number | null | undefined, cur: string | null): string {
  if (n === null || n === undefined) return '—'
  return cur ? `${n.toFixed(2)} ${cur}` : n.toFixed(2)
}

export function DayBarCharts({ points, cur }: { points: DayPoint[]; cur: string | null }) {
  return (
    <div>
      <ChartBox title="每天花费" note={cur ? `单位 ${cur}` : undefined}>
        <ResponsiveContainer>
          <BarChart data={points} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="label" tick={TICK} axisLine={{ stroke: GRID }} tickLine={false} interval="preserveStartEnd" minTickGap={16} />
            <YAxis tick={TICK} axisLine={false} tickLine={false} width={44} />
            <Tooltip formatter={(v: number) => [fmt(v, cur), '花费']} labelStyle={{ color: '#0f172a' }} />
            <Bar dataKey="spend" name="花费" fill={SPEND_COLOR} radius={[4, 4, 0, 0]} maxBarSize={14} />
          </BarChart>
        </ResponsiveContainer>
      </ChartBox>
      <ChartBox title="每天进线（客户系统里的表单进线）">
        <ResponsiveContainer>
          <BarChart data={points} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="label" tick={TICK} axisLine={{ stroke: GRID }} tickLine={false} interval="preserveStartEnd" minTickGap={16} />
            <YAxis tick={TICK} axisLine={false} tickLine={false} width={44} allowDecimals={false} />
            <Tooltip formatter={(v: number) => [`${v} 条`, '进线']} labelStyle={{ color: '#0f172a' }} />
            <Bar dataKey="leads" name="进线" fill={LEADS_COLOR} radius={[4, 4, 0, 0]} maxBarSize={14} />
          </BarChart>
        </ResponsiveContainer>
      </ChartBox>
    </div>
  )
}

export function DayTrendChart({ points, cur }: { points: DayPoint[]; cur: string | null }) {
  return (
    <ChartBox
      title="每条进线成本"
      note="灰线是当天，蓝线是近 7 天合计（花费 ÷ 进线）；当天没有进线就断开，不画成 0。"
    >
      <ResponsiveContainer>
        <LineChart data={points} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="label" tick={TICK} axisLine={{ stroke: GRID }} tickLine={false} interval="preserveStartEnd" minTickGap={16} />
          <YAxis tick={TICK} axisLine={false} tickLine={false} width={44} />
          <Tooltip
            formatter={(v: unknown, name: unknown) => [fmt(typeof v === 'number' ? v : null, cur), String(name)]}
            labelStyle={{ color: '#0f172a' }}
          />
          <Legend verticalAlign="top" height={24} iconType="plainline" wrapperStyle={{ fontSize: 12, color: '#475569' }} />
          <Line type="monotone" dataKey="cpl" name="当天" stroke={DAILY_LINE_COLOR} strokeWidth={1.5} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="cpl7" name="近 7 天合计" stroke={TREND_LINE_COLOR} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartBox>
  )
}
