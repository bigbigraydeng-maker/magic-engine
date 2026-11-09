/**
 * Weekly-report block for the SEO weekly list (docs v0.2 §四).
 * Counts only what the system verified; a human's "done" click is shown separately.
 * The goal line is a trend, never an attribution to any single action.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { SEO_LOOP_METRIC_KEY } from './config'

const DAY_MS = 86_400_000
const REPORT_ROW_CAP = 1000

export interface SeoListItemLine {
  title: string
  due_date: string | null
}

export interface SeoListWeekly {
  goal_title: string
  goal_current: number | null
  goal_target: number
  goal_baseline: number
  goal_period_end: string
  listed_this_week: SeoListItemLine[]
  open_now: number
  verified_pass_week: number
  claimed_not_verified: number
  abandoned_week: SeoListItemLine[]
  /** Median days from list creation to verified completion over the last 90 days; null if none yet. */
  median_days_to_verified: number | null
}

export type SeoListWeeklyResult = SeoListWeekly | { error: string } | null

interface ItemRow {
  id: string
  title: string
  status: string
  created_at: string
  updated_at: string
  completed_at: string | null
  due_date: string | null
  steps_json: Record<string, unknown> | null
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export async function gatherSeoListWeekly(
  supabase: SupabaseClient,
  clientId: string,
  now: Date,
): Promise<SeoListWeeklyResult> {
  try {
    const { data: goal, error: gErr } = await supabase
      .from('goals')
      .select('title, baseline_value, target_value, current_value, period_end')
      .eq('client_id', clientId)
      .eq('primary_metric_key', SEO_LOOP_METRIC_KEY)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (gErr) return { error: gErr.message }
    if (!goal) return null

    const since90 = new Date(now.getTime() - 90 * DAY_MS).toISOString()
    const { data: rows, error: iErr } = await supabase
      .from('execution_items')
      .select('id, title, status, created_at, updated_at, completed_at, due_date, steps_json')
      .eq('client_id', clientId)
      .eq('dimension', 'seo')
      .eq('source', 'zhuge')
      .gte('created_at', since90)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(REPORT_ROW_CAP)
    if (iErr) return { error: iErr.message }
    if ((rows ?? []).length >= REPORT_ROW_CAP) return { error: `读满 ${REPORT_ROW_CAP} 行上限，数据可能不全，先不出数` }
    const items = ((rows ?? []) as ItemRow[]).filter(r => r.steps_json?.loop === 'seo_goal_v1')

    const weekAgo = now.getTime() - 7 * DAY_MS
    const g = goal as { title: string; baseline_value: number | string; target_value: number | string; current_value: number | string | null; period_end: string }
    const passed = (r: ItemRow) => (r.steps_json?.verify as { state?: string } | undefined)?.state === 'pass'
    const verified = items.filter(r => r.status === 'completed' && passed(r))
    return {
      goal_title: g.title,
      goal_current: g.current_value === null ? null : Number(g.current_value),
      goal_target: Number(g.target_value),
      goal_baseline: Number(g.baseline_value),
      goal_period_end: g.period_end,
      listed_this_week: items.filter(r => Date.parse(r.created_at) >= weekAgo).map(r => ({ title: r.title, due_date: r.due_date })),
      open_now: items.filter(r => r.status === 'pending' || r.status === 'in_progress').length,
      verified_pass_week: verified.filter(r => r.completed_at !== null && Date.parse(r.completed_at) >= weekAgo).length,
      claimed_not_verified: items.filter(r => r.status === 'completed' && !passed(r)).length,
      abandoned_week: items
        .filter(r => r.status === 'skipped' && r.steps_json?.skip_reason === 'expired_no_action' && Date.parse(r.updated_at) >= weekAgo)
        .map(r => ({ title: r.title, due_date: r.due_date })),
      median_days_to_verified: median(
        verified.filter(r => r.completed_at !== null).map(r => (Date.parse(r.completed_at as string) - Date.parse(r.created_at)) / DAY_MS),
      ),
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Plain-Chinese lines (HTML-escaped) for the SEO block of the weekly report. */
export function seoListLines(d: SeoListWeeklyResult, boardHref: string): string[] {
  if (d === null) return []
  if ('error' in d) return [`SEO 每周清单：数据没读出来（${esc(d.error)}）`]
  const lines: string[] = []
  const cur = d.goal_current === null ? '还没取到' : String(d.goal_current)
  lines.push(
    `SEO 目标「${esc(d.goal_title)}」：现在 <b>${cur}</b>，起点 ${d.goal_baseline}，目标 ${d.goal_target}（到 ${esc(d.goal_period_end)}）。只看趋势，不把涨跌算到某一件事头上。`,
  )
  lines.push(
    `本周清单 <b>${d.listed_this_week.length}</b> 项；系统核对通过 <b>${d.verified_pass_week}</b> 项；还在进行 ${d.open_now} 项；人点了完成但系统没核对通过 ${d.claimed_not_verified} 项；本周放弃 ${d.abandoned_week.length} 项。`,
  )
  lines.push(
    d.median_days_to_verified === null
      ? '从出清单到核对通过的中位天数：还没有数据（目标是第一个月压到 7 天内）。'
      : `从出清单到核对通过的中位天数：<b>${d.median_days_to_verified.toFixed(1)}</b> 天（目标 ≤7）。`,
  )
  for (const it of d.listed_this_week) lines.push(`· ${esc(it.title)}${it.due_date ? `（计划 ${esc(it.due_date)}）` : ''}`)
  if (d.abandoned_week.length > 0) {
    lines.push(`放弃清单（超期没人处理，可在看板里改回待办）：${d.abandoned_week.map(a => esc(a.title)).join('；')} → <a href="${esc(boardHref)}">打开看板</a>`)
  }
  return lines
}
