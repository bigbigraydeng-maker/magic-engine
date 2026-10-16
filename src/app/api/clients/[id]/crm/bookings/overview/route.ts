import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBookingAccess } from '@/lib/crm/booking-access'
import {
  internalErrorResponse,
  invalidRequest,
  notEnabledResponse,
  withServerTiming,
} from '@/lib/crm/booking-http'
import { loadBookingOverview } from '@/lib/crm/booking-overview-load'
import { parseOverviewQuery } from '@/lib/crm/booking-overview-query'
import { nzTodayIso } from '@/lib/crm/booking-view'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

/**
 * Read-only payment overview: per-departure order counts plus the all-orders list.
 * Counts orders only (the tracker stores no money). If any read fails, including the
 * 20000-row ceiling, the whole response is a 500: it never returns partial numbers.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const start = performance.now()
  const { id: clientId } = await params

  const access = await requireBookingAccess(clientId, 'view')
  const gateMs = performance.now() - start
  if (!access.ok) return access.response

  if (access.rule === null) return notEnabledResponse()

  const query = parseOverviewQuery(req.nextUrl.searchParams)
  if (!query.ok) return invalidRequest(query.error)

  try {
    const overview = await loadBookingOverview(supabaseAdmin, clientId, access.rule, nzTodayIso(), query.request)
    return withServerTiming(NextResponse.json(overview), start, gateMs)
  } catch (err) {
    return internalErrorResponse('overview_failed', err)
  }
}
