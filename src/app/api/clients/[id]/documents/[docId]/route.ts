/**
 * PATCH /api/clients/[id]/documents/[docId] — edit title / category / version / description /
 * visibility, or archive / restore a file (Magic Lab internal accounts only).
 *
 * Every write is scoped by BOTH the client id from the URL and the document id, so a document id
 * that belongs to another client is simply "not found".
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireOperatorAccess } from '@/lib/auth/client-access'
import { actorOf } from '@/lib/client-documents/access'
import { jsonError, notFound, unavailable } from '@/lib/client-documents/http'
import { isUuid, parsePatch } from '@/lib/client-documents/input'
import { patchDocument } from '@/lib/client-documents/store'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string; docId: string }> }

export async function PATCH(req: NextRequest, { params }: Context) {
  const { id: clientId, docId } = await params
  const access = await requireOperatorAccess(clientId)
  if (!access.ok) return jsonError(access.status, access.error)
  if (!isUuid(clientId) || !isUuid(docId)) return notFound()

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonError(400, '请求内容不对')
  }
  const parsed = parsePatch(body)
  if (!parsed.ok) return jsonError(400, parsed.error)

  const result = await patchDocument(clientId, docId, parsed.value, actorOf(access.user))
  if (!result.ok) {
    return result.duplicate
      ? jsonError(409, '资料库里已经有内容完全相同的现行文件，不能再恢复这个旧版', 'duplicate_content')
      : unavailable()
  }
  if (!result.data) return notFound()
  return NextResponse.json({ document: result.data }, { headers: { 'Cache-Control': 'no-store' } })
}
