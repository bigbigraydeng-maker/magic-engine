import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireSession } from '@/lib/auth/require-session'
import { getPositionChangesForClient } from '@/lib/seo-intelligence/position-changes'
import { requirePaidClientAccess } from '@/lib/auth/client-access'

/**
 * GET /api/clients/[id]/seo-intelligence/position-changes
 *
 * Compares the latest two keyword_snapshots dates for a client and returns
 * New / Lost / Improved / Declined keyword movements.
 *
 * Reference: ROADMAP.md P12.I.9
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }

  const session = await requireSession()
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status })
  }

  const { id: clientId } = params
  const { data: client, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('id', clientId)
    .single()

  if (clientError || !client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  try {
    const result = await getPositionChangesForClient(clientId)
    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=900',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to compute position changes'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
