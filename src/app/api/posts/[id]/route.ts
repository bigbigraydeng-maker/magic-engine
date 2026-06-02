import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { data, error } = await supabaseAdmin
      .from('content_posts')
      .select('id, client_id, title, route, platforms, status, caption, script, hashtags, visual_brief, scheduled_at, created_at, execution_item_id, clients(name)')
      .eq('id', params.id)
      .single()

    if (error) throw error

    let visual_asset_url: string | null = null
    let visual_asset_type: string | null = null

    const { data: assetRow } = await supabaseAdmin
      .from('visual_assets')
      .select('storage_url, asset_type')
      .eq('post_id', params.id)
      .eq('generation_status', 'ready')
      .not('storage_url', 'is', null)
      .order('is_final', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (assetRow) {
      visual_asset_url = assetRow.storage_url
      visual_asset_type = assetRow.asset_type
    }

    return NextResponse.json({
      success: true,
      post: {
        ...data,
        visual_asset_url,
        visual_asset_type,
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json()

    const allowed = ['title', 'script', 'caption', 'visual_brief', 'hashtags', 'scheduled_at', 'status', 'revision_notes', 'execution_item_id']
    const update: Record<string, unknown> = {}
    for (const key of allowed) {
      if (key in body) update[key] = body[key]
    }

    const { error } = await supabaseAdmin
      .from('content_posts')
      .update(update)
      .eq('id', params.id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
