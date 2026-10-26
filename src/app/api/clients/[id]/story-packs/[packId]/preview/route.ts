/**
 * GET /api/clients/[id]/story-packs/[packId]/preview
 *
 * Read-only: shows a Story pack the way the authorisation decision needs it, with every
 * problem the dry run found. Global administrators only. Writes nothing.
 */
import { NextRequest, NextResponse } from 'next/server'

import { createStoryServicePorts } from '@/lib/social/story-publish/ports'
import { buildStoryPackPreview } from '@/lib/social/story-publish/preview'
import { internalError, resolveStoryActor, toResponse } from '@/lib/social/story-publish/route-support'

export async function GET(req: NextRequest, { params }: { params: { id: string; packId: string } }): Promise<NextResponse> {
  const resolved = await resolveStoryActor(params.id, params.packId)
  if (!resolved.ok) return resolved.response

  const rawDays = req.nextUrl.searchParams.get('expires_in_days')
  const expiresInDays = rawDays === null ? undefined : Number(rawDays)

  try {
    const result = await buildStoryPackPreview({
      ports: createStoryServicePorts(),
      packId: params.packId,
      clientId: params.id,
      actor: resolved.actor,
      now: new Date(),
      expiresInDays,
    })
    return toResponse(result)
  } catch (error: unknown) {
    console.error('[story-packs preview] failed', error instanceof Error ? error.message : 'unknown')
    return internalError()
  }
}
