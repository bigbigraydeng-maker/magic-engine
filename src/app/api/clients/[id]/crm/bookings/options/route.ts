import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBookingAccess } from '@/lib/crm/booking-access'
import { internalErrorResponse, notEnabledResponse } from '@/lib/crm/booking-http'
import { loadBookingOptions } from '@/lib/crm/booking-options'
import { nzTodayIso } from '@/lib/crm/booking-view'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id: clientId } = await params

  const access = await requireBookingAccess(clientId, 'view')
  if (!access.ok) return access.response

  if (access.rule === null) return notEnabledResponse()

  try {
    const tours = await loadBookingOptions(supabaseAdmin, clientId, nzTodayIso())
    return NextResponse.json({ tours })
  } catch (err) {
    return internalErrorResponse('booking_options_failed', err)
  }
}
