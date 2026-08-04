import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin } from '@/lib/auth/require-admin'
import { loadTodoCounts, nzWeekday, DAY_THEMES, ZH_DAYS } from '@/lib/pm-todo/daily-todo'

/**
 * GET /api/workbench/today (22.E.S18 前置)
 *
 * The single source for "what needs a human today": rolling weekday theme +
 * live counts of drafts/findings/cards awaiting review. Consumed by the
 * /dashboard/today page; the pm-daily-todo email renders the same lib data,
 * so inbox and dashboard never disagree.
 */

export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await guardAdmin()
  if (guard) return guard

  const now = new Date()
  const weekday = nzWeekday(now)

  const counts = await loadTodoCounts(supabaseAdmin)

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
  })
}
