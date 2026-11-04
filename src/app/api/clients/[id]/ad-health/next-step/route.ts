/** GET /api/clients/[id]/ad-health/next-step — 广告下一步合并卡（只读）。 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { loadAdsNextStepView } from '@/lib/ads-strategy/ads-next-step/load-ads-next-step'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const staffView = access.tier === 'admin' && access.allowedClientId === null
  const view = await loadAdsNextStepView(supabaseAdmin, params.id, { staffView })
  return NextResponse.json({ view })
}
