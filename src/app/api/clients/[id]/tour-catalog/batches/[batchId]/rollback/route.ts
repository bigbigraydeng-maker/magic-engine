import { NextRequest, NextResponse } from 'next/server'
import { requireCatalogAdmin } from '@/lib/tour-catalog/access'
import { getBatch, rollbackBatch } from '@/lib/tour-catalog/store'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string; batchId: string }>
}

export async function POST(_req: NextRequest, { params }: RouteParams) {
  const { id: clientId, batchId } = await params

  const access = await requireCatalogAdmin(clientId)
  if (!access.ok) {
    return access.response
  }

  const batch = await getBatch(supabaseAdmin, clientId, batchId)
  if (batch === null) {
    return NextResponse.json({ error: 'batch_not_found' }, { status: 404 })
  }

  const result = await rollbackBatch(supabaseAdmin, clientId, batchId)
  if (result.ok) {
    return NextResponse.json({ ok: true, result: result.result })
  }

  if (result.code === 'not_applicable') {
    return NextResponse.json({ error: 'not_applicable' }, { status: 409 })
  }
  if (result.code === 'conflict') {
    return NextResponse.json(
      { error: 'conflict', message: result.message },
      { status: 409 },
    )
  }

  console.error('tour-catalog rollback failed:', result.message)
  return NextResponse.json({ error: 'rollback_failed' }, { status: 500 })
}
