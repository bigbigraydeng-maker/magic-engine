import { NextRequest, NextResponse } from 'next/server'
import { requireCatalogAccess } from '@/lib/tour-catalog/access'
import { applyBatch, getBatch } from '@/lib/tour-catalog/store'
import { invalidIdResponse, isUuid } from '@/lib/tour-catalog/http'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string; batchId: string }>
}

interface ApplyBody {
  acknowledgeWarnings?: boolean
  planHash?: string
}

async function readBody(req: NextRequest): Promise<ApplyBody> {
  try {
    const parsed: unknown = await req.json()
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>
      const body: ApplyBody = {}
      if (typeof record.acknowledgeWarnings === 'boolean') {
        body.acknowledgeWarnings = record.acknowledgeWarnings
      }
      if (typeof record.planHash === 'string') {
        body.planHash = record.planHash
      }
      return body
    }
    return {}
  } catch {
    return {}
  }
}

function warningCountOf(rowCounts: Record<string, unknown>): number {
  const value = rowCounts.warningCount
  return typeof value === 'number' ? value : 0
}

function storedPlanHashOf(rowCounts: Record<string, unknown>): string | null {
  const value = rowCounts.planHash
  return typeof value === 'string' ? value : null
}

export async function POST(req: NextRequest, { params }: RouteParams) {
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

  const body = await readBody(req)

  const storedPlanHash = storedPlanHashOf(batch.rowCounts)
  if (storedPlanHash !== null && body.planHash !== storedPlanHash) {
    return NextResponse.json({ error: 'plan_changed' }, { status: 409 })
  }

  const warningCount = warningCountOf(batch.rowCounts)
  if (warningCount > 0 && body.acknowledgeWarnings !== true) {
    return NextResponse.json(
      { error: 'warnings_not_acknowledged', warningCount },
      { status: 409 },
    )
  }

  const result = await applyBatch(supabaseAdmin, clientId, batchId, access.actor)
  if (result.ok) {
    return NextResponse.json({ ok: true, result: result.result })
  }

  if (result.code === 'not_applicable') {
    return NextResponse.json({ error: 'not_applicable' }, { status: 409 })
  }
  if (result.code === 'conflict') {
    console.error('tour-catalog apply conflict:', result.message)
    return NextResponse.json({ error: 'conflict' }, { status: 409 })
  }

  console.error('tour-catalog apply failed:', result.message)
  return NextResponse.json({ error: 'apply_failed' }, { status: 500 })
}
