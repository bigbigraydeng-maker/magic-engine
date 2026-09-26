import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin } from '@/lib/auth/require-admin'
import {
  loadTodoCounts,
  buildTodoView,
  routedElsewhereNote,
  DEV_DEBT_URL,
  nzWeekday,
  DAY_THEMES,
  ZH_DAYS,
} from '@/lib/pm-todo/daily-todo'

/**
 * GET /api/workbench/today (22.E.S18 前置)
 *
 * The single source for "what needs a human today": rolling weekday theme +
 * live counts of drafts/findings/cards awaiting review. Consumed by the
 * /dashboard/today page; the pm-daily-todo email renders the same lib data,
 * so inbox and dashboard never disagree.
 */

export const dynamic = 'force-dynamic'

const LINK_CHECK_BUDGET_MS = 2_500

export async function GET() {
  const guard = await guardAdmin()
  if (guard) return guard

  const now = new Date()
  const weekday = nzWeekday(now)

  // 有人在盯着转圈：外网链接检查最多等这么久，没验完的先放行（见 dropBrokenLinks）
  const counts = await loadTodoCounts(supabaseAdmin, { linkCheckBudgetMs: LINK_CHECK_BUDGET_MS })
  const view = buildTodoView(counts)

  return NextResponse.json({
    weekday,
    weekday_label: ZH_DAYS[weekday],
    theme: DAY_THEMES[weekday] ?? null,
    nz_date: now.toLocaleDateString('en-NZ', {
      timeZone: 'Pacific/Auckland',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }),
    counts,
    // 页面只渲染这个 —— 跟 pm-daily-todo 邮件是同一个函数算出来的，两边不会对不上
    view,
    routed_note: routedElsewhereNote(view),
    dev_debt_url: view.routedToDev > 0 || view.cronFailures24h > 0 ? DEV_DEBT_URL : null,
  })
}
