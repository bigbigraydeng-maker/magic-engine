/** GET /api/voice/tenants/:tenantId/leads (spec §15.2) — admin, tenant-scoped. */
import { NextResponse } from 'next/server'
import { getVoiceStore } from '@/lib/voice/store'
import { requireVoiceAdmin } from '@/lib/voice/api-auth'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: { tenantId: string } }): Promise<NextResponse> {
  const auth = await requireVoiceAdmin()
  if (auth instanceof NextResponse) return auth

  const store = await getVoiceStore()
  const leads = await store.listLeadsByTenant(params.tenantId, 100)
  return NextResponse.json({ leads })
}
