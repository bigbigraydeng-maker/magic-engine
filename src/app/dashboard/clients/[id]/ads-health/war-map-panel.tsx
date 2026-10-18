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

const FREQ_RED_LINE = 3
const TREND_ICON: Record<string, { icon: string; cls: string }> = {
  growing: { icon: '↑', cls: 'text-emerald-600' },
  flat: { icon: '→', cls: 'text-gray-400' },
  shrinking: { icon: '↓', cls: 'text-red-600' },
  unknown: { icon: '?', cls: 'text-gray-400' },
}

function fmtBig(n: number): string {
  return n >= 10000 ? `${(n / 10000).toFixed(1)} 万` : n.toLocaleString('en-US')
}

/** 三张大卡：一眼看灯 + 一个大数字 + 一句话 */
function BigCard(props: {
  title: string; light: Light; big: string; unit: string; sentence: string; children?: React.ReactNode
}) {
  const meta = LIGHT_META[props.light]
  return (
    <div className={`rounded-xl border p-4 ${meta.tint}`}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-700">{props.title}</p>
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${meta.text}`}>
          <span className={`h-2.5 w-2.5 rounded-full ${meta.dot}`} />{meta.label}
        </span>
      </div>
      <p className={`mt-3 text-3xl font-bold tracking-tight ${meta.text}`}>
        {props.big}<span className="ml-1 text-sm font-normal text-gray-500">{props.unit}</span>
      </p>
      <p className="mt-2 text-xs leading-relaxed text-gray-600">{props.sentence}</p>
      {props.children}
    </div>
  )
}

function PoolBars({ view }: { view: WarMapView }) {
  const rows = view.pools.rows
  const max = Math.max(1, ...rows.map(r => r.sizeLower ?? 0))
  return (
    <div className="mt-3 space-y-2">
      {rows.map(r => {
        const trend = TREND_ICON[r.trend] ?? TREND_ICON.unknown
        const width = r.sizeLower === null ? 0 : Math.max(3, Math.round((r.sizeLower / max) * 100))
        return (
          <div key={r.id} title={`${r.sizeNote} · ${r.trendNote}`}>
            <div className="flex items-center justify-between text-xs">
              <span className="truncate text-gray-700">{r.name}</span>
              <span className="ml-2 shrink-0 text-gray-500">
                {r.sizeLower === null ? '判不了' : `≥${fmtBig(r.sizeLower)}`}
                <span className={`ml-1 font-bold ${trend.cls}`}>{trend.icon}</span>
              </span>
            </div>
            <div className="mt-0.5 h-2 rounded-full bg-gray-100">
              <div className={`h-2 rounded-full ${LIGHT_META[r.light].dot}`} style={{ width: `${width}%` }} />
            </div>
          </div>
        )
      })}
      {view.pools.hiddenCount > 0 && <p className="text-xs text-gray-400">另有 {view.pools.hiddenCount} 个池子没列出</p>}
      <p className="text-[11px] text-gray-400">人数是 Meta 给的下限；↑在长 →没变 ↓在缩 ?判不了</p>
    </div>
  )
}

function FrequencyGauges({ view }: { view: WarMapView }) {
  const rows = view.frequency.rows
  if (rows.length === 0) return <p className="mt-3 text-xs text-gray-400">近 7 天没有花钱的广告</p>
  const scaleMax = 4
  return (
    <div className="mt-3 space-y-2">
      {rows.map(r => {
        const f = r.frequency7d
        const width = f === null ? 0 : Math.min(100, Math.round((f / scaleMax) * 100))
        return (
          <div key={r.campaignId} title={r.note}>
            <div className="flex items-center justify-between text-xs">
              <span className="truncate text-gray-700">{r.campaignName}</span>
              <span className="ml-2 shrink-0 text-gray-500">{f === null ? '—' : f.toFixed(2)} · 花 {r.spend7d.toFixed(0)}</span>
            </div>
            <div className="relative mt-0.5 h-2 rounded-full bg-gray-100">
              <div className={`h-2 rounded-full ${LIGHT_META[r.light].dot}`} style={{ width: `${width}%` }} />
              <div className="absolute -top-0.5 h-3 w-px bg-gray-500" style={{ left: `${(FREQ_RED_LINE / scaleMax) * 100}%` }} />
            </div>
          </div>
        )
      })}
      <p className="text-[11px] text-gray-400">竖线 = 红线 3。{view.frequency.windowLabel !== null ? `对应 ${view.frequency.windowLabel}。` : ''}</p>
    </div>
  )
}

const SEVERITY_META: Record<string, { label: string; bar: string; cls: string }> = {
  red:    { label: '要处理', bar: 'bg-red-500', cls: 'text-red-700' },
  yellow: { label: '留意', bar: 'bg-amber-500', cls: 'text-amber-700' },
  info:   { label: '知道即可', bar: 'bg-gray-300', cls: 'text-gray-500' },
}
const OWNER_META: Record<string, string> = { pm: '你来', agent: '系统查', dev: '开发修' }

function ActionCards({ view }: { view: WarMapView }) {
  const all = view.adjust.actions
  if (all.length === 0) return <p className="mt-3 text-xs text-gray-400">今天没有要调的</p>
  const hot = all.filter(a => a.severity !== 'info')
  const info = all.filter(a => a.severity === 'info')
  const card = (a: typeof all[number]) => {
    const sev = SEVERITY_META[a.severity] ?? SEVERITY_META.info
    return (
      <div key={a.key} className="flex gap-3 rounded-lg border border-gray-100 bg-white p-3">
        <span className={`w-1 shrink-0 rounded-full ${sev.bar}`} />
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[11px]">
            <span className={`font-medium ${sev.cls}`}>{sev.label}</span>
            <span className="text-gray-400">{OWNER_META[a.owner] ?? a.owner}</span>
          </p>
          <p className="mt-0.5 text-sm font-medium text-gray-800">{a.what}</p>
          <p className="mt-0.5 text-xs text-gray-500">{a.how}</p>
        </div>
      </div>
    )
  }
  return (
    <div className="mt-3 space-y-2">
      {hot.length === 0 && <p className="text-xs text-gray-400">没有要处理或留意的事</p>}
      {hot.map(card)}
      {info.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-gray-500">另有 {info.length} 条「知道即可」</summary>
          <div className="mt-2 space-y-2">{info.map(card)}</div>
        </details>
      )}
    </div>
  )
}

/** 倒计时条：开投日 → 目标日，今天是圆点 */
function Timeline({ view }: { view: WarMapView }) {
  const c = view.countdown
  if (c.daysToLaunch === null || c.daysToTarget === null || c.launchDate === null || c.targetDate === null) return null
  const total = c.daysToTarget - c.daysToLaunch
  const done = Math.min(total, Math.max(0, -c.daysToLaunch))
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const head = c.daysToLaunch > 0
    ? `距计划开投日还有 ${c.daysToLaunch} 天`
    : c.daysToTarget >= 0 ? `计划期第 ${-c.daysToLaunch + 1} 天，距目标日还有 ${c.daysToTarget} 天` : `已过目标日 ${-c.daysToTarget} 天`
  const draft = c.planStatus === 'draft' ? '（计划还是草稿）' : ''
  return (
    <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-lg font-bold text-gray-800">{head}</p>
        <p className="text-xs text-gray-500">{c.phaseName}{draft}</p>
      </div>
      <div className="relative mt-3 h-2 rounded-full bg-gray-200">
        <div className="h-2 rounded-full bg-indigo-400" style={{ width: `${pct}%` }} />
        <span className="absolute -top-1 h-4 w-4 -translate-x-1/2 rounded-full border-2 border-white bg-indigo-600" style={{ left: `${pct}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-gray-500">
        <span>开投 {fmtDay(c.launchDate)}</span><span>目标 {fmtDay(c.targetDate)}</span>
      </div>
    </div>
  )
}

function GoalNoteBox({ view }: { view: WarMapView }) {
  const note = view.goalNote
  if (note === null) return null
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-xs text-gray-500">看目标进度（别误读）</summary>
      <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
        <p>《{note.title}》</p>
        {note.paceReason !== null && <p className="mt-1">{note.paceReason}</p>}
        <p className="mt-1">{note.warning}</p>
      </div>
    </details>
  )
}

/** 大数字：灯是「判不了」时不显示数，避免假绿 */
function poolBig(view: WarMapView): { big: string; unit: string } {
  if (view.pools.headline.light === 'unknown') return { big: '判不了', unit: '' }
  const sizes = view.pools.rows.filter(r => r.light !== 'unknown' && r.sizeLower !== null).map(r => r.sizeLower ?? 0)
  if (sizes.length === 0) return { big: '判不了', unit: '' }
  return { big: `≥${fmtBig(Math.max(...sizes))}`, unit: '人（最大池）' }
}

function freqBig(view: WarMapView): { big: string; unit: string } {
  if (view.frequency.headline.light === 'unknown') return { big: '判不了', unit: '' }
  const fs = view.frequency.rows.map(r => r.frequency7d).filter((f): f is number => f !== null)
  if (fs.length === 0) return { big: '—', unit: '' }
  return { big: Math.max(...fs).toFixed(2), unit: '最高频率（红线 3）' }
}

function adjustBig(view: WarMapView): { big: string; unit: string } {
  const n = view.adjust.actions.filter(a => a.severity !== 'info').length
  return { big: String(n), unit: n === 0 ? '件要调' : '件要处理/留意' }
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
        // 4xx（没权限、没登录等）一律静默：这是内部页面，非内部人员不该看到任何报错框。
        if (response.status >= 400 && response.status < 500) {
          setForbidden(true)
          setLoading(false)
          return
        }
        const json = await response.json() as { success?: boolean; view?: WarMapView; error?: string }
        if (!response.ok || json.success !== true || !json.view) {
          setError(json.error ?? '请求失败，稍后再试')
          setLoading(false)
          return
        }
        setView(json.view)
        setLoading(false)
      } catch (err) {
        if (controller.signal.aborted) return
        setError('网络出错，稍后再试')
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

  const pb = poolBig(view)
  const fb = freqBig(view)
  const ab = adjustBig(view)

  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-gray-800">广告作战地图</h2>
        <p className="text-xs text-gray-500">
          数据日 {fmtDay(view.clocks.dataDay)} · 取数 {fmtNz(view.clocks.fetchedAt)}（新西兰时间）
        </p>
      </div>

      <Timeline view={view} />

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <BigCard title="① 观众池" light={view.pools.headline.light} big={pb.big} unit={pb.unit} sentence={view.pools.headline.sentence}>
          <details className="mt-3"><summary className="cursor-pointer text-xs text-gray-500">看每个池子</summary><PoolBars view={view} /></details>
        </BigCard>
        <BigCard title="② 频率" light={view.frequency.headline.light} big={fb.big} unit={fb.unit} sentence={view.frequency.headline.sentence}>
          <details className="mt-3"><summary className="cursor-pointer text-xs text-gray-500">看每个广告</summary><FrequencyGauges view={view} /></details>
        </BigCard>
        <BigCard title="③ 今天调什么" light={view.adjust.headline.light} big={ab.big} unit={ab.unit} sentence={view.adjust.headline.sentence}>
          <details className="mt-3" open={view.adjust.actions.some(a => a.severity !== 'info')}><summary className="cursor-pointer text-xs text-gray-500">看清单</summary><ActionCards view={view} /></details>
        </BigCard>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {view.accounts.map(a => (
          <span key={a.adAccountId} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${LIGHT_META[a.light].tint} ${LIGHT_META[a.light].text}`}>
            <span className={`h-2 w-2 rounded-full ${LIGHT_META[a.light].dot}`} />{a.name}：{a.sentence}
          </span>
        ))}
      </div>

      <GoalNoteBox view={view} />
    </div>
  )
}
