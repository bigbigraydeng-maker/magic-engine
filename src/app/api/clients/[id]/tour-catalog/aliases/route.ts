import { NextRequest, NextResponse } from 'next/server'
import { requireCatalogAccess } from '@/lib/tour-catalog/access'
import { addAlias, removeAlias } from '@/lib/tour-catalog/store'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/** Extract a non-empty string field from an unknown JSON body. */
function readStringField(body: unknown, field: string): string | null {
  if (body === null || typeof body !== 'object') return null
  const value = (body as Record<string, unknown>)[field]
  if (typeof value !== 'string' || value.trim() === '') return null
  return value
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params

  const access = await requireCatalogAccess(clientId, 'aliases')
  if (!access.ok) return access.response

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: 'alias_and_tour_required' },
      { status: 400 },
    )
  }

  const alias = readStringField(body, 'alias')
  const tourId = readStringField(body, 'tourId')
  if (alias === null || tourId === null) {
    return NextResponse.json(
      { error: 'alias_and_tour_required' },
      { status: 400 },
    )
  }

  const result = await addAlias(supabaseAdmin, clientId, alias, tourId)
  if (result.ok) {
    return NextResponse.json({ ok: true, aliasNorm: result.aliasNorm })
  }

  if (result.message === 'alias_taken') {
    if (result.existingTourId !== undefined) {
      return NextResponse.json(
        { error: 'alias_taken', existingTourId: result.existingTourId },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: 'alias_taken' }, { status: 409 })
  }
  if (result.message === 'tour_not_found') {
    return NextResponse.json({ error: 'tour_not_found' }, { status: 404 })
  }
  if (result.message === 'empty_alias') {
    return NextResponse.json(
      { error: 'alias_and_tour_required' },
      { status: 400 },
    )
  }
  console.error('tour-catalog addAlias failed:', result.message)
  return NextResponse.json({ error: 'alias_failed' }, { status: 500 })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params

  const access = await requireCatalogAccess(clientId, 'aliases')
  if (!access.ok) return access.response

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'alias_required' }, { status: 400 })
  }

  const aliasNorm = readStringField(body, 'aliasNorm')
  if (aliasNorm === null) {
    return NextResponse.json({ error: 'alias_required' }, { status: 400 })
  }

  const result = await removeAlias(supabaseAdmin, clientId, aliasNorm)
  if (result.ok) {
    return NextResponse.json({ ok: true })
  }
  if (result.message === 'alias_not_found') {
    return NextResponse.json({ error: 'alias_not_found' }, { status: 404 })
  }
  console.error('tour-catalog removeAlias failed:', result.message)
  return NextResponse.json({ error: 'alias_failed' }, { status: 500 })
}
