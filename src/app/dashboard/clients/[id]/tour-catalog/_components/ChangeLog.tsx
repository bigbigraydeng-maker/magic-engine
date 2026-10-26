'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ChangeLogEntryView } from './types'
import type { ChangesResponse } from '@/lib/tour-catalog/api-contract'
import { formatDateTimeWithYear } from './catalog-format'
import { CHANGE_SOURCE_LABELS, SELF_REPORTED_TITLE, parseChangeActor } from './change-source'

const FIELD_NAMES: Record<string, string> = {
  name: '团名',
  title: '对外标题',
  display_price_text: '展示价',
  duration_text: '天数',
  short_description: '简介',
  highlights: '亮点',
  itinerary: '行程',
  inclusions: '包含',
  exclusions: '不包含',
  tour_cities: '途经城市',
  single_supplement: '单人房差',
  max_group_size: '最多人数',
  is_active: '在售',
  manages_departures: '管理班期',
  return_on: '返程日',
  status: '状态',
  price_text_override: '该班展示价',
  depart_on: '出团日',
}

const IGNORED_FIELDS = new Set([
  'updated_at',
  'created_at',
  'status_as_of',
  'status_source',
  'id',
  'client_id',
  'tour_id',
])

const LIST_FIELDS = new Set(['highlights', 'inclusions', 'exclusions', 'tour_cities'])

const STATUS_LABELS: Record<string, string> = {
  open: '可订',
  limited: '少量余位',
  sold_out: '已满团',
  closed: '已关闭',
  cancelled: '已取消',
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '空'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value === 'string') return STATUS_LABELS[value] ?? value
  if (typeof value === 'number') return String(value)
  return '（已修改）'
}

/** Who + a small source label, instead of the raw actor text. */
function ActorCell(props: { actor: string }): JSX.Element {
  const { who, source } = parseChangeActor(props.actor)
  return (
    <>
      {who ? <span className="break-all">{who}</span> : null}{' '}
      <span
        data-source={source}
        className="rounded-full border border-black/10 bg-me-ivory px-2 py-0.5 text-xs font-black text-me-charcoal/70"
      >
        {CHANGE_SOURCE_LABELS[source]}
      </span>
      {source === 'assistant' ? (
        <span title={SELF_REPORTED_TITLE} className="ml-1 text-[11px] font-semibold text-me-charcoal/55">
          自报
        </span>
      ) : null}
    </>
  )
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}

function formatListDiff(from: unknown, to: unknown): string {
  const before = asStringArray(from)
  const after = asStringArray(to)
  const added = after.filter((v) => !before.includes(v))
  const removed = before.filter((v) => !after.includes(v))
  const parts: string[] = []
  if (added.length > 0) parts.push(`+ ${added.slice(0, 5).join('、')}${added.length > 5 ? '等' : ''}`)
  if (removed.length > 0) parts.push(`− ${removed.slice(0, 5).join('、')}${removed.length > 5 ? '等' : ''}`)
  return parts.join('；')
}

interface ItineraryDay {
  day: number
  title: string
  description: string
  meals?: string[]
}

function asItinerary(value: unknown): ItineraryDay[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (v): v is ItineraryDay =>
      typeof v === 'object' && v !== null && typeof (v as { day?: unknown }).day === 'number',
  )
}

function itineraryDiff(from: unknown, to: unknown): string {
  const before = asItinerary(from)
  const after = asItinerary(to)
  const beforeByDay = new Map(before.map((d) => [d.day, d]))
  const afterByDay = new Map(after.map((d) => [d.day, d]))
  const days = new Set([...beforeByDay.keys(), ...afterByDay.keys()])
  const parts: string[] = []
  for (const day of [...days].sort((a, b) => a - b)) {
    const b = beforeByDay.get(day)
    const a = afterByDay.get(day)
    if (!b && a) parts.push(`第 ${day} 天：新增`)
    else if (b && !a) parts.push(`第 ${day} 天：删除`)
    else if (b && a && JSON.stringify(b) !== JSON.stringify(a)) parts.push(`第 ${day} 天：修改`)
  }
  return parts.join('；')
}

function describeField(key: string, from: unknown, to: unknown): string {
  const name = FIELD_NAMES[key] ?? key
  if (key === 'internal') return '运营信息（航司/航段/人数）已更新'
  if (LIST_FIELDS.has(key)) {
    const diff = formatListDiff(from, to)
    return diff ? `${name}：${diff}` : `${name}：已更新`
  }
  if (key === 'itinerary') {
    const diff = itineraryDiff(from, to)
    return diff ? `${name}：${diff}` : `${name}：已更新`
  }
  return `${name}：${formatValue(from)} → ${formatValue(to)}`
}

function changedFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Array<{ key: string; from: unknown; to: unknown }> {
  const b = before ?? {}
  const a = after ?? {}
  const keys = new Set([...Object.keys(b), ...Object.keys(a)])
  const result: Array<{ key: string; from: unknown; to: unknown }> = []
  for (const key of keys) {
    if (IGNORED_FIELDS.has(key)) continue
    const from = b[key]
    const to = a[key]
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      result.push({ key, from, to })
    }
  }
  return result
}

function departureDate(entry: ChangeLogEntryView): string | null {
  const after = entry.after?.depart_on
  if (typeof after === 'string') return after
  const before = entry.before?.depart_on
  if (typeof before === 'string') return before
  return null
}

function describeEntry(entry: ChangeLogEntryView): string {
  const prefix =
    entry.entity === 'departure'
      ? (() => {
          const date = departureDate(entry)
          return date ? `班期 ${date}：` : '班期：'
        })()
      : ''

  if (entry.action === 'insert') {
    if (entry.entity === 'departure') {
      const date = departureDate(entry)
      return date ? `新增班期 ${date}` : '新增班期'
    }
    return entry.entity === 'tour' ? '新增团' : '新增'
  }
  if (entry.action === 'delete') {
    if (entry.entity === 'departure') {
      const date = departureDate(entry)
      return date ? `删除班期 ${date}` : '删除班期'
    }
    return '删除'
  }
  const changes = changedFields(entry.before, entry.after)
  if (changes.length === 0) return prefix ? `${prefix}修改` : '修改'
  const body = changes.map((c) => describeField(c.key, c.from, c.to)).join('；')
  return `${prefix}${body}`
}

export function ChangeLog({
  clientId,
  tourId,
  refreshKey,
}: {
  clientId: string
  tourId: string
  refreshKey: string
}) {
  const [entries, setEntries] = useState<ChangeLogEntryView[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/clients/${clientId}/tour-catalog/changes?tourId=${encodeURIComponent(tourId)}`,
      )
      // Typed against the route's contract so a renamed field fails the type check.
      const data = (await res.json().catch(() => ({}))) as Partial<ChangesResponse> & { error?: string }
      if (!res.ok) {
        setError('加载失败，请稍后重试')
        return
      }
      setEntries(data.changes ?? [])
    } catch {
      setError('加载失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [clientId, tourId])

  // Reload whenever the panel is opened.
  useEffect(() => {
    if (open) void load()
  }, [open, load])

  // Reload when the tour or its departures change while the panel is open.
  useEffect(() => {
    if (open) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  const shown = (entries ?? []).slice(0, 50)

  return (
    <details
      className="mt-6 border-t border-black/10 pt-4"
      onToggle={(e) => {
        setOpen((e.target as HTMLDetailsElement).open)
      }}
    >
      <summary className="cursor-pointer text-sm font-semibold text-me-charcoal">
        修改记录
      </summary>
      <div className="mt-3">
        {loading && <div className="text-sm text-me-charcoal/60">加载中…</div>}
        {error && (
          <div className="text-sm" style={{ color: '#C2453A' }}>
            {error}
          </div>
        )}
        {!loading && !error && shown.length === 0 && (
          <div className="text-sm text-me-charcoal/60">暂无记录</div>
        )}
        {!loading && !error && shown.length > 0 && (
          <ul className="flex flex-col gap-2">
            {shown.map((entry) => (
              <li key={entry.id} className="text-sm text-me-charcoal">
                <span className="text-me-charcoal/60">{formatDateTimeWithYear(entry.createdAt)}</span>
                {' · '}
                <ActorCell actor={entry.actor} />
                {' · '}
                <span className="break-all">{describeEntry(entry)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  )
}
