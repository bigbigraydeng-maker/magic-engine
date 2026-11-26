import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { makeVideoUploadExec } from '@/lib/ads-strategy/video-upload-exec'
import { confirmVideoUploadCard } from '@/lib/ads-strategy/video-upload-card'
import { rejectAgentAdsBearer } from '@/lib/auth/agent-ads-guard'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { createKernel } from '@/lib/kernel'
import { assertMayClick, clickerFromSession } from '@/lib/confirmation-card'
import { parseDecisionBody, publicError } from '@/lib/confirmation-card/http'
import { runAssetDualReviewById } from '@/lib/factory/asset-dual-review-run'
import { supabaseDualReviewIo } from '@/lib/factory/asset-dual-review-store'
import { isUuid } from '@/lib/validation-utils'

export const maxDuration = 120

async function personWhoMayClick(req: Request, clientId: string) {
  const denied = await rejectAgentAdsBearer(req, { clientId, action: 'write_meta' })
  if (denied) return { response: denied }
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    const message = access.status === 401 ? '请先登录。' : '你不能替这位客户确认这张卡。'
    return { response: NextResponse.json({ error: message }, { status: access.status }) }
  }
  const clicker = clickerFromSession({
    email: access.user.email ?? '',
    role: access.role,
    allowedClientId: access.allowedClientId,
    clientId,
    agentMarked: req.headers.get('x-me-actor') === 'agent',
  })
  try {
    assertMayClick(clicker, clientId)
    return { clicker }
  } catch (error) {
    const mapped = publicError(error)
    return { response: NextResponse.json({ error: mapped.message }, { status: mapped.status }) }
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id: string; runId: string } | Promise<{ id: string; runId: string }> },
) {
  const { id, runId } = await params
  if (!isUuid(id) || !isUuid(runId)) return NextResponse.json({ error: '这个地址不对。' }, { status: 400 })
  const who = await personWhoMayClick(req, id)
  if ('response' in who) return who.response
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: '请求内容读不懂，没有收下。' }, { status: 400 })
  }
  try {
    const body = parseDecisionBody(raw)
    const result = await confirmVideoUploadCard({
      kernel: createKernel(supabaseAdmin),
      clientId: id,
      runId,
      clicker: who.clicker,
      resolution: body.resolution,
      expectedDecisionId: body.expectedDecisionId,
      fingerprint: body.fingerprint,
      deps: makeVideoUploadExec(supabaseAdmin, id),
    })
    if (!result.card) return NextResponse.json({ error: result.reason, wroteMeta: false }, { status: result.statusCode })
    if (result.statusCode === 200 && result.wrote && result.videoId && result.workOrderId) {
      await poolAfterUpload(result.workOrderId)
    }
    return NextResponse.json({ ...result.card, statusLine: result.reason, wroteMeta: result.wrote })
  } catch (error) {
    const mapped = publicError(error)
    return NextResponse.json({ error: mapped.message, wroteMeta: false }, { status: mapped.status })
  }
}

async function poolAfterUpload(workOrderId: string): Promise<void> {
  await runAssetDualReviewById(supabaseDualReviewIo(supabaseAdmin), workOrderId).catch(() => undefined)
}
