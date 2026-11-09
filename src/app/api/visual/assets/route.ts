import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

export const dynamic = 'force-dynamic'

// GET /api/visual/assets?client_id=… — recent visual assets of ONE client for history panel
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('client_id')
  if (!clientId) {
    return NextResponse.json({ error: 'client_id required' }, { status: 400 })
  }
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  try {
    const { data, error } = await supabaseAdmin
      .from('visual_assets')
      .select('id, asset_type, generation_status, storage_url, cost_usd, created_at, prompt_used, post_id')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) throw error
    return NextResponse.json({ assets: data ?? [] })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
