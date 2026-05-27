/**
 * GET /api/clients/[id]/zhangqian/latest
 *
 * Read the most recent Zhangqian DiscoveryReport for a client.
 * 404 if no discovery has been run yet.
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P8.10.S0.10
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { getLatestDiscovery } from '@/lib/zhangqian/persistor'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
    const discovery = await getLatestDiscovery(supabaseAdmin, clientId)

    if (!discovery) {
      return NextResponse.json(
        { success: false, error: 'No discovery exists for this client' },
        { status: 404 },
      )
    }

    return NextResponse.json({ success: true, discovery })
  } catch (err: unknown) {
    console.error('[zhangqian/latest] error', err)
    return NextResponse.json(
      { success: false, error: 'Failed to read discovery' },
      { status: 500 },
    )
  }
}
