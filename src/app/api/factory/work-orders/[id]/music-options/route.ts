import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdminScope } from '@/lib/auth/require-admin'
import { remotionMusicChoices } from '@/lib/factory/remotion-music-options.mjs'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminScope()
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status })
  const { id } = await params
  const { data: order, error } = await supabaseAdmin
    .from('content_work_orders')
    .select('id, client_id, status, remotion_brief:brief->remotion, creative_recipe:brief->creative_recipe')
    .eq('id', id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!order) return NextResponse.json({ error: 'work order not found' }, { status: 404 })
  if (admin.scope.kind !== 'global' && order.client_id !== admin.scope.clientId) {
    return NextResponse.json({ error: 'work order not in this client' }, { status: 403 })
  }
  if (order.status !== 'in_review') {
    return NextResponse.json({ error: 'only in_review work orders have music options' }, { status: 409 })
  }
  return NextResponse.json({
    music_choices: order.creative_recipe ? [] : remotionMusicChoices(order.remotion_brief),
  })
}
