/**
 * POST /api/clients/[id]/youtube/authorize-public  { videoId }
 *
 * Records the owner's direct authorisation for ONE staged video and emits
 * `youtube.public.authorized`. The grant carries a one-time nonce that the
 * workflow consumes atomically. The downstream step is dry-run only, so this
 * authorises a rehearsal of going public, not a real publish.
 */
import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import { findStagedReceipt, insertAuthorization } from '@/lib/youtube-publish/store'
import { YOUTUBE_PUBLIC_AUTHORIZED_EVENT } from '@/lib/youtube-publish/workflow'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireGlobalAdmin()
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status })
  const body = (await req.json().catch(() => null)) as { videoId?: unknown } | null
  const videoId = typeof body?.videoId === 'string' ? body.videoId.trim() : ''
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) {
    return NextResponse.json({ error: 'videoId is required' }, { status: 400 })
  }
  const staged = await findStagedReceipt(params.id, { videoId })
  if (!staged) return NextResponse.json({ error: 'This video has no staging receipt for this client' }, { status: 404 })

  const nonce = randomUUID()
  const grantedAt = new Date().toISOString()
  await insertAuthorization({
    nonce,
    clientId: params.id,
    channelId: staged.channelId,
    videoId,
    grantedBy: admin.user.email ?? admin.user.id,
    grantedAt,
  })
  try {
    await sendInngestEvent({
      id: `youtube-public:${nonce}`,
      name: YOUTUBE_PUBLIC_AUTHORIZED_EVENT,
      data: { clientId: params.id, nonce },
    })
  } catch {
    return NextResponse.json({ error: 'Authorisation saved but event not sent' }, { status: 502 })
  }
  return NextResponse.json({ success: true, nonce, dryRunOnly: true })
}
