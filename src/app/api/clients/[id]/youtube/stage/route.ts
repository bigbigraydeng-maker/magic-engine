/**
 * POST /api/clients/[id]/youtube/stage  { workOrderId }
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
  const body = (await req.json().catch(() => null)) as { workOrderId?: unknown } | null
  if (typeof body?.workOrderId !== 'string' || !UUID.test(body.workOrderId)) {
    return NextResponse.json({ error: 'workOrderId (uuid) is required' }, { status: 400 })
  }
  const requestId = randomUUID()
  try {
    await sendInngestEvent({
      id: `youtube-staging:${requestId}`,
      name: YOUTUBE_STAGING_REQUESTED_EVENT,
      data: { requestId, clientId: params.id, workOrderId: body.workOrderId },
    })
  } catch {
    return NextResponse.json({ error: 'Could not queue staging' }, { status: 502 })
  }
  return NextResponse.json({ success: true, requestId, noPublish: true })
}
