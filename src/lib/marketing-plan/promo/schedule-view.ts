/**
 * 排期表的「视图层」纯函数：把 expandPromoSchedule 的结果整理成页面要显示的样子。
 * 不读库、不写库、不派待办；只做分组、折叠、文案拼接。
 *
 * 约定：帖子 / 快拍属于「按频率的日常」，不逐日列出，只在顶部给一句汇总；
 * 其余（广告开投、短视频、博客、邮件）逐日列出。阶段切换单独标一行。
 */

import type { Schedule, ScheduleKind } from './schedule'
import { addDays } from './reconcile'
import { isoWeekday, weekStartOf } from './schedule'

export const ROUTINE_KINDS: ScheduleKind[] = ['post', 'story']

export interface ViewDayLine {
  date: string
  weekday: number
  kinds: ScheduleKind[]
  /** 当天每种类型的条数（短视频同天多条按多条算） */
  counts: Partial<Record<ScheduleKind, number>>
  text: string
  past: boolean
  phaseSwitch: string | null
}

export interface ViewWeek {
  weekStart: string
  expanded: boolean
  days: ViewDayLine[]
  counts: Partial<Record<ScheduleKind, number>>
  summary: string
}

export interface ScheduleView {
  routine: string
  adsNote: string | null
  weeks: ViewWeek[]
}

const ADS_PAREN = '（开投需要 PM 在广告审批页另行批准，目前广告没有投）'
const ADS_NOTE = '开投需要 PM 在广告审批页另行批准，目前广告没有投。'
const ADS_PREFIX = '计划开投日'

const isRoutine = (kind: ScheduleKind): boolean => ROUTINE_KINDS.includes(kind)

/** 每个阶段第一次出现的日期（按 schedule.days 顺序，取最早）；第一个阶段不算切换。 */
function phaseSwitchDates(schedule: Schedule): Map<string, string> {
  const firstSeen = new Map<string, string>()
  for (const day of schedule.days) {
    for (const it of day.items) {
      if (!firstSeen.has(it.phase_id)) firstSeen.set(it.phase_id, day.date)
    }
  }
  const out = new Map<string, string>()
  let first = true
  for (const [id, date] of firstSeen) {
    if (first) { first = false; continue }
    out.set(date, id)
  }
  return out
}

function adsText(text: string): string {
  const stripped = text.split(ADS_PAREN).join('')
  return stripped.startsWith(ADS_PREFIX) ? `开投${stripped.slice(ADS_PREFIX.length)}` : stripped
}

/** 把一天里非日常的条目拼成一句话；同一天多条短视频合并成一条。 */
function dayText(items: Schedule['days'][number]['items'], phaseSwitch: string | null): string {
  const parts: string[] = []
  let reels = 0
  for (const it of items) {
    if (isRoutine(it.kind)) continue
    if (it.kind === 'reel') { reels++; continue }
    if (it.kind === 'ads_start') parts.push(adsText(it.text))
    else parts.push(it.text)
  }
  if (reels === 1) parts.push('短视频')
  else if (reels > 1) parts.push(`短视频 ×${reels}`)
  if (phaseSwitch) parts.push(phaseSwitch)
  return parts.join('；')
}

function dayCounts(items: Schedule['days'][number]['items']): Partial<Record<ScheduleKind, number>> {
  const out: Partial<Record<ScheduleKind, number>> = {}
  for (const it of items) if (!isRoutine(it.kind)) out[it.kind] = (out[it.kind] ?? 0) + 1
  return out
}

function dayKinds(items: Schedule['days'][number]['items']): ScheduleKind[] {
  const out: ScheduleKind[] = []
  for (const it of items) {
    if (isRoutine(it.kind)) continue
    if (!out.includes(it.kind)) out.push(it.kind)
  }
  return out
}

function buildLines(schedule: Schedule, today: string, phaseNames?: Record<string, string>): ViewDayLine[] {
  const switches = phaseSwitchDates(schedule)
  const lines: ViewDayLine[] = []
  for (const day of schedule.days) {
    const phaseId = switches.get(day.date)
    const phaseSwitch = phaseId ? `进入阶段：${phaseNames?.[phaseId] ?? phaseId}` : null
    const kinds = dayKinds(day.items)
    if (kinds.length === 0 && !phaseSwitch) continue
    lines.push({
      date: day.date,
      weekday: isoWeekday(day.date),
      kinds,
      counts: dayCounts(day.items),
      text: dayText(day.items, phaseSwitch),
      past: day.date < today,
      phaseSwitch,
    })
  }
  return lines
}

function routineLine(schedule: Schedule): string {
  const post = schedule.totals.post
  const story = schedule.totals.story
  if (post === 0 && story === 0) return '这份计划没有排帖子和快拍'
  const parts: string[] = []
  if (post > 0) parts.push(`帖子 ${post} 条`)
  if (story > 0) parts.push(`快拍 ${story} 条`)
  return `帖子和快拍按计划频率发，这里不逐日列出（共 ${parts.join('、')}）`
}

function adsNoteOf(schedule: Schedule): string | null {
  for (const day of schedule.days) {
    for (const it of day.items) {
      if (it.kind === 'ads_start' && it.text.includes(ADS_PAREN)) return ADS_NOTE
    }
  }
  return null
}

const SUMMARY_ORDER: { kind: ScheduleKind; label: string }[] = [
  { kind: 'ads_start', label: '广告' },
  { kind: 'newsletter', label: '邮件' },
  { kind: 'blog', label: '博客' },
  { kind: 'reel', label: '短视频' },
]

function weekSummary(weekStart: string, counts: Partial<Record<ScheduleKind, number>>, hasSwitch: boolean): string {
  const head = `${weekStart.slice(5).replace('-', '/')} 周`
  const parts = SUMMARY_ORDER.filter(k => (counts[k.kind] ?? 0) > 0).map(k => `${k.label} ${counts[k.kind]}`)
  if (parts.length > 0) return `${head} · ${parts.join(' · ')}`
  if (hasSwitch) return `${head} · 阶段切换`
  return head
}

function groupWeeks(lines: ViewDayLine[], today: string): ViewWeek[] {
  const w0 = weekStartOf(today)
  const next = addDays(w0, 7)
  const byWeek = new Map<string, ViewDayLine[]>()
  for (const line of lines) {
    const week = weekStartOf(line.date)
    const list = byWeek.get(week) ?? []
    list.push(line)
    byWeek.set(week, list)
  }
  for (const week of [w0, next]) if (!byWeek.has(week)) byWeek.set(week, [])

  return Array.from(byWeek.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, days]) => {
      const counts: Partial<Record<ScheduleKind, number>> = {}
      let hasSwitch = false
      for (const day of days) {
        if (day.phaseSwitch) hasSwitch = true
        for (const kind of day.kinds) counts[kind] = (counts[kind] ?? 0) + (day.counts[kind] ?? 0)
      }
      const expanded = weekStart === w0 || weekStart === next
      return { weekStart, expanded, days, counts, summary: weekSummary(weekStart, counts, hasSwitch) }
    })
}

export function buildScheduleView(schedule: Schedule, today: string, phaseNames?: Record<string, string>): ScheduleView {
  const lines = buildLines(schedule, today, phaseNames)
  return {
    routine: routineLine(schedule),
    adsNote: adsNoteOf(schedule),
    weeks: groupWeeks(lines, today),
  }
}
