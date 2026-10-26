/**
 * GET /api/clients/[id]/ad-strategy-config/creative-pool/labels
 * Read-only: maps each creative-pool video id to a readable name / publish date / link,
 * resolved from the factory's published receipts. Ids it cannot match are simply absent.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { loadAdStrategyConfig } from '@/lib/ads-strategy/config'
import { loadCreativeLabels } from '@/lib/ads-strategy/creative-pool-labels'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const config = await loadAdStrategyConfig(clientId)
  const labels = await loadCreativeLabels(clientId, config.creative_pool.map(e => e.ref))
  return NextResponse.json({ success: true, labels })
}
