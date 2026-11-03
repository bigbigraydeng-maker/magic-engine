import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBookingAccess } from '@/lib/crm/booking-access'
import { internalErrorResponse, invalidRequest, readBookingBody } from '@/lib/crm/booking-http'
import { normaliseBookingMemberEmail } from '@/lib/crm/booking-input'
import {
  addBookingMember,
  listBookingMembers,
  removeBookingMember,
} from '@/lib/crm/booking-store-reads'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

/** Fresh member list, shared by all three handlers. */
async function membersResponse(clientId: string): Promise<NextResponse> {
  const members = await listBookingMembers(supabaseAdmin, clientId)
  return NextResponse.json({ members })
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id: clientId } = await params

  const access = await requireBookingAccess(clientId, 'manage_members')
  if (!access.ok) return access.response

  try {
    return await membersResponse(clientId)
  } catch (err) {
    return internalErrorResponse('members_list_failed', err)
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id: clientId } = await params

  const access = await requireBookingAccess(clientId, 'manage_members')
  if (!access.ok) return access.response

  const read = await readBookingBody(req)
  if (!read.ok) return read.response

  const email = normaliseBookingMemberEmail(read.body.email)
  if (email === null) return invalidRequest('invalid_email')

  for (const key of Object.keys(read.body)) {
    if (key !== 'email') return invalidRequest('unknown_field')
  }

  try {
    await addBookingMember(supabaseAdmin, clientId, email, access.actor)
    return await membersResponse(clientId)
  } catch (err) {
    return internalErrorResponse('members_add_failed', err)
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const { id: clientId } = await params

  const access = await requireBookingAccess(clientId, 'manage_members')
  if (!access.ok) return access.response

  const email = normaliseBookingMemberEmail(req.nextUrl.searchParams.get('email'))
  if (email === null) return invalidRequest('invalid_email')

  try {
    await removeBookingMember(supabaseAdmin, clientId, email)
    return await membersResponse(clientId)
  } catch (err) {
    return internalErrorResponse('members_remove_failed', err)
  }
}
