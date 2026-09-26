import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardGlobalAdmin } from '@/lib/auth/require-admin'
import { loadManualItems } from '@/lib/pm-todo/manual-items'
import { collapseManualItems, commonHref } from '@/lib/pm-todo/daily-todo'
import { laneOf } from '@/lib/pm-todo/five-kinds'

/**
 * GET /api/admin/dev-debt —— 从 PM 今日待办挪出来的「开发欠账」（PM 2026-09-26 拍板
 * 今日待办只留五类，见 src/lib/pm-todo/five-kinds.ts）。
 *
 * 跟今日待办读的是同一份 `loadManualItems`、同一张车道表 `laneOf`，所以两边不会对不上：
 * PM 那边少了哪条，这里就多了哪条。页面在 /dashboard/admin/cron-health#dev-debt。
 *
 * 只给全局管理员：这份清单横跨所有客户。
 */

export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await guardGlobalAdmin()
  if (guard) return guard

  try {
    const items = await loadManualItems(supabaseAdmin)
    const rows = collapseManualItems(items.filter((m) => laneOf(m) === 'dev')).map(
      ({ item, count, hrefs, samples }) => ({
        kind: item.kind,
        client_name: item.client_name,
        what: item.what,
        how: item.how,
        href: count > 1 ? commonHref(hrefs) : item.href,
        count,
        samples,
      }),
    )
    return NextResponse.json({ rows })
  } catch (err) {
    // 读挂了要说出来 —— 页面上显示「没读出来」，不能显示成「没有欠账」
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
