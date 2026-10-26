import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireCatalogAccess } from '@/lib/tour-catalog/access'
import { todayIso } from '@/lib/tour-catalog/dates'
import { buildRevertPreview, revertPublished } from '@/lib/tour-catalog/store-publish'
import { revalidatePublishedTourWebsite } from '@/lib/tour-catalog/website-revalidation'
import type {
  PublishErrorCode,
  PublishErrorResponse,
  PublishResponse,
  RevertPreviewResponse,
  RevertRequest,
} from '@/lib/tour-catalog/publish-contract'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

const VERSION_RE = /^[1-9]\d{0,8}$/

function statusForError(code: PublishErrorCode): number {
  if (code === 'stale') return 409
  if (code === 'publish_failed') return 500
  return 400
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function parseRevertRequest(body: unknown): RevertRequest | null {
  if (!isPlainObject(body)) return null
  const { version, publishedVersion, diffHash } = body
  if (!isPositiveInteger(version)) return null
  if (!isNonNegativeInteger(publishedVersion)) return null
  if (typeof diffHash !== 'string' || diffHash === '') return null
  if (typeof body.acknowledgeHighRisk !== 'boolean') return null
  const confirmSellableCount = body.confirmSellableCount
  if (confirmSellableCount !== null && !isNonNegativeInteger(confirmSellableCount)) return null
  return {
    version,
    publishedVersion,
    diffHash,
    acknowledgeHighRisk: body.acknowledgeHighRisk,
    confirmSellableCount,
  }
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id: clientId } = await params

  const access = await requireCatalogAccess(clientId, 'publish')
  if (!access.ok) return access.response

  const rawVersion = req.nextUrl.searchParams.get('version')
  if (rawVersion === null || !VERSION_RE.test(rawVersion)) {
    return NextResponse.json<PublishErrorResponse>({ error: 'invalid_request' }, { status: 400 })
  }
  const targetVersion = Number(rawVersion)

  try {
    const result = await buildRevertPreview(
      supabaseAdmin,
      clientId,
      targetVersion,
      todayIso(new Date()),
    )
    if ('error' in result) {
      return NextResponse.json<PublishErrorResponse>(
        { error: result.error },
        { status: statusForError(result.error) },
      )
    }
    return NextResponse.json<RevertPreviewResponse>(result)
  } catch (err) {
    console.error('tour-catalog revert preview failed:', err)
    return NextResponse.json<PublishErrorResponse>({ error: 'publish_failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id: clientId } = await params

  const access = await requireCatalogAccess(clientId, 'publish')
  if (!access.ok) return access.response

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json<PublishErrorResponse>({ error: 'invalid_request' }, { status: 400 })
  }

  const parsed = parseRevertRequest(body)
  if (parsed === null) {
    return NextResponse.json<PublishErrorResponse>({ error: 'invalid_request' }, { status: 400 })
  }

  try {
    const result = await revertPublished(
      supabaseAdmin,
      clientId,
      parsed,
      access.actor,
      todayIso(new Date()),
    )
    if (result.ok) {
      const websiteSync = await revalidatePublishedTourWebsite(clientId)
      return NextResponse.json<PublishResponse>({ ok: true, version: result.version, websiteSync })
    }
    return NextResponse.json<PublishErrorResponse>(
      { error: result.error },
      { status: statusForError(result.error) },
    )
  } catch (err) {
    console.error('tour-catalog revert failed:', err)
    return NextResponse.json<PublishErrorResponse>({ error: 'publish_failed' }, { status: 500 })
  }
}
