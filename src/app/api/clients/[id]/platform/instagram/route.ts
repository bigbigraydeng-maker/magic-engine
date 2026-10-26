import { NextRequest, NextResponse } from 'next/server'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { requireOnboardingClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'

/** Local revocation only, not a claim of revocation at Instagram. No credential read. */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireGlobalAdmin()
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status })
  const access = await requireOnboardingClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const connectionId = req.nextUrl.searchParams.get('connectionId')
  if (!connectionId || !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(connectionId)) {
    return NextResponse.json({ error: 'Valid connectionId required' }, { status: 400 })
  }
  try {
    const { data, error } = await supabaseAdmin.from('platform_oauth_connections')
      .update({ status: 'revoked', updated_at: new Date().toISOString() })
      .eq('id', connectionId).eq('client_id', params.id).eq('provider', 'instagram').eq('purpose', 'legacy')
      .select('id').maybeSingle()
    if (error) throw new Error('Unavailable')
    return data ? NextResponse.json({ success: true }) : NextResponse.json({ error: 'Connection not found' }, { status: 404 })
  } catch { return NextResponse.json({ error: '暂时无法断开授权，请重试。' }, { status: 503 }) }
}
