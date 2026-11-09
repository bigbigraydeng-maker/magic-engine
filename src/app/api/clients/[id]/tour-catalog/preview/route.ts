import { createHash } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { requireCatalogAccess } from '@/lib/tour-catalog/access'
import {
  parseCsv,
  parseDeparturesCsv,
  type RejectedCsvRow,
} from '@/lib/tour-catalog/departures-csv'
import { todayIso } from '@/lib/tour-catalog/dates'
import { planDepartureImport, type ImportPlan, type PlanRejected } from '@/lib/tour-catalog/plan'
import {
  createPreviewBatch,
  loadDraftCatalog,
  planHash,
  planToApplyPayload,
} from '@/lib/tour-catalog/store'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const MAX_REQUEST_BYTES = 3 * 1024 * 1024

type PreviewSummary = {
  adds: number
  updates: number
  unchanged: number
  rejected: number
  warningCount: number
  planHash: string
}

/** Read the `csv` field from a parsed JSON body, or null when absent/invalid. */
function readCsvField(body: unknown): string | null {
  if (body === null || typeof body !== 'object') {
    return null
  }
  const value = (body as Record<string, unknown>).csv
  if (typeof value !== 'string' || value === '') {
    return null
  }
  return value
}

/** Raw tour name per CSV line, so every rejected row can show which tour it was about. */
function tourNamesByLine(csv: string): Map<number, string> {
  const records = parseCsv(csv)
  const header = (records[0] ?? []).map((cell) => cell.trim().toLowerCase())
  const column = header.findIndex((cell) => cell === '行程名称' || cell === 'tour')
  const names = new Map<number, string>()
  if (column < 0) {
    return names
  }
  records.forEach((record, index) => {
    const name = record[column]?.trim()
    if (index > 0 && name) {
      names.set(index + 1, name)
    }
  })
  return names
}

/** Merge CSV-level and plan-level rejections, sorted by line number. */
function mergeRejected(
  csvRejected: RejectedCsvRow[],
  planRejected: PlanRejected[],
  names: Map<number, string>,
): Array<(RejectedCsvRow | PlanRejected) & { tourName?: string }> {
  // Attach the raw tour name so the page can show it and offer "remember this name".
  return [...csvRejected, ...planRejected]
    .sort((a, b) => a.line - b.line)
    .map((r) => ({ ...r, tourName: names.get(r.line) }))
}

/** Build the summary counts shown to the operator. */
function buildSummary(plan: ImportPlan, rejectedCount: number, hash: string): PreviewSummary {
  return {
    adds: plan.adds.length,
    updates: plan.updates.length,
    unchanged: plan.unchangedCount,
    rejected: rejectedCount,
    warningCount: plan.warnings.length,
    planHash: hash,
  }
}

/** Shape the update list for the preview response. */
function shapeUpdates(plan: ImportPlan) {
  return plan.updates.map((u) => ({
    line: u.line,
    departureId: u.departureId,
    tourId: u.tourId,
    departOn: u.departOn,
    before: { returnOn: u.before.returnOn, status: u.before.status },
    after: u.after,
  }))
}

/** True when the content-length header declares a body larger than the limit. */
function contentLengthTooLarge(req: NextRequest): boolean {
  const header = req.headers.get('content-length')
  if (header === null) {
    return false
  }
  const value = Number(header)
  return Number.isFinite(value) && value > MAX_REQUEST_BYTES
}

/** POST: parse a departures CSV, plan the import, and persist a preview batch. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: clientId } = await params

  const access = await requireCatalogAccess(clientId, 'import')
  if (!access.ok) {
    return access.response
  }

  try {
    if (contentLengthTooLarge(req)) {
      return NextResponse.json({ error: 'request_too_large' }, { status: 413 })
    }

    const rawBody = await req.text()
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_REQUEST_BYTES) {
      return NextResponse.json({ error: 'request_too_large' }, { status: 413 })
    }

    let body: unknown = null
    try {
      body = JSON.parse(rawBody)
    } catch {
      body = null
    }

    const csv = readCsvField(body)
    if (csv === null) {
      return NextResponse.json({ error: 'csv_required' }, { status: 400 })
    }

    const fileSha256 = createHash('sha256').update(csv).digest('hex')

    const parsed = parseDeparturesCsv(csv)
    if (parsed.fatal !== null) {
      return NextResponse.json({ error: parsed.fatal }, { status: 400 })
    }

    const snapshot = await loadDraftCatalog(supabaseAdmin, clientId)
    const today = todayIso(new Date())
    const plan = planDepartureImport({
      rows: parsed.rows,
      tours: snapshot.tours,
      aliases: snapshot.aliases,
      existing: snapshot.departures,
      today,
    })

    const hash = planHash(planToApplyPayload(plan), plan.warnings.length)
    const rejected = mergeRejected(parsed.rejected, plan.rejected, tourNamesByLine(csv))
    const summary = buildSummary(plan, rejected.length, hash)

    if (plan.adds.length + plan.updates.length === 0) {
      return NextResponse.json({
        batchId: null,
        planHash: hash,
        summary,
        adds: [],
        updates: [],
        rejected,
        warnings: plan.warnings,
      })
    }

    const created = await createPreviewBatch(supabaseAdmin, {
      clientId,
      kind: 'departures',
      fileSha256,
      payload: planToApplyPayload(plan),
      summary,
    })

    if (!created.ok) {
      if (created.reason === 'duplicate_file') {
        return NextResponse.json(
          { error: 'duplicate_file', existingBatchId: created.existingBatchId },
          { status: 409 },
        )
      }
      console.error('preview_failed', created.message)
      return NextResponse.json({ error: 'preview_failed' }, { status: 500 })
    }

    return NextResponse.json({
      batchId: created.batchId,
      planHash: hash,
      summary,
      adds: plan.adds,
      updates: shapeUpdates(plan),
      rejected,
      warnings: plan.warnings,
    })
  } catch (error) {
    console.error('preview_failed', error)
    return NextResponse.json({ error: 'preview_failed' }, { status: 500 })
  }
}
