import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireSession } from '@/lib/auth/require-session'

export const dynamic = 'force-dynamic'

// GET /api/visual/assets — recent visual assets for history panel
export async function GET() {
  const session = await requireSession()
  if (!session.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const { data, error } = await supabaseAdmin
      .from('visual_assets')
      .select('id, asset_type, generation_status, storage_url, cost_usd, created_at, prompt_used, post_id')
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) throw error
    return NextResponse.json({ assets: data ?? [] })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
