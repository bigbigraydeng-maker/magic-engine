/**
 * POST /api/clients/[id]/story-packs/[packId]/authorize
 *
 * Authorises a whole weekly Story pack. `confirm` defaults to false: a caller who says nothing gets
 * a preview, never an armed grant. Confirming needs the `content_hash` of the preview the person saw. Authorising does NOT publish anything: the publisher stays in
 * dry-run until a person separately turns the live switches on. Global administrators only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { authorizeStoryPack } from '@/lib/social/story-publish/authorize'
import { createStoryServicePorts } from '@/lib/social/story-publish/ports'
import {
  internalError,
  requireJsonContentType,
  resolveStoryActor,
  toResponse,
} from '@/lib/social/story-publish/route-support'

const BodySchema = z
  .object({
    confirm: z.boolean().default(false),
    expires_in_days: z.number().int().min(1).max(14).optional(),
    // the `content_hash` the preview returned: a confirmation without it (or with a stale one) is refused
    content_hash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  })
  .strict()

export async function POST(req: NextRequest, { params }: { params: { id: string; packId: string } }): Promise<NextResponse> {
  const resolved = await resolveStoryActor(params.id, params.packId)
  if (!resolved.ok) return resolved.response

  const notJson = requireJsonContentType(req)
  if (notJson) return notJson

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'INVALID_AUTHORIZE_COMMAND' }, { status: 400 })
  }

  try {
    const result = await authorizeStoryPack({
      ports: createStoryServicePorts(),
      packId: params.packId,
      clientId: params.id,
      actor: resolved.actor,
      confirm: parsed.data.confirm,
      expiresInDays: parsed.data.expires_in_days,
      expectedContentHash: parsed.data.content_hash,
      now: new Date(),
    })
    return toResponse(result)
  } catch (error: unknown) {
    console.error('[story-packs authorize] failed', error instanceof Error ? error.message : 'unknown')
    return internalError()
  }
}
