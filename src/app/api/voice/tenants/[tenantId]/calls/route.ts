/** GET /api/voice/tenants/:tenantId/calls (spec §15.2) — admin, tenant-scoped. */
import { NextRequest, NextResponse } from 'next/server'
import { getVoiceStore } from '@/lib/voice/store'
import { requireVoiceAdmin } from '@/lib/voice/api-auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { tenantId: string } }): Promise<NextResponse> {
  const auth = await requireVoiceAdmin()
  if (auth instanceof NextResponse) return auth

  const store = await getVoiceStore()
  const includeSimulated = req.nextUrl.searchParams.get('includeSimulated') !== 'false'
  const calls = await store.listCallsByTenant(params.tenantId, { limit: 100, includeSimulated })
  return NextResponse.json({ calls })
}
