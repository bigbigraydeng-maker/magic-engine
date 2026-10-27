/**
 * 推广计划排期表（纯函数，不读库、不写库）：把计划里的「每周几条 / 每月几条 / 到期日」摊成「哪天做什么」。
 * 只用于页面展示：不派待办、不生成内容、不碰任何账户。
 *
 * 日期全部按 UTC 日历天算（字符串上加减，无时区、无夏令时问题）。逐日循环一律按「天数」计数，
 * 不靠字符串比较判断结束（年份太大时 addDays 会产生带 + 号的怪字符串，字符串比较会死循环）。
 * 平台通用：不出现客户名 / 行业词；摆法与防护阈值来自 playbooks.ts 的默认值（标 unvalidated_default）。
 */

import { addDays, daysBetween } from './reconcile'
import type { PromoPlaybook } from './playbooks'
import type { PromoPhase, PromoSpec, PromoStep } from './spec'

export type ScheduleKind = 'post' | 'story' | 'reel' | 'blog' | 'newsletter' | 'ads_start'

export interface ScheduleItem {
  kind: ScheduleKind
  phase_id: string
  step_id: string
  /** 给人看的一句话，只复述计划里写的内容 */
  text: string
}

export interface ScheduleDay {
  date: string
  items: ScheduleItem[]
}

export interface ScheduleTotals {
  post: number
  story: number
  reel: number
  blog: number
  newsletter: number
  ads_start: number
}

export interface Schedule {
  days: ScheduleDay[]
  totals: ScheduleTotals
  notes: string[]
  /** 日期不合法等无法展开的原因；有值时 days 为空 */
  error: string | null
  /** 条数太多：只给汇总，不展开逐日 */
  too_dense: boolean
}

/** 广告开投日条目里的固定提示（展示层要原样识别并去掉，所以两边共用这一个常量） */
export const ADS_APPROVAL_PAREN = '（开投需要 PM 在广告审批页另行批准，目前广告没有投）'

const MAX_PER_WEEK = 7
const MAX_REELS_PER_MONTH = 1000
const MAX_NOTES = 20
const MAX_TEXT = 80
const MIN_YEAR = 2000
const MAX_YEAR = 2100

const KIND_ORDER: Record<ScheduleKind, number> = { ads_start: 0, blog: 1, newsletter: 2, post: 3, story: 4, reel: 5 }

const emptyTotals = (): ScheduleTotals => ({ post: 0, story: 0, reel: 0, blog: 0, newsletter: 0, ads_start: 0 })

/** 真实存在的日历日，且年份在 2000–2100 之间（再远的日期没有排期意义，也会让日期加减出怪字符串）。 */
export function isRealDate(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const year = Number(day.slice(0, 4))
  if (year < MIN_YEAR || year > MAX_YEAR) return false
  const d = new Date(`${day}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day
}

/** ISO 星期：周一=1 … 周日=7（调用前须保证是真实日期）。 */
export function isoWeekday(day: string): number {
  const w = new Date(`${day}T00:00:00Z`).getUTCDay()
  return w === 0 ? 7 : w
}

/** 该日期所在周的周一（周一起算的日历周）。 */
export function weekStartOf(day: string): string {
  return addDays(day, 1 - isoWeekday(day))
}

const clip = (text: string) => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text)

interface PhaseDay { date: string; wd: number }
type Social = Extract<PromoStep, { kind: 'social_cadence' }>
type Ctx = { phase: PromoPhase; days: PhaseDay[]; pb: PromoPlaybook; items: Map<string, ScheduleItem[]>; notes: Map<string, number> }

function note(ctx: Ctx, text: string): void {
  ctx.notes.set(text, (ctx.notes.get(text) ?? 0) + 1)
}

function push(ctx: Ctx, date: string, item: ScheduleItem): void {
  const list = ctx.items.get(date) ?? []
  list.push(item)
  ctx.items.set(date, list)
}

function weeklyWeekdays(perWeek: number, pb: PromoPlaybook, shift: number): Set<number> {
  const n = Math.min(Math.max(0, Math.floor(perWeek)), MAX_PER_WEEK)
  return new Set((pb.scheduleWeekdays[n] ?? []).map(w => ((w - 1 + shift) % 7) + 1))
}

function expandWeekly(ctx: Ctx, step: Social, kind: 'post' | 'story', perWeek: number): void {
  if (!(Math.floor(perWeek) > 0)) return
  const name = kind === 'post' ? '帖子' : '快拍'
  if (perWeek > MAX_PER_WEEK) note(ctx, `${ctx.phase.name}：每周最多排 ${MAX_PER_WEEK} 条${name}，计划里写的更多，只排了 ${MAX_PER_WEEK} 条。`)
  const wds = weeklyWeekdays(perWeek, ctx.pb, kind === 'story' ? ctx.pb.storyWeekdayShift : 0)
  const hits = ctx.days.filter(d => wds.has(d.wd))
  hits.forEach(d => push(ctx, d.date, { kind, phase_id: ctx.phase.id, step_id: step.id, text: `发一条${name}` }))
  if (hits.length === 0) note(ctx, `${ctx.phase.name}：阶段太短，没有碰到${name}的排期日，这一段没排上。`)
}

function expandReels(ctx: Ctx, step: Social): void {
  const perMonth = Math.min(Math.max(0, Math.floor(step.settings.reels_per_month)), MAX_REELS_PER_MONTH)
  if (!(perMonth > 0)) return
  const candidates = ctx.days.filter(d => ctx.pb.reelWeekdays.includes(d.wd))
  if (candidates.length === 0) {
    note(ctx, `${ctx.phase.name}：阶段内没有适合排短视频的日子，短视频这一段没排上。`)
    return
  }
  const count = Math.min(Math.max(1, Math.round((ctx.days.length * perMonth) / 30)), candidates.length)
  for (let k = 0; k < count; k++) {
    const date = candidates[Math.floor(((k + 0.5) * candidates.length) / count)].date
    push(ctx, date, { kind: 'reel', phase_id: ctx.phase.id, step_id: step.id, text: '做一条短视频（走视频工厂）' })
  }
}

function expandDated(ctx: Ctx, step: Extract<PromoStep, { kind: 'blog_article' | 'newsletter_email' }>): void {
  const due = step.settings.due_date
  const label = step.kind === 'blog_article' ? '博客' : '邮件'
  if (due < ctx.phase.start_date || due > ctx.phase.end_date) {
    note(ctx, `${ctx.phase.name}：「${clip(step.settings.topic)}」的${label}到期日不在这个阶段内，没排上。`)
    return
  }
  push(ctx, due, {
    kind: step.kind === 'blog_article' ? 'blog' : 'newsletter', phase_id: ctx.phase.id, step_id: step.id,
    text: `${label}到期：${clip(step.settings.topic)}`,
  })
}

function expandAds(ctx: Ctx, step: Extract<PromoStep, { kind: 'ads_campaign' }>): void {
  const s = step.settings
  const start = ctx.phase.start_date
  const pauses = s.paused_ranges.filter(r => r.to >= start && r.from <= ctx.phase.end_date).slice(0, 3)
  const pausedText = pauses.length > 0 ? `；计划里的暂停区间：${pauses.map(r => `${r.from} 至 ${r.to}`).join('、')}` : ''
  push(ctx, start, {
    kind: 'ads_start', phase_id: ctx.phase.id, step_id: step.id,
    text: `计划开投日${ADS_APPROVAL_PAREN}：日预算 ${(s.daily_budget_cents / 100).toFixed(2)}（币种以广告账户为准），受众引用 ${clip(s.audience_ref)}${pausedText}`,
  })
}

function expandStep(ctx: Ctx, step: PromoStep): void {
  switch (step.kind) {
    case 'social_cadence':
      expandWeekly(ctx, step, 'post', step.settings.posts_per_week)
      expandWeekly(ctx, step, 'story', step.settings.stories_per_week)
      expandReels(ctx, step)
      return
    case 'blog_article':
    case 'newsletter_email':
      expandDated(ctx, step)
      return
    case 'ads_campaign':
      expandAds(ctx, step)
      return
  }
}

function invalid(error: string): Schedule {
  return { days: [], totals: emptyTotals(), notes: [], error, too_dense: false }
}

/** 逐阶段校验日期与跨度，任何一项不过就不展开。 */
function precheck(phases: PromoPhase[], pb: PromoPlaybook): string | null {
  if (phases.reduce((n, p) => n + p.steps.length, 0) > pb.scheduleMaxSteps) return '计划里的步骤太多，没法逐日排期。请合并相似的步骤。'
  let span = 0
  for (const [i, phase] of phases.entries()) {
    if (!isRealDate(phase.start_date) || !isRealDate(phase.end_date)) {
      return `「${phase.name}」的起止日期不是真实日期（需在 ${MIN_YEAR}–${MAX_YEAR} 年之间），请到填表区改正后再看排期。`
    }
    if (phase.end_date < phase.start_date) return `「${phase.name}」的结束日早于开始日。`
    if (i > 0 && phase.start_date <= phases[i - 1].end_date) return `「${phases[i - 1].name}」和「${phase.name}」的日期重叠。`
    span += daysBetween(phase.start_date, phase.end_date) + 1
    if (span > pb.scheduleMaxSpanDays) return '计划的时间跨度太长，没法逐日排期。请缩短阶段。'
  }
  return null
}

function dueDatesAreReal(phases: PromoPhase[]): boolean {
  return phases.every(p => p.steps.every(s => (s.kind !== 'blog_article' && s.kind !== 'newsletter_email') || isRealDate(s.settings.due_date)))
}

function phaseDays(phase: PromoPhase): PhaseDay[] {
  const len = daysBetween(phase.start_date, phase.end_date) + 1
  return Array.from({ length: len }, (_, i) => {
    const date = addDays(phase.start_date, i)
    return { date, wd: isoWeekday(date) }
  })
}

export function expandPromoSchedule(spec: PromoSpec, pb: PromoPlaybook): Schedule {
  const phases = [...spec.phases].sort((a, b) => a.start_date.localeCompare(b.start_date))
  const bad = precheck(phases, pb)
  if (bad) return invalid(bad)
  if (!dueDatesAreReal(phases)) return invalid('有博客或邮件的到期日不是真实日期，请到填表区改正后再看排期。')

  const items = new Map<string, ScheduleItem[]>()
  const notes = new Map<string, number>()
  for (const phase of phases) {
    const ctx: Ctx = { phase, days: phaseDays(phase), pb, items, notes }
    for (const step of phase.steps) expandStep(ctx, step)
  }

  const totals = emptyTotals()
  let count = 0
  for (const list of items.values()) for (const it of list) { totals[it.kind]++; count++ }
  const noteList = Array.from(notes.entries()).slice(0, MAX_NOTES).map(([t, n]) => (n > 1 ? `${t}（共 ${n} 处）` : t))
  if (notes.size > MAX_NOTES) noteList.push(`另有 ${notes.size - MAX_NOTES} 条类似说明没有列出。`)
  if (count > pb.scheduleMaxItems) return { days: [], totals, notes: noteList, error: null, too_dense: true }

  const days = Array.from(items.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => ({ date, items: [...list].sort((x, y) => KIND_ORDER[x.kind] - KIND_ORDER[y.kind]) }))
  return { days, totals, notes: noteList, error: null, too_dense: false }
}
