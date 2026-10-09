import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireCatalogAdmin } from '@/lib/tour-catalog/access'
import { validateNewDeparture } from '@/lib/tour-catalog/edit-validation'
import { saveDeparture } from '@/lib/tour-catalog/store'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string; tourId: string }>
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id: clientId, tourId } = await params

  const access = await requireCatalogAdmin(clientId)
  if (!access.ok) return access.response

  let body: unknown = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

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
    access.actor,
  )

  if (result.ok) {
    return NextResponse.json({ departure: result.value }, { status: 201 })
  }

  switch (result.code) {
    case 'duplicate':
      return NextResponse.json({ error: 'duplicate_departure' }, { status: 409 })
    case 'not_found':
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    case 'invalid':
      return NextResponse.json({ error: 'invalid_fields' }, { status: 400 })
    default:
      console.error('POST departure failed', result.message)
      return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }
}
