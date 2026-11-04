'use client'

// 「看片」放的是视频工厂的成片文件；批准绑定的是 Facebook 草稿的正文、首评和视频编号（两者默认同一份，重新出片会变成新工单）。
// 一条 Reel 一行：哪天几点发、哪个团、能直接看片、要公开的正文和首评、核对结果。周卡和每日清单共用。只管显示和勾选，不发请求。

import type { ReactNode } from 'react'

export interface ReelListItem {
  work_order_id: string
  title: string
  publish_on: string // YYYY-MM-DD
  caption: string
  first_comment: string
  fact_summary: string | null
  fingerprint: string | null
  selectable: boolean
  blocked_reason: string | null
  default_checked: boolean
  note: string | null
  video_path: string | null
}

const WEEKDAY_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asBoolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false
}

function readItem(raw: unknown): ReelListItem | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.work_order_id !== 'string') return null
  if (typeof obj.title !== 'string') return null
  if (typeof obj.publish_on !== 'string') return null
  return {
    work_order_id: obj.work_order_id,
    title: obj.title,
    publish_on: obj.publish_on,
    caption: asString(obj.caption),
    first_comment: asString(obj.first_comment),
    fact_summary: asNullableString(obj.fact_summary),
    fingerprint: asNullableString(obj.fingerprint),
    selectable: asBoolean(obj.selectable),
    blocked_reason: asNullableString(obj.blocked_reason),
    default_checked: asBoolean(obj.default_checked),
    note: asNullableString(obj.note),
    video_path: asNullableString(obj.video_path),
  }
}

export function readReelList(json: unknown): { switchOn: boolean; publishHour: number; items: ReelListItem[] } | null {
  if (!json || typeof json !== 'object') return null
  const obj = json as Record<string, unknown>
  if (typeof obj.switch_on !== 'boolean' || !Array.isArray(obj.items)) return null
  const rawHour = obj.publish_hour
  const publishHour =
    typeof rawHour === 'number' && Number.isInteger(rawHour) && rawHour >= 0 && rawHour <= 23 ? rawHour : 18
  const items: ReelListItem[] = []
  for (const raw of obj.items) {
    const item = readItem(raw)
    if (item) items.push(item)
  }
  return { switchOn: obj.switch_on, publishHour, items }
}

export function dayLabel(publishOn: string, hour: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(publishOn)
  if (!match) return publishOn
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  const weekday = WEEKDAY_ZH[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? ''
  const hh = hour < 10 ? `0${hour}` : `${hour}`
  return `${m}/${d} ${weekday} ${hh}:00`
}

export function defaultChecked(items: ReelListItem[]): Set<string> {
  return new Set(items.filter((it) => it.selectable && it.default_checked).map((it) => it.work_order_id))
}

function videoUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return `${base}/storage/v1/object/public/content-factory/${path}`
}

export function ReelListRows(props: {
  items: ReelListItem[]
  publishHour: number
  checked: ReadonlySet<string>
  onToggle: (id: string) => void
  disabled?: boolean
  /** Optional per-row extra controls (e.g. an exclude button), rendered under the row. */
  renderExtra?: (item: ReelListItem) => ReactNode
}): JSX.Element {
  const { items, publishHour, checked, onToggle, disabled, renderExtra } = props
  return (
    <ul className="space-y-3">
      {items.map((it) => (
        <li key={it.work_order_id} className="rounded-lg border border-slate-200 p-3 space-y-1 text-xs text-slate-700">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={checked.has(it.work_order_id)}
              disabled={!it.selectable || disabled === true}
              onChange={() => onToggle(it.work_order_id)}
            />
            <span className="text-sm font-medium text-slate-900">
              {dayLabel(it.publish_on, publishHour)} · {it.title}
            </span>
          </label>
          {it.video_path && (
            <details>
              <summary className="cursor-pointer underline">看片（视频工厂的成片）</summary>
              <video controls preload="none" className="mt-1 max-h-80 rounded" src={videoUrl(it.video_path)} />
            </details>
          )}
          {it.caption && (
            <p className="whitespace-pre-wrap">
              <span className="text-slate-500">正文：</span>
              {it.caption}
            </p>
          )}
          {it.first_comment && (
            <p className="whitespace-pre-wrap">
              <span className="text-slate-500">首评：</span>
              {it.first_comment}
            </p>
          )}
          {it.fact_summary ? (
            <p className="text-amber-700">事实要你看一眼：{it.fact_summary}</p>
          ) : (
            it.selectable && <p className="text-emerald-700">团目录核对：通过</p>
          )}
          {it.note && <p className="text-amber-700">{it.note}</p>}
          {it.blocked_reason && <p className="text-red-700">不能批：{it.blocked_reason}</p>}
          {renderExtra?.(it)}
        </li>
      ))}
    </ul>
  )
}
