/**
 * POST /api/clients/[id]/story-lite/[packId]/revoke
 *
 * Stops a pack: nothing that has not been sent will be sent. Stories already published are NOT removed
 * (the response says so and lists what went out). Global administrators only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { revokeLitePack } from '@/lib/social/story-lite/service'
import { createLiteServicePorts } from '@/lib/social/story-lite/ports'
import { resolveLiteActor, toLiteResponse } from '@/lib/social/story-lite/route-support'
import { internalError, requireJsonContentType } from '@/lib/social/story-publish/route-support'

const BodySchema = z.object({ reason: z.string().trim().min(1).max(300) }).strict()

export async function POST(req: NextRequest, { params }: { params: { id: string; packId: string } }): Promise<NextResponse> {
  const resolved = await resolveLiteActor(params.id, params.packId)
  if (!resolved.ok) return resolved.response

  const notJson = requireJsonContentType(req)
  if (notJson) return notJson

  const parsed = BodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'INVALID_REVOKE_COMMAND' }, { status: 400 })
  }

  try {
    const result = await revokeLitePack({
      ports: createLiteServicePorts(),
      packId: params.packId,
      clientId: params.id,
      actor: resolved.actor,
      reason: parsed.data.reason,
      now: new Date(),
    })
    return toLiteResponse(result)
  } catch (error: unknown) {
    console.error('[story-lite revoke] failed', error instanceof Error ? error.message : 'unknown')
    return internalError()
  }
}
