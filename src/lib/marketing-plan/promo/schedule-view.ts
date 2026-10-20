/**
 * 排期表的「视图层」纯函数：把 expandPromoSchedule 的结果整理成页面要显示的样子。
 * 不读库、不写库、不派待办；只做分组、折叠、文案拼接。
 *
 * 约定：帖子 / 快拍属于「按频率的日常」，不逐日列出，只在顶部给一句汇总；
 * 其余（广告、短视频、博客、邮件）逐日列出，每天最多一行。阶段切换日取阶段的开始日。
 */

import type { Schedule, ScheduleKind } from './schedule'
import { ADS_APPROVAL_PAREN, isRealDate, isoWeekday, weekStartOf } from './schedule'
import { addDays } from './reconcile'

export const ROUTINE_KINDS: ScheduleKind[] = ['post', 'story']

export interface ViewPhase { id: string; name: string; start_date: string }

export interface ViewDayLine {
  date: string
  weekday: number
  kinds: ScheduleKind[]
  /** 当天每种类型的条数（短视频同天多条按多条算） */
  counts: Partial<Record<ScheduleKind, number>>
  text: string
  past: boolean
  isToday: boolean
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
  /** 校验过的「今天」（格式坏时退回排期第一天），页面用它算本周/下周 */
  today: string
  routine: string
  /** 表头固定提示（只有页面确认「真的没有在跑的广告」时才该显示，由调用方决定） */
  adsNote: string | null
  weeks: ViewWeek[]
}

const ADS_NOTE = '开投需要 PM 在广告审批页另行批准，目前广告没有投。'
const PAUSE_MARK = '；计划里的暂停区间：'
const NZ_TZ = 'Pacific/Auckland'

/** 新西兰日历日（YYYY-MM-DD）。页面是 NZ 的，凌晨 0–2 点用世界标准时间或悉尼时区都会差一天。 */
export function todayInNz(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: NZ_TZ }).format(now)
}

const isRoutine = (kind: ScheduleKind): boolean => ROUTINE_KINDS.includes(kind)
type Items = Schedule['days'][number]['items']

const fmtMoney = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2))

function adsParts(items: Items): { budgets: number[]; pause: string | null; raw: string[] } {
  const budgets: number[] = []
  const raw: string[] = []
  let pause: string | null = null
  for (const it of items) {
    if (it.kind !== 'ads_start') continue
    const m = /日预算 ([\d.]+)/.exec(it.text)
    if (m) budgets.push(Number(m[1]))
    else raw.push(it.text.split(ADS_APPROVAL_PAREN).join(''))
    const at = it.text.indexOf(PAUSE_MARK)
    if (at >= 0 && pause === null) pause = it.text.slice(at + PAUSE_MARK.length)
  }
  return { budgets, pause, raw }
}

/** 同一天的广告合成一句：每天预算合计（逐条相加）；不再写受众（库里只有数字编号，PM 看不懂）。 */
function adsSentence(items: Items, lead: string): string | null {
  const { budgets, pause, raw } = adsParts(items)
  const parts: string[] = []
  if (budgets.length > 0) {
    const total = budgets.reduce((a, b) => a + b, 0)
    const each = budgets.length > 1 ? `（${budgets.map(fmtMoney).join(' + ')}）` : ''
    parts.push(`${lead}每天预算合计 ${fmtMoney(total)}${each}${pause ? `；暂停区间 ${pause}` : ''}`)
  }
  parts.push(...raw)
  return parts.length > 0 ? parts.join('；') : null
}

function dayParts(items: Items, ctx: { firstStart: boolean; phase: ViewPhase | null }): string[] {
  const parts: string[] = []
  const adsLead = ctx.firstStart ? '开投：' : ctx.phase ? `进入阶段：${ctx.phase.name}，` : ''
  const ads = adsSentence(items, adsLead)
  if (ads) parts.push(ads)
  else if (ctx.phase && !ctx.firstStart) parts.push(`进入阶段：${ctx.phase.name}`)
  let reels = 0
  for (const it of items) {
    if (it.kind === 'reel') reels++
    else if (it.kind === 'blog' || it.kind === 'newsletter') parts.push(it.text)
  }
  if (reels === 1) parts.push('短视频')
  else if (reels > 1) parts.push(`短视频 ×${reels}`)
  return parts
}

function dayCounts(items: Items): Partial<Record<ScheduleKind, number>> {
  const out: Partial<Record<ScheduleKind, number>> = {}
  for (const it of items) if (!isRoutine(it.kind)) out[it.kind] = (out[it.kind] ?? 0) + 1
  return out
}

function dayKinds(items: Items): ScheduleKind[] {
  const out: ScheduleKind[] = []
  for (const it of items) if (!isRoutine(it.kind) && !out.includes(it.kind)) out.push(it.kind)
  return out
}

function buildLines(schedule: Schedule, today: string, phases: ViewPhase[]): ViewDayLine[] {
  const sorted = [...phases].sort((a, b) => a.start_date.localeCompare(b.start_date))
  const startOf = new Map(sorted.map(p => [p.start_date, p]))
  const byDate = new Map(schedule.days.map(d => [d.date, d.items]))
  const dates = Array.from(new Set([...byDate.keys(), ...sorted.slice(1).map(p => p.start_date)])).sort()
  const lines: ViewDayLine[] = []
  for (const date of dates) {
    const items = byDate.get(date) ?? []
    const phase = startOf.get(date) ?? null
    const firstStart = phase !== null && phase.id === sorted[0]?.id
    const parts = dayParts(items, { firstStart, phase })
    if (parts.length === 0) continue
    lines.push({
      date, weekday: isoWeekday(date), kinds: dayKinds(items), counts: dayCounts(items), text: parts.join('；'),
      past: date < today, isToday: date === today, phaseSwitch: phase && !firstStart ? phase.name : null,
    })
  }
  return lines
}

function modeOf(values: number[]): number {
  const freq = new Map<number, number>()
  for (const v of values) freq.set(v, (freq.get(v) ?? 0) + 1)
  let best = 0, bestN = -1
  for (const [v, n] of freq) if (n > bestN || (n === bestN && v > best)) { best = v; bestN = n }
  return best
}

function routineLine(schedule: Schedule): string {
  const { post, story } = schedule.totals
  if (post === 0 && story === 0) return '这份计划没有排帖子和快拍'
  const perWeek = (kind: ScheduleKind): number => {
    const byWeek = new Map<string, number>()
    for (const d of schedule.days) {
      const n = d.items.filter(i => i.kind === kind).length
      if (n > 0) byWeek.set(weekStartOf(d.date), (byWeek.get(weekStartOf(d.date)) ?? 0) + n)
    }
    return modeOf(Array.from(byWeek.values()))
  }
  const parts: string[] = []
  if (post > 0) parts.push(`帖子每周约 ${perWeek('post')} 条`)
  if (story > 0) parts.push(`快拍每周约 ${perWeek('story')} 条`)
  return `${parts.join('、')}，按计划频率发，不逐日列出`
}

const SUMMARY_ORDER: { kind: ScheduleKind; label: string }[] = [
  { kind: 'ads_start', label: '广告' }, { kind: 'newsletter', label: '邮件' },
  { kind: 'blog', label: '博客' }, { kind: 'reel', label: '短视频' },
]

function weekSummary(weekStart: string, counts: Partial<Record<ScheduleKind, number>>, hasSwitch: boolean, past: boolean): string {
  const head = `${weekStart.slice(5).replace('-', '/')} 周`
  const parts = SUMMARY_ORDER.filter(k => (counts[k.kind] ?? 0) > 0).map(k => `${k.label} ${counts[k.kind]}`)
  const body = parts.length > 0 ? `${head} · ${parts.join(' · ')}` : hasSwitch ? `${head} · 阶段切换` : head
  return past ? `${body}（已过）` : body
}

function groupWeeks(lines: ViewDayLine[], today: string): ViewWeek[] {
  const w0 = weekStartOf(today)
  const next = addDays(w0, 7)
  const byWeek = new Map<string, ViewDayLine[]>()
  for (const line of lines) {
    const week = weekStartOf(line.date)
    byWeek.set(week, [...(byWeek.get(week) ?? []), line])
  }
  for (const week of [w0, next]) if (!byWeek.has(week)) byWeek.set(week, [])
  return Array.from(byWeek.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([weekStart, days]) => {
    const counts: Partial<Record<ScheduleKind, number>> = {}
    for (const day of days) for (const kind of day.kinds) counts[kind] = (counts[kind] ?? 0) + (day.counts[kind] ?? 0)
    const hasSwitch = days.some(d => d.phaseSwitch !== null)
    const expanded = weekStart === w0 || weekStart === next
    return { weekStart, expanded, days, counts, summary: weekSummary(weekStart, counts, hasSwitch, addDays(weekStart, 6) < today) }
  })
}

/** today 格式坏了不让整页报错：退回排期里的第一天（再没有就用一个固定日期）。 */
function safeToday(schedule: Schedule, today: string): string {
  if (isRealDate(today)) return today
  return schedule.days[0]?.date ?? '2026-01-05'
}

export function buildScheduleView(schedule: Schedule, today: string, phases: ViewPhase[] = []): ScheduleView {
  const day = safeToday(schedule, today)
  const hasAds = schedule.days.some(d => d.items.some(i => i.kind === 'ads_start' && i.text.includes(ADS_APPROVAL_PAREN)))
  return {
    today: day,
    routine: routineLine(schedule),
    adsNote: hasAds ? ADS_NOTE : null,
    weeks: groupWeeks(buildLines(schedule, day, phases), day),
  }
}
