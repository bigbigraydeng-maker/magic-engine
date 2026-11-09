/**
 * GET /api/clients/[id]/documents/[docId]/download
 *
 * The only way a file leaves the private bucket. Order of checks:
 *   1. the caller must be a paid-tier account on THIS client (401 / 402 / 403 otherwise);
 *   2. the row is looked up by client id AND document id, and for a client member it must also be
 *      current and marked visible to the client, so anything else is "not found" (404, never
 *      "forbidden", so a member cannot even learn that an internal file exists);
 *   3. the stored path is re-checked against the client and document id before it is signed;
 *   4. a fresh link valid for 60 seconds is made and the browser is redirected to it.
 * The signed link is never logged and never returned as JSON.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { scopeForTier } from '@/lib/client-documents/access'
import { jsonError, notFound, unavailable } from '@/lib/client-documents/http'
import { isUuid } from '@/lib/client-documents/input'
import { createDownloadUrl, pathBelongsTo } from '@/lib/client-documents/storage'
import { getDownloadTarget } from '@/lib/client-documents/store'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string; docId: string }> }

export async function GET(_req: NextRequest, { params }: Context) {
  const { id: clientId, docId } = await params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return jsonError(access.status, access.error)
  const scope = scopeForTier(access.tier)
  if (!scope) return jsonError(403, 'Forbidden')
  if (!isUuid(clientId) || !isUuid(docId)) return notFound()

  const target = await getDownloadTarget(clientId, docId, scope)
  if (!target.ok) return unavailable()
  if (!target.data) return notFound()

  const { id, storage_path: storagePath, original_filename: fileName } = target.data
  if (!pathBelongsTo(storagePath, clientId, id)) {
    console.error('[client-documents/download] stored path does not match client/document', clientId, id)
    return jsonError(500, '文件暂不可用，请联系 Magic Lab')
  }

  const link = await createDownloadUrl(storagePath, fileName)
  if (!link.ok) {
    console.error('[client-documents/download] could not sign link', clientId, id, link.error)
    return jsonError(500, '文件暂不可用，请稍后再试')
  }

  console.info('[client-documents/download]', { clientId, docId: id, tier: access.tier })
  return NextResponse.redirect(link.url, { status: 302, headers: { 'Cache-Control': 'no-store' } })
}
