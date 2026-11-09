/**
 * POST /api/clients/[id]/story-packs/[packId]/revoke
 *
 * Revokes the live authorisation of a Story pack. Stops anything not yet sent; stories that are
 * already published are NOT removed (the response says so and lists what is in flight).
 * Global administrators only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { createStoryServicePorts } from '@/lib/social/story-publish/ports'
import { revokeStoryPack } from '@/lib/social/story-publish/authorize'
import {
  internalError,
  requireJsonContentType,
  resolveStoryActor,
  toResponse,
} from '@/lib/social/story-publish/route-support'

const BodySchema = z.object({ reason: z.string().trim().min(1).max(300) }).strict()

export async function POST(req: NextRequest, { params }: { params: { id: string; packId: string } }): Promise<NextResponse> {
  const resolved = await resolveStoryActor(params.id, params.packId)
  if (!resolved.ok) return resolved.response

  const notJson = requireJsonContentType(req)
  if (notJson) return notJson

  const parsed = BodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'INVALID_REVOKE_COMMAND' }, { status: 400 })
  }

  try {
    const result = await revokeStoryPack({
      ports: createStoryServicePorts(),
      packId: params.packId,
      clientId: params.id,
      actor: resolved.actor,
      reason: parsed.data.reason,
      now: new Date(),
    })
    return toResponse(result)
  } catch (error: unknown) {
    console.error('[story-packs revoke] failed', error instanceof Error ? error.message : 'unknown')
    return internalError()
  }
}
