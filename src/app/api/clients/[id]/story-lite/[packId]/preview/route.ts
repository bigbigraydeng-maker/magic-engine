/**
 * GET /api/clients/[id]/story-lite/[packId]/preview
 *
 * Read-only: the pack as the authorisation decision needs it, with every problem the dry run found
 * (file changed, wrong account, price in the text, time already passed ...). Global administrators only.
 */
import { NextRequest, NextResponse } from 'next/server'

import { buildLitePreview } from '@/lib/social/story-lite/service'
import { createLiteServicePorts } from '@/lib/social/story-lite/ports'
import { resolveLiteActor, toLiteResponse } from '@/lib/social/story-lite/route-support'
import { internalError } from '@/lib/social/story-publish/route-support'

export async function GET(req: NextRequest, { params }: { params: { id: string; packId: string } }): Promise<NextResponse> {
  const resolved = await resolveLiteActor(params.id, params.packId)
  if (!resolved.ok) return resolved.response

  const rawDays = req.nextUrl.searchParams.get('lifetime_days')
  const lifetimeDays = rawDays === null ? undefined : Number(rawDays)

  try {
    const result = await buildLitePreview({
      ports: createLiteServicePorts(),
      packId: params.packId,
      clientId: params.id,
      actor: resolved.actor,
      now: new Date(),
      lifetimeDays,
    })
    return toLiteResponse(result)
  } catch (error: unknown) {
    console.error('[story-lite preview] failed', error instanceof Error ? error.message : 'unknown')
    return internalError()
  }
}
