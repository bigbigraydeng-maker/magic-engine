/**
 * 方案 2 — Kanban 时间轴视图（独立审核页）
 *
 * 路由：/dashboard/clients/[id]/execution/timeline
 *
 * 设计理念：
 *   - 不按 Plan / 处方分组
 *   - 不按 6 大维度分组
 *   - 仅按 due_date 时间排列，FDE 视角是「今天我该处理哪些」
 *   - 失败/超时的任务在当天置顶 pin
 *   - 极致密度（一行一卡片）
 *
 * 与方案 1 的差异：方案 1 战略对齐（按 Plan），方案 2 deadline 驱动（按时间）。
 * PM 对比后决定保留哪一种作为主视图。
 */
'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import type { ExecutionItemStatus, CardContentState, ContentStateSignal } from '@/types/diagnostic'

interface ItemRow {
  id: string
  title: string
  description: string
  dimension: string
  status: ExecutionItemStatus
  due_date: string | null
  content_state: CardContentState | null
}

interface ApiResponse {
  success: boolean
  items: ItemRow[]
}

const SIGNAL_ICON: Record<ContentStateSignal, { glyph: string; cls: string }> = {
  ready:      { glyph: '✓',  cls: 'text-green-600' },
  generating: { glyph: '⏳', cls: 'text-cyan-600 animate-pulse' },
  failed:     { glyph: '✗',  cls: 'text-red-600' },
  pending:    { glyph: '·',  cls: 'text-slate-400' },
  na:         { glyph: '—',  cls: 'text-slate-300' },
}

const DIM_LABEL: Record<string, string> = {
  social:        '社媒',
  seo:           'SEO',
  ai_visibility: 'GEO',
  ads:           '广告',
  reputation:    '口碑',
  competitor:    '竞品',
}

const STATUS_LABEL: Record<ExecutionItemStatus, { label: string; cls: string }> = {
  pending:     { label: '待处理', cls: 'bg-amber-100 text-amber-700' },
  in_progress: { label: '进行中', cls: 'bg-blue-100 text-blue-700' },
  completed:   { label: '已完成', cls: 'bg-green-100 text-green-700' },
  skipped:     { label: '已跳过', cls: 'bg-gray-100 text-gray-600' },
  superseded:  { label: '已取代', cls: 'bg-gray-200 text-gray-500' },
}

// Defensive lookup — guard render against unknown future status values.
function statusLabelOf(status: string): { label: string; cls: string } {
  return (
    (STATUS_LABEL as Record<string, { label: string; cls: string }>)[status] ?? {
      label: status,
      cls: 'bg-gray-100 text-gray-600',
    }
  )
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const ymd = (x: Date) => `${x.getFullYear()}-${x.getMonth()+1}-${x.getDate()}`
  if (ymd(d) === ymd(today)) return `今天 · ${iso}`
  if (ymd(d) === ymd(tomorrow)) return `明天 · ${iso}`
  const weekday = ['周日','周一','周二','周三','周四','周五','周六'][d.getDay()]
  return `${iso} ${weekday}`
}

export default function TimelinePage() {
  const params = useParams<{ id: string }>()
  const clientId = params?.id ?? ''
  const [items, setItems] = useState<ItemRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!clientId) return
    let cancelled = false
    setLoading(true)
    fetch(`/api/clients/${clientId}/execution`, { cache: 'no-store' })
      .then(r => r.json() as Promise<ApiResponse>)
      .then(j => {
        if (cancelled) return
        if (!j.success) throw new Error('Failed to load')
        setItems(j.items ?? [])
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Unknown error')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [clientId])

  // 按 due_date 分组，无 due_date 单独"未排期"组
  const groups = (() => {
    const byDate: Record<string, ItemRow[]> = {}
    const unscheduled: ItemRow[] = []
    for (const it of items) {
      if (!it.due_date) {
        unscheduled.push(it)
      } else {
        ;(byDate[it.due_date] ??= []).push(it)
      }
    }
    // 每个 due_date 内：failed 置顶 → stale → generating → pending → completed
    const priorityOrder: Record<string, number> = { failed: 0, stale: 1, generating: 2, normal: 3, published: 4 }
    const sortItems = (a: ItemRow, b: ItemRow) => {
      const ap = priorityOrder[a.content_state?.priority ?? 'normal'] ?? 9
      const bp = priorityOrder[b.content_state?.priority ?? 'normal'] ?? 9
      if (ap !== bp) return ap - bp
      const statusOrder: Record<string, number> = { pending: 0, in_progress: 1, completed: 2, skipped: 3 }
      return (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9)
    }
    const dates = Object.keys(byDate).sort()
    return { dates, byDate, unscheduled, sortItems }
  })()

  if (loading) {
    return <div className="min-h-screen bg-[#f6f7f2] p-6 animate-pulse"><div className="max-w-3xl mx-auto h-7 w-56 bg-gray-200 rounded" /></div>
  }
  if (error) {
    return <div className="min-h-screen bg-[#f6f7f2] p-6"><div className="max-w-3xl mx-auto rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">{error}</div></div>
  }

  return (
    <div className="min-h-screen bg-[#f6f7f2]">
      <div className="max-w-3xl mx-auto p-6 space-y-4">
        {/* Header */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between mb-1">
            <h1 className="text-lg font-black text-slate-900">📅 执行时间轴</h1>
            <Link href={`/dashboard/clients/${clientId}/execution`} className="text-xs font-bold text-cyan-700 underline hover:text-cyan-900">
              ← 返回 Kanban
            </Link>
          </div>
          <p className="text-[11px] font-semibold text-slate-500">方案 2 审核版 · 按 deadline 排序，FDE 视角是「今天处理什么」</p>
        </div>

        {/* 时间分组 */}
        {groups.dates.map(date => {
          const dayItems = [...groups.byDate[date]].sort(groups.sortItems)
          return (
            <div key={date} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="bg-slate-900 text-white px-4 py-2">
                <span className="text-sm font-black">{formatDateLabel(date)}</span>
                <span className="ml-2 text-[11px] font-semibold text-slate-300">{dayItems.length} 条</span>
              </div>
              <div className="divide-y divide-slate-100">
                {dayItems.map(it => <TimelineRow key={it.id} item={it} clientId={clientId} />)}
              </div>
            </div>
          )
        })}

        {groups.unscheduled.length > 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 overflow-hidden">
            <div className="px-4 py-2 bg-slate-100">
              <span className="text-sm font-black text-slate-700">未排期</span>
              <span className="ml-2 text-[11px] font-semibold text-slate-500">{groups.unscheduled.length} 条</span>
            </div>
            <div className="divide-y divide-slate-200">
              {[...groups.unscheduled].sort(groups.sortItems).map(it => <TimelineRow key={it.id} item={it} clientId={clientId} />)}
            </div>
          </div>
        )}

        {groups.dates.length === 0 && groups.unscheduled.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
            <p className="text-sm text-slate-500">暂无执行任务</p>
          </div>
        )}
      </div>
    </div>
  )
}

function TimelineRow({ item, clientId }: { item: ItemRow; clientId: string }) {
  const status = statusLabelOf(item.status)
  const cs = item.content_state

  // 边框左色块（视觉优先级）
  const leftBar = (() => {
    switch (cs?.priority) {
      case 'failed':     return 'bg-red-500'
      case 'stale':      return 'bg-amber-500'
      case 'generating': return 'bg-cyan-500'
      case 'published':  return 'bg-green-500'
      default:           return 'bg-slate-200'
    }
  })()

  return (
    <Link
      href={`/dashboard/clients/${clientId}/execution?item=${item.id}`}
      className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 transition-colors"
    >
      <span className={`w-1 self-stretch rounded ${leftBar}`} />
      <span className="text-[10px] font-bold text-slate-500 shrink-0 w-12">
        {DIM_LABEL[item.dimension] ?? item.dimension}
      </span>
      <span className="text-xs font-black text-slate-900 truncate flex-1">{item.title}</span>
      {cs && (
        <span className="flex items-center gap-1 shrink-0 text-[11px]">
          <SignalGlyph signal={cs.text}    label="文" />
          <SignalGlyph signal={cs.image}   label="图" />
          <SignalGlyph signal={cs.video}   label="视" />
          <SignalGlyph signal={cs.publish} label="发" />
        </span>
      )}
      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold shrink-0 ${status.cls}`}>{status.label}</span>
    </Link>
  )
}

function SignalGlyph({ signal, label }: { signal: ContentStateSignal; label: string }) {
  const meta = SIGNAL_ICON[signal]
  return (
    <span title={`${label}: ${signal}`} className={`inline-flex items-center ${meta.cls}`}>
      <span className="text-[9px] font-semibold">{label}</span>
      <span className="font-black">{meta.glyph}</span>
    </span>
  )
}
