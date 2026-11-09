import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireCatalogAccess } from '@/lib/tour-catalog/access'
import { asPlainObject, readJsonBody } from '@/lib/tour-catalog/http'
import { addMember, listMembers, removeMember } from '@/lib/tour-catalog/store-access'
import { normaliseMemberEmail } from '@/lib/tour-catalog/settings-validation'
import type { MembersResponse } from '@/lib/tour-catalog/catalog-contract'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

/** Fresh member list, shared by all three handlers. */
async function membersResponse(clientId: string): Promise<NextResponse> {
  const members = await listMembers(supabaseAdmin, clientId)
  return NextResponse.json<MembersResponse>({ members })
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id: clientId } = await params

  const access = await requireCatalogAccess(clientId, 'manage_members')
  if (!access.ok) return access.response

  try {
    return await membersResponse(clientId)
  } catch (err) {
    console.error('members_list_failed', err)
    return NextResponse.json({ error: 'members_failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id: clientId } = await params

  const access = await requireCatalogAccess(clientId, 'manage_members')
  if (!access.ok) return access.response

  const read = await readJsonBody(req)
  if (!read.ok) return read.response

  const email = normaliseMemberEmail(asPlainObject(read.body)?.email)
  if (email === null) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 })
  }

  try {
    await addMember(supabaseAdmin, clientId, email, access.actor)
    return await membersResponse(clientId)
  } catch (err) {
    console.error('members_add_failed', err)
    return NextResponse.json({ error: 'members_failed' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const { id: clientId } = await params

  const access = await requireCatalogAccess(clientId, 'manage_members')
  if (!access.ok) return access.response

  const email = normaliseMemberEmail(req.nextUrl.searchParams.get('email'))
  if (email === null) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 })
  }

  try {
    await removeMember(supabaseAdmin, clientId, email)
    return await membersResponse(clientId)
  } catch (err) {
    console.error('members_remove_failed', err)
    return NextResponse.json({ error: 'members_failed' }, { status: 500 })
  }
}
