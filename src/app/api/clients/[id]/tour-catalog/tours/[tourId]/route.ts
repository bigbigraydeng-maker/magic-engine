import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireCatalogAccess } from '@/lib/tour-catalog/access'
import { validateTourPatch, tourPatchToDb } from '@/lib/tour-catalog/edit-validation'
import { updateTour } from '@/lib/tour-catalog/store-edit'
import { loadTourPatchContext } from '@/lib/tour-catalog/patch-context'
import type { TourPatchContext } from '@/lib/tour-catalog/content-validation'
import { asPlainObject, invalidIdResponse, isUuid, readJsonBody } from '@/lib/tour-catalog/http'
import type { TourSavedResponse } from '@/lib/tour-catalog/api-contract'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string; tourId: string }>
}

/** When the request comes from the assistant (`?via=assistant`), tag the actor accordingly. */
function actorFor(req: NextRequest, actor: string): string {
  return new URL(req.url).searchParams.get('via') === 'assistant' ? `${actor} (AI 助手)` : actor
}

type LoadedContext = { ok: true; context: TourPatchContext } | { ok: false; response: NextResponse }

/** Fails closed: no context, no validation, no save. */
async function loadContext(clientId: string, tourId: string, canEditSite: boolean): Promise<LoadedContext> {
  try {
    const context = await loadTourPatchContext(supabaseAdmin, clientId, tourId, canEditSite)
    if (context === null) {
      return { ok: false, response: NextResponse.json({ error: 'not_found' }, { status: 404 }) }
    }
    return { ok: true, context }
  } catch (error) {
    console.error('PATCH tour: context load failed', error)
    return { ok: false, response: NextResponse.json({ error: 'save_failed' }, { status: 500 }) }
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { id: clientId, tourId } = await params

  const access = await requireCatalogAccess(clientId, 'edit')
  if (!access.ok) return access.response

  if (!isUuid(tourId)) return invalidIdResponse()

  const read = await readJsonBody(req)
  if (!read.ok) return read.response
  const body = asPlainObject(read.body) ?? {}

  const expectedUpdatedAt = body.expectedUpdatedAt
  if (typeof expectedUpdatedAt !== 'string' || expectedUpdatedAt.trim() === '') {
    return NextResponse.json({ error: 'expected_updated_at_required' }, { status: 400 })
  }

  // Who is saving decides which fields and which image addresses are allowed (design §6.11.1 item 6).
  const loaded = await loadContext(clientId, tourId, access.permissions.edit_site)
  if (!loaded.ok) return loaded.response

  const validated = validateTourPatch(body.patch, loaded.context)
  if (!validated.ok) {
    if (validated.forbidden === true) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json(
      { error: 'invalid_fields', fields: validated.errors },
      { status: 400 },
    )
  }

  const result = await updateTour(
    supabaseAdmin,
    clientId,
    tourId,
    expectedUpdatedAt,
    tourPatchToDb(validated.value),
    actorFor(req, access.actor),
  )

  if (result.ok) {
    return NextResponse.json<TourSavedResponse>({ tour: result.value }, { status: 200 })
  }

  switch (result.code) {
    case 'conflict':
      return NextResponse.json({ error: 'conflict' }, { status: 409 })
    case 'not_found':
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    case 'invalid':
      return NextResponse.json({ error: 'invalid_fields' }, { status: 400 })
    default:
      console.error('PATCH tour failed', result.message)
      return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }
}
