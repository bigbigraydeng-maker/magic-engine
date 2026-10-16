'use client'

/**
 * 广告作战地图（spec 2026-10-16 §S1）。只读页面，前端读侧。
 *
 * 🔴 三种「没有数」必须分开显示，不能都渲染成 0 或空白：
 *    读不到（接口出错）· 还没有（今天没有这一行）· 判不了（数据不全 / 人数是显示下限）。
 * 🔴 403 直接不渲染（这是内部页面，非内部人员不该看到任何报错框）。
 */

import React, { useEffect, useState } from 'react'
import type { Light, WarMapView } from '@/lib/ads-strategy/war-map/types'

const LIGHT_META: Record<Light, { dot: string; tint: string; text: string; label: string }> = {
  green:   { dot: 'bg-emerald-500', tint: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', label: '正常' },
  yellow:  { dot: 'bg-amber-500',   tint: 'bg-amber-50 border-amber-200',     text: 'text-amber-700',   label: '留意' },
  red:     { dot: 'bg-red-500',     tint: 'bg-red-50 border-red-200',         text: 'text-red-700',     label: '要处理' },
  unknown: { dot: 'bg-gray-400',    tint: 'bg-gray-50 border-gray-200',       text: 'text-gray-500',    label: '判不了' },
}

function fmtNz(iso: string | null): string {
  if (iso === null) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Pacific/Auckland',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}

function fmtDay(day: string | null): string {
  if (day === null) return '—'
  const parts = day.split('-')
  const m = parts[1] ?? ''
  const d = parts[2] ?? ''
  return `${parseInt(m, 10)}/${parseInt(d, 10)}`
}

function dayChip(daysTo: number | null, futureLabel: string, pastLabel: string): string | null {
  if (daysTo === null) return null
  if (daysTo > 0) return `${futureLabel} ${daysTo} 天`
  if (daysTo === 0) return `${futureLabel}：今天`
  return `${pastLabel} ${-daysTo} 天`
}

function Dot({ light }: { light: Light }) {
  return <span className={`mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${LIGHT_META[light].dot}`} />
}

function SentenceRow({ label, light, sentence }: { label: string; light: Light; sentence: string }) {
  const meta = LIGHT_META[light]
  return (
    <div className={`flex items-start gap-3 rounded-lg border p-3 ${meta.tint}`}>
      <Dot light={light} />
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className={`mt-0.5 text-sm font-medium ${meta.text}`}>{sentence}</p>
      </div>
    </div>
  )
}

function PoolList({ view }: { view: WarMapView }) {
  return (
    <div className="mt-2">
      {view.pools.rows.map(row => (
        <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 py-1.5 text-sm">
          <span className="flex items-center gap-2">
            <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${LIGHT_META[row.light].dot}`} />
            <span className="text-gray-800">{row.name}</span>
            <span className="text-xs text-gray-500">（{row.accountName}）</span>
          </span>
          <span className="text-xs text-gray-500">
            {row.sizeNote} · {row.trendNote} · {row.usedByActiveAdsets} 个在投广告组在用
          </span>
        </div>
      ))}
      {view.pools.hiddenCount > 0 && (
        <p className="mt-1 text-xs text-gray-500">另有 {view.pools.hiddenCount} 个池子没列出</p>
      )}
      <p className="mt-2 text-xs text-gray-400">人数是 Meta 给的下限，1,000 是显示下限；两个广告账户的池子不能互通。</p>
    </div>
  )
}

function FrequencyList({ view }: { view: WarMapView }) {
  if (view.frequency.rows.length === 0) {
    return <p className="mt-2 text-xs text-gray-400">近 7 天没有花钱的广告</p>
  }
  return (
    <div className="mt-2">
      {view.frequency.rows.map(row => (
        <div key={row.campaignId} className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 py-1.5 text-sm">
          <span className="flex items-center gap-2">
            <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${LIGHT_META[row.light].dot}`} />
            <span className="text-gray-800">{row.campaignName}</span>
            <span className="text-xs text-gray-500">（{row.accountName}）</span>
          </span>
          <span className="text-xs text-gray-500">
            频率 {row.frequency7d === null ? '—' : row.frequency7d.toFixed(2)} · 近 7 天花费 {row.spend7d.toFixed(0)} · {row.note}
          </span>
        </div>
      ))}
      <p className="mt-2 text-xs text-gray-400">7 天不重复频率；红线是 3。</p>
    </div>
  )
}

const SEVERITY_META: Record<string, { label: string; cls: string }> = {
  red:    { label: '要处理', cls: 'bg-red-100 text-red-700 border-red-200' },
  yellow: { label: '留意',   cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  info:   { label: '知道即可', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
}

const OWNER_META: Record<string, string> = {
  pm: '你',
  agent: '系统',
  dev: '开发',
}

function ActionList({ view }: { view: WarMapView }) {
  if (view.adjust.actions.length === 0) {
    return <p className="mt-2 text-xs text-gray-400">今天没有要调的</p>
  }
  return (
    <div className="mt-2 space-y-2">
      {view.adjust.actions.map(action => {
        const sev = SEVERITY_META[action.severity] ?? SEVERITY_META.info
        return (
          <div key={action.key} className="rounded border border-gray-100 p-2">
            <div className="flex items-center gap-2">
              <span className={`rounded border px-1.5 py-0.5 text-[10px] ${sev.cls}`}>{sev.label}</span>
              <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-500">
                {OWNER_META[action.owner] ?? action.owner}
              </span>
            </div>
            <p className="mt-1 text-sm font-medium text-gray-800">{action.what}</p>
            <p className="mt-0.5 text-xs text-gray-600">{action.how}</p>
          </div>
        )
      })}
    </div>
  )
}

function GoalNoteBox({ view }: { view: WarMapView }) {
  const note = view.goalNote
  if (note === null) return null
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-sm text-gray-600">看目标进度（别误读）</summary>
      <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
        <p>《{note.title}》</p>
        {note.paceReason !== null && <p className="mt-1">{note.paceReason}</p>}
        <p className="mt-1">{note.warning}</p>
      </div>
    </details>
  )
}

export default function WarMapPanel({ clientId }: { clientId: string }): JSX.Element | null {
  const [view, setView] = useState<WarMapView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      try {
        const response = await fetch(`/api/clients/${clientId}/ad-health/war-map`, { signal: controller.signal })
        if (response.status === 403) {
          setForbidden(true)
          setLoading(false)
          return
        }
        const json = await response.json() as { success?: boolean; view?: WarMapView; error?: string }
        if (!response.ok || json.success !== true || !json.view) {
          setError(json.error ?? '请求失败')
          setLoading(false)
          return
        }
        setView(json.view)
        setLoading(false)
      } catch (err) {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : '请求失败')
        setLoading(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [clientId])

  if (forbidden) return null
  if (loading) return <p className="text-xs text-gray-400">作战地图加载中…</p>
  if (error !== null) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        读不到作战地图：{error}
      </div>
    )
  }
  if (view === null) return null

  const launchChip = dayChip(view.countdown.daysToLaunch, '距计划开投日', '已过计划开投日')
  const targetChip = dayChip(view.countdown.daysToTarget, '距目标日', '已过目标日')
  const launchText = launchChip !== null && view.countdown.phaseName !== null
    ? `${launchChip} · ${view.countdown.phaseName}`
    : launchChip

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 mb-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-gray-800">广告作战地图</h2>
        <p className="text-xs text-gray-500">
          数据日 {fmtDay(view.clocks.dataDay)} · 取数 {fmtNz(view.clocks.fetchedAt)}（新西兰时间）
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {launchText !== null && (
          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{launchText}</span>
        )}
        {targetChip !== null && (
          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{targetChip}</span>
        )}
        {view.accounts.map(a => (
          <span key={a.adAccountId} className={`rounded border px-2 py-0.5 text-xs ${LIGHT_META[a.light].tint} ${LIGHT_META[a.light].text}`}>
            {a.name}：{a.sentence}
          </span>
        ))}
      </div>

      <div className="mt-4 space-y-2">
        <SentenceRow label="① 观众池怎么样" light={view.pools.headline.light} sentence={view.pools.headline.sentence} />
        <SentenceRow label="② 频率有没有过高" light={view.frequency.headline.light} sentence={view.frequency.headline.sentence} />
        <SentenceRow label="③ 今天要怎么调" light={view.adjust.headline.light} sentence={view.adjust.headline.sentence} />
      </div>

      <details className="mt-4">
        <summary className="cursor-pointer text-sm text-gray-600">看观众池明细</summary>
        <PoolList view={view} />
      </details>

      <details className="mt-2">
        <summary className="cursor-pointer text-sm text-gray-600">看频率明细</summary>
        <FrequencyList view={view} />
      </details>

      <details className="mt-2">
        <summary className="cursor-pointer text-sm text-gray-600">看今天要调的事</summary>
        <ActionList view={view} />
      </details>

      <GoalNoteBox view={view} />
    </div>
  )
}
