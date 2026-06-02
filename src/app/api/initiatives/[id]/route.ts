/**
 * GET    /api/initiatives/[id] — get one
 * PATCH  /api/initiatives/[id] — partial update
 * DELETE /api/initiatives/[id] — archive (soft delete)
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getInitiativeById, updateInitiative, archiveInitiative, type UpdateInitiativeInput } from '@/lib/strategy/initiatives'

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const initiative = await getInitiativeById(supabaseAdmin, params.id)
  if (!initiative) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ initiative })
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
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
  const result = await archiveInitiative(supabaseAdmin, params.id)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}
