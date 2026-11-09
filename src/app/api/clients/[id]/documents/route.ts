/**
 * GET  /api/clients/[id]/documents   — list the client's document library (what the caller may see)
 * POST /api/clients/[id]/documents   — upload one file (Magic Lab internal accounts only)
 *
 * Design: docs/specs/2026-11-10-client-document-library-v0.1.md
 * Access: reading needs a paid-tier account on THIS client (internal accounts see everything, the
 * client's own members only see current files marked visible to the client); writing needs an
 * internal account. Both guards are re-checked on every request, the page hiding a button is only UX.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireOperatorAccess, requirePaidClientAccess } from '@/lib/auth/client-access'
import { actorOf, hasEmail, scopeForTier } from '@/lib/client-documents/access'
import { MAX_DOCUMENT_BYTES } from '@/lib/client-documents/constants'
import { jsonError, notFound, unavailable } from '@/lib/client-documents/http'
import { isUuid } from '@/lib/client-documents/input'
import { boundedFormData } from '@/lib/client-documents/request-body'
import { listDocuments } from '@/lib/client-documents/store'
import type { DocumentListResponse } from '@/lib/client-documents/types'
import { saveUploadedDocument } from '@/lib/client-documents/upload'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Multipart framing adds a little on top of the file itself. */
const FORM_OVERHEAD_BYTES = 1024 * 1024

type Context = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Context) {
  const { id: clientId } = await params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return jsonError(access.status, access.error)
  if (!hasEmail(access.user)) return jsonError(403, 'Forbidden')
  const scope = scopeForTier(access.tier)
  if (!scope) return jsonError(403, 'Forbidden')
  if (!isUuid(clientId)) return notFound('客户')

  const includeArchived = scope === 'all' && req.nextUrl.searchParams.get('includeArchived') === '1'
  const result = await listDocuments(clientId, scope, includeArchived)
  if (!result.ok) return unavailable()

  const body: DocumentListResponse = { documents: result.data, canManage: scope === 'all' }
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest, { params }: Context) {
  const { id: clientId } = await params
  const access = await requireOperatorAccess(clientId)
  if (!access.ok) return jsonError(access.status, access.error)
  if (!hasEmail(access.user)) return jsonError(403, 'Forbidden')
  if (!isUuid(clientId)) return notFound('客户')

  const parsed = await boundedFormData(req, MAX_DOCUMENT_BYTES + FORM_OVERHEAD_BYTES)
  if (!parsed.ok) return jsonError(parsed.status, parsed.error)

  const outcome = await saveUploadedDocument({
    clientId,
    form: parsed.form,
    actor: actorOf(access.user),
  })
  return NextResponse.json(outcome.body, {
    status: outcome.status,
    headers: { 'Cache-Control': 'no-store' },
  })
}
