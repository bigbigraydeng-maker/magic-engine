/**
 * GET /api/clients/[id]/ad-strategy-config/creative-pool/thumbnails
 * Read-only: live thumbnail / title / duration for each creative-pool video, read from
 * Meta on every call (thumbnail URLs expire, so nothing is stored). Always answers 200:
 * a failed Meta read just leaves that video out and the page shows a placeholder.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { loadAdStrategyConfig } from '@/lib/ads-strategy/config'
import { loadCreativeThumbnails } from '@/lib/ads-strategy/creative-pool-thumbnails'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const config = await loadAdStrategyConfig(clientId)
  const thumbnails = await loadCreativeThumbnails(clientId, config.creative_pool)
  return NextResponse.json({ success: true, thumbnails })
}
