import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireCatalogAccess } from '@/lib/tour-catalog/access'
import { validateNewDeparture } from '@/lib/tour-catalog/edit-validation'
import { saveDeparture } from '@/lib/tour-catalog/store-edit'
import { trimDepartureForViewer } from '@/lib/tour-catalog/changes-view'
import { invalidIdResponse, isUuid, readJsonBody } from '@/lib/tour-catalog/http'
import type { DepartureSavedResponse } from '@/lib/tour-catalog/api-contract'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string; tourId: string }>
}

/** When the request comes from the assistant (`?via=assistant`), tag the actor accordingly. */
function actorFor(req: NextRequest, actor: string): string {
  return new URL(req.url).searchParams.get('via') === 'assistant' ? `${actor} (AI 助手)` : actor
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id: clientId, tourId } = await params

  const access = await requireCatalogAccess(clientId, 'edit')
  if (!access.ok) return access.response

  if (!isUuid(tourId)) return invalidIdResponse()

  const read = await readJsonBody(req)
  if (!read.ok) return read.response
  const body = read.body

  const validated = validateNewDeparture(body)
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
    null,
    null,
    {
      depart_on: validated.value.departOn,
      return_on: validated.value.returnOn,
      status: validated.value.status,
      price_text_override: validated.value.priceTextOverride,
    },
    actorFor(req, access.actor),
  )

  if (result.ok) {
    // Operational `internal` facts never go back to a client editor (same trim as the catalog read).
    return NextResponse.json<DepartureSavedResponse>(
      { departure: trimDepartureForViewer(access.viewer.role, result.value) },
      { status: 201 },
    )
  }

  switch (result.code) {
    case 'duplicate':
      return NextResponse.json({ error: 'duplicate_departure' }, { status: 409 })
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
      console.error('POST departure failed', result.message)
      return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }
}
