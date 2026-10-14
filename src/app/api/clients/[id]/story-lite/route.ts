/**
 * GET /api/clients/[id]/story-lite
 *
 * Read-only: the client's newest Story packs and whether real publishing is switched on for this client.
 * Global administrators only.
 */
import { NextResponse } from 'next/server'

import { listLitePacks } from '@/lib/social/story-lite/list'
import { createLiteServicePorts } from '@/lib/social/story-lite/ports'
import { resolveLiteClientActor, toLiteResponse } from '@/lib/social/story-lite/route-support'
import { readLiteSwitches } from '@/lib/social/story-lite/sender'
import { internalError } from '@/lib/social/story-publish/route-support'

export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const resolved = await resolveLiteClientActor(params.id)
  if (!resolved.ok) return resolved.response

  try {
    const result = await listLitePacks({
      ports: createLiteServicePorts(),
      clientId: params.id,
      actor: resolved.actor,
      switches: readLiteSwitches({
        STORY_AUTO_PUBLISH_LIVE: process.env.STORY_AUTO_PUBLISH_LIVE,
        STORY_AUTO_PUBLISH_CLIENTS: process.env.STORY_AUTO_PUBLISH_CLIENTS,
      }),
      now: new Date(),
    })
    return toLiteResponse(result)
  } catch (error: unknown) {
    console.error('[story-lite list] failed', error instanceof Error ? error.message : 'unknown')
    return internalError()
  }
}
