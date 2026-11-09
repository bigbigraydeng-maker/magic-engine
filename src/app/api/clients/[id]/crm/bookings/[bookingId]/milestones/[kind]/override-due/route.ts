import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBookingAccess } from '@/lib/crm/booking-access'
import {
  finishBookingWrite,
  invalidRequest,
  prepareBookingWrite,
} from '@/lib/crm/booking-http'
import { parseKind, parseOverrideBody } from '@/lib/crm/booking-input'
import { overrideDue } from '@/lib/crm/booking-store'

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

  const parsed = parseOverrideBody(prepared.body)
  if (!parsed.ok) return invalidRequest(parsed.error)

  const result = await overrideDue(
    supabaseAdmin,
    clientId,
    bookingId,
    kind,
    parsed.value.expectedUpdatedAt,
    parsed.value.dueOn,
    access.actor,
  )
  return finishBookingWrite(result, supabaseAdmin, clientId, bookingId, access.rule)
}
