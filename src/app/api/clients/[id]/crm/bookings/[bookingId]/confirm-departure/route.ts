import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBookingAccess } from '@/lib/crm/booking-access'
import {
  finishBookingWrite,
  invalidRequest,
  prepareBookingWrite,
} from '@/lib/crm/booking-http'
import { parseExpectedOnly } from '@/lib/crm/booking-input'
import { confirmDeparture } from '@/lib/crm/booking-store'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string; bookingId: string }>
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id: clientId, bookingId } = await params

  const access = await requireBookingAccess(clientId, 'edit')
  if (!access.ok) return access.response

  const prepared = await prepareBookingWrite(req, supabaseAdmin, clientId, bookingId)
  if (!prepared.ok) return prepared.response

  const parsed = parseExpectedOnly(prepared.body)
  if (!parsed.ok) return invalidRequest(parsed.error)

  const result = await confirmDeparture(
    supabaseAdmin,
    clientId,
    bookingId,
    parsed.value.expectedUpdatedAt,
    access.actor,
  )
  return finishBookingWrite(result, supabaseAdmin, clientId, bookingId, access.rule)
}
