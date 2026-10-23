import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireCatalogAccess } from '@/lib/tour-catalog/access'
import { todayIso } from '@/lib/tour-catalog/dates'
import { buildPublishPreview, publishDraft } from '@/lib/tour-catalog/store-publish'
import { listChangeActorsSince, listMemberEmails } from '@/lib/tour-catalog/store-access'
import { makeActorLabeler, summariseContributors } from '@/lib/tour-catalog/changes-view'
import { revalidatePublishedTourWebsite } from '@/lib/tour-catalog/website-revalidation'
import type { CatalogRole, PublishContributor } from '@/lib/tour-catalog/catalog-contract'
import type {
  PublishErrorCode,
  PublishErrorResponse,
  PublishPreviewResponse,
  PublishRequest,
  PublishResponse,
} from '@/lib/tour-catalog/publish-contract'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

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

function parsePublishRequest(body: unknown): PublishRequest | null {
  if (!isPlainObject(body)) return null
  const { draftVersion, publishedVersion, diffHash } = body
  if (!isNonNegativeInteger(draftVersion)) return null
  if (!isNonNegativeInteger(publishedVersion)) return null
  if (typeof diffHash !== 'string' || diffHash === '') return null
  if (typeof body.acknowledgeHighRisk !== 'boolean') return null
  if (typeof body.acknowledgeAfterRevert !== 'boolean') return null
  const confirmSellableCount = body.confirmSellableCount
  if (confirmSellableCount !== null && !isNonNegativeInteger(confirmSellableCount)) return null
  const rawNote = body.note === undefined ? '' : body.note
  if (typeof rawNote !== 'string') return null
  const note = rawNote.trim().slice(0, 500)
  return {
    draftVersion,
    publishedVersion,
    diffHash,
    acknowledgeHighRisk: body.acknowledgeHighRisk,
    acknowledgeAfterRevert: body.acknowledgeAfterRevert,
    confirmSellableCount,
    note,
  }
}

/**
 * Whose edits (and how many) would go out with this publish: change-log rows since the last
 * publish, or all of them before the first one. Never part of diffHash.
 */
async function contributorsSince(
  clientId: string,
  role: CatalogRole,
  publishedAt: string | null,
  viewerEmail: string,
): Promise<PublishContributor[]> {
  const actors = await listChangeActorsSince(supabaseAdmin, clientId, publishedAt)
  const members = role === 'me_admin' ? new Set<string>() : await listMemberEmails(supabaseAdmin, clientId)
  return summariseContributors(actors, makeActorLabeler(role, members, viewerEmail))
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id: clientId } = await params

  const access = await requireCatalogAccess(clientId, 'view')
  if (!access.ok) return access.response

  try {
    const preview = await buildPublishPreview(supabaseAdmin, clientId, todayIso(new Date()))
    const role = access.viewer.role
    const contributors = await contributorsSince(clientId, role, preview.publishedAt, access.viewer.email)
    const publishedBy =
      role === 'me_admin' || preview.publishedBy === null
        ? preview.publishedBy
        : makeActorLabeler(role, await listMemberEmails(supabaseAdmin, clientId), access.viewer.email)(
            preview.publishedBy.trim().toLowerCase(),
          )
    return NextResponse.json<PublishPreviewResponse>({ ...preview, publishedBy, contributors })
  } catch (err) {
    console.error('tour-catalog publish preview failed:', err)
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

  const parsed = parsePublishRequest(body)
  if (parsed === null) {
    return NextResponse.json<PublishErrorResponse>({ error: 'invalid_request' }, { status: 400 })
  }

  try {
    const result = await publishDraft(
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
    console.error('tour-catalog publish failed:', err)
    return NextResponse.json<PublishErrorResponse>({ error: 'publish_failed' }, { status: 500 })
  }
}
