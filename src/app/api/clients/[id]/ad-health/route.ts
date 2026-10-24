/**
 * GET /api/clients/[id]/ad-health
 *
 * Returns the Ad Strategy Engine's latest daily verdict for a client, plus a
 * short history of overall verdicts for the trend strip. Read by the ads-health
 * dashboard (P21.K.3). Everything shown is computed by the daily cron and
 * stored in ad_health_narratives — this route only reads.
 *
 * Query params:
 *   history — days of overall-verdict history to include (default 30, max 90)
 *
 * Returns: { success, latest: { insight_date, overall_verdict, headline, payload } | null,
 *            history: [{ insight_date, overall_verdict }], industry: string | null, growth }
 *
 * `growth`: only staff who can see every client get the raw ads_growth_states row. Everyone
 * else — paid clients, demo/scoped admins (tier 'admin' but pinned to one client), and any
 * tier added later — gets the whitelisted client view (toClientGrowthView). Internal
 * findings such as D11 never reach a client browser.
 *
 * Reference: docs/superpowers/specs/2026-07-13-ad-strategy-engine.md §8.1
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import {
  CLIENT_GROWTH_LOOKBACK_ROWS,
  toClientGrowthView,
  type GrowthRowForClient,
} from '@/lib/ads-strategy/agents/growth-client-view'
import { overlayLiveGoal } from '@/lib/ads-strategy/agents/growth-live-goal'
import { requireBookingAccess } from '@/lib/crm/booking-access'
import { loadCompanyConfirmedBookingOutcome, unknownCompanyConfirmedBookingOutcome } from '@/lib/ads-strategy/portfolio/company-confirmed-bookings'
import { shiftDate } from '@/lib/ads-strategy/portfolio/diagnostics/context'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  // Fail-closed: anything that is not an unscoped admin sees the client view.
  const fullView = access.tier === 'admin' && access.allowedClientId === null

  const rawHistory = req.nextUrl.searchParams.get('history')
  const historyDays = Math.min(parseInt(rawHistory ?? '30', 10) || 30, 90)

  const [latestRes, historyRes, clientRes, growthRes] = await Promise.all([
    supabaseAdmin
      .from('ad_health_narratives')
      .select('insight_date, overall_verdict, headline, payload')
      .eq('client_id', clientId)
      .order('insight_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('ad_health_narratives')
      .select('insight_date, overall_verdict')
      .eq('client_id', clientId)
      .order('insight_date', { ascending: false })
      .limit(historyDays),
    // Industry only picks the words the page shows (ads playbook, G11).
    supabaseAdmin
      .from('clients')
      .select('industry')
      .eq('id', clientId)
      .maybeSingle(),
    // 卫青巡察当天的经营状态（spec 2026-09-24 §4）：问题 + 机会 + 目标节奏。
    // 读失败不挡整页——老的体检卡片仍要能显示，页面自己会说这一段读不到。
    // 客户版要往回看几天（连续命中门槛），员工版只要最新一行。
    supabaseAdmin
      .from('ads_growth_states')
      .select('client_id, date, payload, problems_count, opportunities_count, goal_pace, data_completeness')
      .eq('client_id', clientId)
      .order('date', { ascending: false })
      .limit(fullView ? 1 : CLIENT_GROWTH_LOOKBACK_ROWS),
  ])
  if (clientRes.error) {
    console.warn('[api/ad-health] 读客户行业失败，页面改用中性词', { clientId, error: clientRes.error.message })
  }

  if (latestRes.error) {
    return NextResponse.json({ error: latestRes.error.message }, { status: 500 })
  }

  if (growthRes.error) {
    console.warn('[api/ad-health] 读经营状态失败，页面只显示体检部分', { clientId, error: growthRes.error.message })
  }

  const growthRows = (growthRes.data ?? []) as GrowthRowForClient[]
  // 目标卡读当前生效的目标（员工版）：每日缓存行里的目标最多晚一天，目标刚改/刚换时会显示旧的。
  // 今天还没有缓存行（null）时不覆盖——页面照旧说「今天还没巡察」。
  const growth = growthRes.error
    ? undefined
    : fullView
      ? (growthRows[0] ? await overlayLiveGoal(clientId, growthRows[0]) : null)
      : toClientGrowthView(growthRows, new Date())

  // CRM booking facts are more restricted than the normal client Ads Health view.
  // The existing booking gate is required, and only a complete global-admin view
  // receives the separately labelled CRM result (never the CRM row identities).
  let companyConfirmedBookings: Awaited<ReturnType<typeof loadCompanyConfirmedBookingOutcome>> | undefined
  const latestInsightDate = (latestRes.data as { insight_date?: string | null } | null)?.insight_date
  if (fullView && latestInsightDate) {
    const bookingAccess = await requireBookingAccess(clientId, 'view')
    if (bookingAccess.ok) {
      companyConfirmedBookings = await loadCompanyConfirmedBookingOutcome(
        clientId,
        shiftDate(latestInsightDate, -6),
        latestInsightDate,
      )
    } else {
      companyConfirmedBookings = unknownCompanyConfirmedBookingOutcome(
        shiftDate(latestInsightDate, -6),
        latestInsightDate,
        'CRM 预订读取权限或配置不可用',
      )
    }
  }

  return NextResponse.json({
    success: true,
    latest: latestRes.data ?? null,
    // Oldest → newest for the trend strip.
    history: (historyRes.data ?? []).slice().reverse(),
    industry: (clientRes.data as { industry?: string | null } | null)?.industry ?? null,
    ...(companyConfirmedBookings ? { company_confirmed_bookings: companyConfirmedBookings } : {}),
    // 🔴 读失败与「今天还没跑」必须分得开：前者页面要说「读不到」，后者说「今天还没巡察」。
    growth,
  })
}
