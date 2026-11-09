import { NextRequest, NextResponse } from 'next/server'
import { requireCatalogAccess } from '@/lib/tour-catalog/access'
import { getBatch, rollbackBatch } from '@/lib/tour-catalog/store'
import { getDepartureLabel } from '@/lib/tour-catalog/store-edit'
import { invalidIdResponse, isUuid } from '@/lib/tour-catalog/http'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string; batchId: string }>
}

const CONFLICT_RE = /^conflict:(modified|missing):([0-9a-f-]{36})$/

async function conflictResponse(
  clientId: string,
  message: string,
): Promise<NextResponse> {
  const match = CONFLICT_RE.exec(message)
  if (match === null) {
    return NextResponse.json({ error: 'conflict' }, { status: 409 })
  }
  const reason = match[1] as 'modified' | 'missing'
  const departureId = match[2]
  const label = await getDepartureLabel(supabaseAdmin, clientId, departureId)
  if (label === null) {
    return NextResponse.json({ error: 'conflict' }, { status: 409 })
  }
  return NextResponse.json(
    {
      error: 'conflict',
      conflict: { reason, tourName: label.tourName, departOn: label.departOn },
    },
    { status: 409 },
  )
}

export async function POST(_req: NextRequest, { params }: RouteParams) {
  const { id: clientId, batchId } = await params

  const access = await requireCatalogAccess(clientId, 'import')
  if (!access.ok) {
    return access.response
  }
  if (!isUuid(batchId)) {
    return invalidIdResponse()
  }

  const batch = await getBatch(supabaseAdmin, clientId, batchId)
  if (batch === null) {
    return NextResponse.json({ error: 'batch_not_found' }, { status: 404 })
  }

  const result = await rollbackBatch(supabaseAdmin, clientId, batchId, access.actor)
  if (result.ok) {
    return NextResponse.json({ ok: true, result: result.result })
  }

  if (result.code === 'not_applicable') {
    return NextResponse.json({ error: 'not_applicable' }, { status: 409 })
  }
  if (result.code === 'conflict') {
    console.error('tour-catalog rollback conflict:', result.message)
    return conflictResponse(clientId, result.message)
  }

  console.error('tour-catalog rollback failed:', result.message)
  return NextResponse.json({ error: 'rollback_failed' }, { status: 500 })
}
