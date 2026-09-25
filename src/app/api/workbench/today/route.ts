import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardGlobalAdmin } from '@/lib/auth/require-admin'
import { loadTodoCounts, nzWeekday, DAY_THEMES, ZH_DAYS } from '@/lib/pm-todo/daily-todo'

/**
 * GET /api/workbench/today (22.E.S18 前置)
 *
 * The single source for "what needs a human today": rolling weekday theme +
 * live counts of drafts/findings/cards awaiting review. Consumed by the
 * /dashboard/today page; the pm-daily-todo email renders the same lib data,
 * so inbox and dashboard never disagree.
 *
 * Global admins only: the payload is every client's to-do list (client names,
 * manual what/how text, connection-health items), and loading it can fire
 * live provider probes. `guardAdmin` also admits scoped
 * DEMO_ADMINS accounts; the middleware already bounces them off the page,
 * but /api/* is outside its matcher, so the API must gate itself.
 */

export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await guardGlobalAdmin()
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
