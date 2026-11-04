/**
 * GET  /api/clients/[id]/week-pack — read the next pack. Issues a card only when the switch is on.
 * POST /api/clients/[id]/week-pack — agree, decline, or stop unpublished Stories.
 * Reel go-public stays behind its own switch and still requires a preview token.
 */
import { NextResponse } from 'next/server'

import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { clickerFromSession } from '@/lib/confirmation-card'
import { createKernel } from '@/lib/kernel'
import { createLiteServicePorts } from '@/lib/social/story-lite/ports'
import type { LiteActor } from '@/lib/social/story-lite/types'
import { handleWeekPackGet, handleWeekPackPost, parseWeekPackCommand } from '@/lib/social/week-pack/http'
import { readClientPackSettings } from '@/lib/social/week-pack/load'
import { readWeekPackEnv, reelGoPublicOnApproveEnabled, weeklyPackApprovalEnabled } from '@/lib/social/week-pack/switches'
import { createWeekPackPorts } from '@/lib/social/week-pack/wire'
import { isUuid } from '@/lib/validation-utils'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function refused(status: number, error: string) {
  return NextResponse.json({ success: false, error }, { status })
}

async function context(req: Request, clientId: string) {
  if (!isUuid(clientId)) return { ok: false as const, response: refused(400, '这个地址不对。') }
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    const error = access.status === 401 ? '请先登录。' : '你不能看这位客户的整包。'
    return { ok: false as const, response: refused(access.status, error) }
  }
  const env = readWeekPackEnv()
  const settings = await readClientPackSettings(supabaseAdmin, clientId)
  const actor: LiteActor = {
    id: access.user.id,
    email: access.user.email ?? '',
    allowedClientId: access.allowedClientId,
  }
  const clicker = clickerFromSession({
    email: actor.email,
    role: access.role,
    allowedClientId: access.allowedClientId,
    clientId,
    agentMarked: req.headers.get('x-me-actor') === 'agent',
  })
  const ports = createWeekPackPorts({
    litePorts: createLiteServicePorts(),
    db: supabaseAdmin,
    kernel: createKernel(supabaseAdmin),
    clicker,
    actor,
    clientId,
    now: new Date(),
    env,
    settings,
  })
  return {
    ok: true as const,
    ctx: {
      enabled: weeklyPackApprovalEnabled(env),
      reelGoPublic: reelGoPublicOnApproveEnabled(env),
      configReadable: settings.configReadable,
      clientId,
      clicker,
      ports,
    },
  }
}

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const ready = await context(req, params.id)
  if (!ready.ok) return ready.response
  const result = await handleWeekPackGet(ready.ctx)
  return NextResponse.json(result.body, { status: result.status })
}

export async function POST(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const ready = await context(req, params.id)
  if (!ready.ok) return ready.response
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return refused(400, '请求内容读不懂，没有收下。')
  }
  const command = parseWeekPackCommand(raw)
  if ('error' in command) return refused(400, command.error)
  const result = await handleWeekPackPost(ready.ctx, command)
  return NextResponse.json(result.body, { status: result.status })
}
