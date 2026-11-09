import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireCatalogAccess } from '@/lib/tour-catalog/access'
import { validateNewTour } from '@/lib/tour-catalog/new-tour'
import { loadNewTourContext } from '@/lib/tour-catalog/patch-context'
import { createTour } from '@/lib/tour-catalog/store-create'
import { readJsonBody } from '@/lib/tour-catalog/http'
import type { TourSavedResponse } from '@/lib/tour-catalog/api-contract'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string }>
}

/** Adds a whole new tour (plus optional first departures) to the DRAFT catalog. Publishing is a separate step. */
export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id: clientId } = await params

  // Same capability as bulk import: global admins only.
  const access = await requireCatalogAccess(clientId, 'import')
  if (!access.ok) return access.response

  const read = await readJsonBody(req)
  if (!read.ok) return read.response

  let context
  try {
    context = await loadNewTourContext(supabaseAdmin, clientId, access.permissions.edit_site)
  } catch (error) {
    console.error('POST tour: context load failed', error)
    return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }

  const validated = validateNewTour(read.body, context)
  if (!validated.ok) {
    if (validated.forbidden === true) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ error: 'invalid_fields', fields: validated.errors }, { status: 400 })
  }

  const result = await createTour(supabaseAdmin, clientId, validated.value, access.actor)
  if (result.ok) {
    return NextResponse.json<TourSavedResponse>({ tour: result.value }, { status: 201 })
  }

  switch (result.code) {
    case 'duplicate':
      return NextResponse.json({ error: 'duplicate_tour' }, { status: 409 })
    case 'invalid':
      return NextResponse.json({ error: 'invalid_fields', fields: [] }, { status: 400 })
    default:
      console.error('POST tour failed', result.message)
      return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }
}
