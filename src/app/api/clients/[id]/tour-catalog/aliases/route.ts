import { NextRequest, NextResponse } from 'next/server'
import { requireCatalogAdmin } from '@/lib/tour-catalog/access'
import { addAlias } from '@/lib/tour-catalog/store'
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

  const access = await requireCatalogAdmin(clientId)
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
    return NextResponse.json({ error: 'alias_taken' }, { status: 409 })
  }
  if (result.message === 'tour_not_found') {
    return NextResponse.json({ error: 'tour_not_found' }, { status: 404 })
  }
  return NextResponse.json({ error: result.message }, { status: 400 })
}
