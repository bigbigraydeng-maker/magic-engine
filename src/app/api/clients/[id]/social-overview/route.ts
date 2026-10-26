/**
 * GET /api/clients/[id]/social-overview
 *
 * Read-only week overview (Stories + factory Reels; Posts not wired yet) for one client.
 * Global administrators only. Never downloads a picture and never changes anything.
 */
import { NextResponse } from 'next/server'

import { createLiteServicePorts } from '@/lib/social/story-lite/ports'
import { resolveLiteClientActor, toLiteResponse } from '@/lib/social/story-lite/route-support'
import { readLiteSwitches } from '@/lib/social/story-lite/sender'
import { buildWeekOverview } from '@/lib/social/week-overview/build'
import { internalError } from '@/lib/social/story-publish/route-support'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const resolved = await resolveLiteClientActor(params.id)
  if (!resolved.ok) return resolved.response

  try {
    const result = await buildWeekOverview({
      ports: createLiteServicePorts(),
      db: supabaseAdmin,
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
    console.error('[social-overview] failed', error instanceof Error ? error.message : 'unknown')
    return internalError()
  }
}
