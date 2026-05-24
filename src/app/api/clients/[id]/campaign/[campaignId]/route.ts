import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

type RouteContext = { params: { id: string; campaignId: string } }

// GET /api/clients/[id]/campaign/[campaignId]
export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { id: clientId, campaignId } = params

  const { data, error } = await supabaseAdmin
    .from('campaign_briefs')
    .select('*')
    .eq('id', campaignId)
    .eq('client_id', clientId)
    .single()

  if (error || !data) {
    return NextResponse.json({ success: false, error: 'Campaign not found' }, { status: 404 })
  }

  return NextResponse.json({ success: true, campaign: data })
}

// DELETE /api/clients/[id]/campaign/[campaignId]
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const { id: clientId, campaignId } = params

  try {
    const { error } = await supabaseAdmin
      .from('campaign_briefs')
      .delete()
      .eq('id', campaignId)
      .eq('client_id', clientId)

    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

// PATCH /api/clients/[id]/campaign/[campaignId]
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { id: clientId, campaignId } = params

  try {
    const body = await req.json()

    // Guard: never allow status change via PATCH (use /archive instead)
    const { status: _dropped, client_id: _dropped2, id: _dropped3, ...fields } = body

    const { data, error } = await supabaseAdmin
      .from('campaign_briefs')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', campaignId)
      .eq('client_id', clientId)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ success: true, campaign: data })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
