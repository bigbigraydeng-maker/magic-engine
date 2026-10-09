import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireCatalogAdmin } from '@/lib/tour-catalog/access'
import { validateDeparturePatch, departurePatchToDb } from '@/lib/tour-catalog/edit-validation'
import { saveDeparture } from '@/lib/tour-catalog/store'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string; departureId: string }>
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { id: clientId, departureId } = await params

  const access = await requireCatalogAdmin(clientId)
  if (!access.ok) return access.response

  let body: Record<string, unknown> = {}
  try {
    const parsed: unknown = await req.json()
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>
    }
  } catch {
    body = {}
  }

  const tourId = body.tourId
  const expectedUpdatedAt = body.expectedUpdatedAt
  if (
    typeof tourId !== 'string' ||
    tourId.trim() === '' ||
    typeof expectedUpdatedAt !== 'string' ||
    expectedUpdatedAt.trim() === ''
  ) {
    return NextResponse.json({ error: 'tour_and_version_required' }, { status: 400 })
  }

  const validated = validateDeparturePatch(body.patch)
  if (!validated.ok) {
    return NextResponse.json(
      { error: 'invalid_fields', fields: validated.errors },
      { status: 400 },
    )
  }

  const result = await saveDeparture(
    supabaseAdmin,
    clientId,
    tourId,
    departureId,
    expectedUpdatedAt,
    departurePatchToDb(validated.value),
    access.actor,
  )

  if (result.ok) {
    return NextResponse.json({ departure: result.value }, { status: 200 })
  }

  switch (result.code) {
    case 'conflict':
      return NextResponse.json({ error: 'conflict' }, { status: 409 })
    case 'not_found':
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    case 'invalid':
      return NextResponse.json({ error: 'invalid_fields' }, { status: 400 })
    default:
      console.error('PATCH departure failed', result.message)
      return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }
}
