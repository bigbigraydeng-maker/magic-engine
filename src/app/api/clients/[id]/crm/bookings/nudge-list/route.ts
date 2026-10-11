import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBookingAccess } from '@/lib/crm/booking-access'
import { internalErrorResponse, notEnabledResponse } from '@/lib/crm/booking-http'
import { parseLimitParam } from '@/lib/crm/booking-input'
import { buildNudgeList, normaliseNudgeLimit } from '@/lib/crm/booking-nudge'
import { nzTodayIso } from '@/lib/crm/booking-view'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id: clientId } = await params

  const access = await requireBookingAccess(clientId, 'view')
  if (!access.ok) return access.response

  if (access.rule === null) return notEnabledResponse()

  const limit = normaliseNudgeLimit(parseLimitParam(req.nextUrl.searchParams.get('limit')))

  try {
    const nudge = await buildNudgeList(supabaseAdmin, clientId, access.rule, nzTodayIso(), limit)
    return NextResponse.json({ nudge })
  } catch (err) {
    return internalErrorResponse('nudge_list_failed', err)
  }
}
