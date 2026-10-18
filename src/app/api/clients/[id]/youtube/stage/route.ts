/**
 * POST /api/clients/[id]/youtube/stage  { workOrderId } | { contentPostId }
 *
 * Emits `youtube.staging.requested`. Staging uploads a PRIVATE copy of an
 * approved factory video; it never makes anything public. Internal admins only.
 */
import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import { YOUTUBE_STAGING_REQUESTED_EVENT } from '@/lib/youtube-publish/workflow'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireGlobalAdmin()
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status })
  const body = (await req.json().catch(() => null)) as { workOrderId?: unknown; contentPostId?: unknown } | null
  const workOrderId = typeof body?.workOrderId === 'string' && UUID.test(body.workOrderId) ? body.workOrderId : null
  const contentPostId = typeof body?.contentPostId === 'string' && UUID.test(body.contentPostId) ? body.contentPostId : null
  if (Boolean(workOrderId) === Boolean(contentPostId)) {
    return NextResponse.json({ error: 'Provide exactly one valid workOrderId or contentPostId (uuid)' }, { status: 400 })
  }
  const requestId = randomUUID()
  const source = workOrderId ? { workOrderId } : { contentPostId: contentPostId! }
  try {
    await sendInngestEvent({
      id: `youtube-staging:${requestId}`,
      name: YOUTUBE_STAGING_REQUESTED_EVENT,
      data: { requestId, clientId: params.id, ...source },
    })
  } catch {
    return NextResponse.json({ error: 'Could not queue staging' }, { status: 502 })
  }
  return NextResponse.json({ success: true, requestId, noPublish: true })
}
