import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBookingAccess } from '@/lib/crm/booking-access'
import {
  finishBookingWrite,
  invalidRequest,
  prepareBookingWrite,
} from '@/lib/crm/booking-http'
import { parseKind, parsePaidBody } from '@/lib/crm/booking-input'
import { setPaid } from '@/lib/crm/booking-store'
import { nzTodayIso } from '@/lib/crm/booking-view'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string; bookingId: string; kind: string }>
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id: clientId, bookingId, kind: kindRaw } = await params

  const access = await requireBookingAccess(clientId, 'edit')
  if (!access.ok) return access.response

  const prepared = await prepareBookingWrite(req, supabaseAdmin, clientId, bookingId)
  if (!prepared.ok) return prepared.response

  const kind = parseKind(kindRaw)
  if (kind === null) return invalidRequest('invalid_kind')

  const parsed = parsePaidBody(prepared.body, nzTodayIso())
  if (!parsed.ok) return invalidRequest(parsed.error)

  const result = await setPaid(
    supabaseAdmin,
    clientId,
    bookingId,
    kind,
    parsed.value.expectedUpdatedAt,
    parsed.value.paidOn,
    access.actor,
  )
  if (!result.ok) {
    return finishBookingWrite(result, supabaseAdmin, clientId, bookingId, access.rule)
  }
  return finishBookingWrite(result, supabaseAdmin, clientId, bookingId, access.rule, {
    changed: result.value.changed,
    reason: result.value.reason,
  })
}
