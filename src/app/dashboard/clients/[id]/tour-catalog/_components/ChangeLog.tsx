'use client'

import { useState } from 'react'
import type { ChangeLogEntryView } from './types'

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

const IGNORED_FIELDS = new Set(['updated_at', 'created_at', 'status_as_of', 'status_source'])

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

function formatTime(iso: string): string {
  const d = new Date(iso)
  const month = d.getMonth() + 1
  const day = d.getDate()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${month}月${day}日 ${hh}:${mm}`
}

function formatActor(actor: string): string {
  if (actor.startsWith('edit by ')) return `手工修改（${actor.slice('edit by '.length)}）`
  if (actor.startsWith('import:')) return '班期表导入'
  if (actor.startsWith('rollback:')) return '撤销导入'
  if (actor === 'system') return '系统'
  return actor
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

function describeEntry(entry: ChangeLogEntryView): string {
  if (entry.action === 'insert') {
    const departOn = entry.after?.depart_on
    if (entry.entity === 'departure' && typeof departOn === 'string') return `新增班期 ${departOn}`
    return entry.entity === 'tour' ? '新增团' : '新增'
  }
  if (entry.action === 'delete') return '删除'
  const changes = changedFields(entry.before, entry.after)
  if (changes.length === 0) return '修改'
  return changes
    .map((c) => {
      const name = FIELD_NAMES[c.key] ?? c.key
      return `${name}：${formatValue(c.from)} → ${formatValue(c.to)}`
    })
    .join('；')
}

export function ChangeLog({
  clientId,
  entityIds,
}: {
  clientId: string
  entityIds: string[]
}) {
  const [entries, setEntries] = useState<ChangeLogEntryView[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    // Reload every time it is opened so edits made since the last look show up.
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const query = entityIds.map((id) => 'entityId=' + encodeURIComponent(id)).join('&')
      const res = await fetch(`/api/clients/${clientId}/tour-catalog/changes?${query}`)
      const data = (await res.json().catch(() => ({}))) as {
        changes?: ChangeLogEntryView[]
        error?: string
      }
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
  }

  const shown = (entries ?? []).slice(0, 50)

  return (
    <details
      className="mt-6 rounded-xl border border-black/10 p-4"
      onToggle={(e) => {
        if ((e.target as HTMLDetailsElement).open) void load()
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
                <span className="text-me-charcoal/60">{formatTime(entry.createdAt)}</span>
                {' · '}
                <span>{formatActor(entry.actor)}</span>
                {' · '}
                <span>{describeEntry(entry)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  )
}
