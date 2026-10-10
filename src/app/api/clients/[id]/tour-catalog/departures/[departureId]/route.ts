import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireCatalogAccess } from '@/lib/tour-catalog/access'
import { validateDeparturePatch, departurePatchToDb } from '@/lib/tour-catalog/edit-validation'
import { saveDeparture } from '@/lib/tour-catalog/store-edit'
import { trimDepartureForViewer } from '@/lib/tour-catalog/changes-view'
import { asPlainObject, invalidIdResponse, isUuid, readJsonBody } from '@/lib/tour-catalog/http'
import type { DepartureSavedResponse } from '@/lib/tour-catalog/api-contract'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string; departureId: string }>
}

/** When the request comes from the assistant (`?via=assistant`), tag the actor accordingly. */
function actorFor(req: NextRequest, actor: string): string {
  return new URL(req.url).searchParams.get('via') === 'assistant' ? `${actor} (AI 助手)` : actor
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { id: clientId, departureId } = await params

  const access = await requireCatalogAccess(clientId, 'edit')
  if (!access.ok) return access.response

  if (!isUuid(departureId)) return invalidIdResponse()

  const read = await readJsonBody(req)
  if (!read.ok) return read.response
  const body = asPlainObject(read.body) ?? {}

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
  if (!isUuid(tourId)) return invalidIdResponse()

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
    actorFor(req, access.actor),
  )

  if (result.ok) {
    // Operational `internal` facts never go back to a client editor (same trim as the catalog read).
    return NextResponse.json<DepartureSavedResponse>(
      { departure: trimDepartureForViewer(access.viewer.role, result.value) },
      { status: 200 },
    )
  }

  switch (result.code) {
    case 'conflict':
      return NextResponse.json({ error: 'conflict' }, { status: 409 })
    case 'not_found':
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    case 'invalid':
      // The database's date rule is the only check the form cannot run itself: point at the field.
      return NextResponse.json(
        {
          error: 'invalid_fields',
          fields:
            result.message === 'invalid_dates'
              ? [{ field: 'returnOn', code: 'return_before_depart' }]
              : [],
        },
        { status: 400 },
      )
    default:
      console.error('PATCH departure failed', result.message)
      return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }
}
