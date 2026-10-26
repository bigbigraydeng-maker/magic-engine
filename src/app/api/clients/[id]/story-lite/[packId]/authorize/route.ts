/**
 * POST /api/clients/[id]/story-lite/[packId]/authorize
 *
 * Authorises a whole weekly Story pack with one click. `confirm` defaults to false: a caller who says
 * nothing gets the preview, never an armed pack. Confirming needs the `content_hash` of the preview the
 * person saw. Authorising publishes nothing: the sweep stays in rehearsal until a person separately
 * turns the live switches on. Global administrators only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { authorizeLitePack } from '@/lib/social/story-lite/service'
import { createLiteServicePorts } from '@/lib/social/story-lite/ports'
import { resolveLiteActor, toLiteResponse } from '@/lib/social/story-lite/route-support'
import { internalError, requireJsonContentType } from '@/lib/social/story-publish/route-support'

const BodySchema = z
  .object({
    confirm: z.boolean().default(false),
    lifetime_days: z.number().int().min(1).max(14).optional(),
    content_hash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  })
  .strict()

export async function POST(req: NextRequest, { params }: { params: { id: string; packId: string } }): Promise<NextResponse> {
  const resolved = await resolveLiteActor(params.id, params.packId)
  if (!resolved.ok) return resolved.response

  const notJson = requireJsonContentType(req)
  if (notJson) return notJson

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'INVALID_AUTHORIZE_COMMAND' }, { status: 400 })
  }

  try {
    const result = await authorizeLitePack({
      ports: createLiteServicePorts(),
      packId: params.packId,
      clientId: params.id,
      actor: resolved.actor,
      confirm: parsed.data.confirm,
      lifetimeDays: parsed.data.lifetime_days,
      expectedContentHash: parsed.data.content_hash,
      now: new Date(),
    })
    return toLiteResponse(result)
  } catch (error: unknown) {
    console.error('[story-lite authorize] failed', error instanceof Error ? error.message : 'unknown')
    return internalError()
  }
}
