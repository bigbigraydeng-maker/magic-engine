import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBookingAccess } from '@/lib/crm/booking-access'
import {
  finishBookingWrite,
  internalErrorResponse,
  invalidRequest,
  notEnabledResponse,
  notFoundResponse,
  readBookingBody,
  storeFailureResponse,
} from '@/lib/crm/booking-http'
import { parseCreateBody } from '@/lib/crm/booking-input'
import { createBooking } from '@/lib/crm/booking-store'
import { contactBelongsToClient } from '@/lib/crm/booking-store-reads'
import { getContactBookingViews, nzTodayIso } from '@/lib/crm/booking-view'
import { isUuid } from '@/lib/validation-utils'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id: clientId } = await params

  const access = await requireBookingAccess(clientId, 'view')
  if (!access.ok) return access.response

  const contactId = req.nextUrl.searchParams.get('contactId')
  if (!isUuid(contactId)) {
    return invalidRequest('invalid_contact_id')
  }
  if (access.rule === null) {
    return notEnabledResponse()
  }

  try {
    const belongs = await contactBelongsToClient(supabaseAdmin, clientId, contactId)
    if (!belongs) {
      return notFoundResponse()
    }
    const bookings = await getContactBookingViews(
      supabaseAdmin,
      clientId,
      contactId,
      access.rule,
      nzTodayIso(),
    )
    return NextResponse.json({ bookings })
  } catch (err) {
    return internalErrorResponse('bookings_list_failed', err)
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id: clientId } = await params

  const access = await requireBookingAccess(clientId, 'edit')
  if (!access.ok) return access.response

  const read = await readBookingBody(req)
  if (!read.ok) return read.response

  const parsed = parseCreateBody(read.body)
  if (!parsed.ok) return invalidRequest(parsed.error)

  try {
    const belongs = await contactBelongsToClient(
      supabaseAdmin,
      clientId,
      parsed.value.contactId,
    )
    if (!belongs) {
      return notFoundResponse()
    }
    const result = await createBooking(supabaseAdmin, clientId, parsed.value, access.actor)
    if (!result.ok) {
      return storeFailureResponse(result)
    }
    return finishBookingWrite(
      result,
      supabaseAdmin,
      clientId,
      result.value.id,
      access.rule,
      undefined,
      201,
    )
  } catch (err) {
    return internalErrorResponse('booking_create_failed', err)
  }
}
