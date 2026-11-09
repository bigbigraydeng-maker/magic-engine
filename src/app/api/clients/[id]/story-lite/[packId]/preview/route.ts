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

  // ?check_files=0 is the page's first, fast look: it skips re-downloading every picture. It is NEVER enough to
  // authorise: the answer says `files_checked: false`, and the authorise route always runs the full check itself.
  const quick = req.nextUrl.searchParams.get('check_files') === '0'
  const rawDays = req.nextUrl.searchParams.get('lifetime_days')
  const lifetimeDays = rawDays === null ? undefined : Number(rawDays)

  try {
    const basePorts = createLiteServicePorts()
    const result = await buildLitePreview({
      ports: quick ? { ...basePorts, checkFile: async () => 'OK' } : basePorts,
      packId: params.packId,
      clientId: params.id,
      actor: resolved.actor,
      now: new Date(),
      lifetimeDays,
    })
    if (quick && result.ok) return NextResponse.json({ success: true, ...result.value, files_checked: false })
    return toLiteResponse(result)
  } catch (error: unknown) {
    console.error('[story-lite preview] failed', error instanceof Error ? error.message : 'unknown')
    return internalError()
  }
}
