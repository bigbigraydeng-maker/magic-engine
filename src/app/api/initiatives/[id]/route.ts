/**
 * GET    /api/initiatives/[id] — get one
 * PATCH  /api/initiatives/[id] — partial update
 * DELETE /api/initiatives/[id] — archive (soft delete)
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { updateInitiative, archiveInitiative, type UpdateInitiativeInput } from '@/lib/strategy/initiatives'
import { requireInitiativeAccess } from '@/lib/strategy/auth-helpers'

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const access = await requireInitiativeAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  return NextResponse.json({ initiative: access.row })
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const access = await requireInitiativeAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: UpdateInitiativeInput
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const result = await updateInitiative(supabaseAdmin, params.id, body)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  return NextResponse.json({ initiative: result.initiative })
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const access = await requireInitiativeAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const result = await archiveInitiative(supabaseAdmin, params.id)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}
