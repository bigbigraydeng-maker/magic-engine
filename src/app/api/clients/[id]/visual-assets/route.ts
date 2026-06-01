import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateImage } from '@/lib/visual/openai-images'
import { uploadFromBase64 } from '@/lib/visual/storage'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

// Shape returned to the gallery UI (PostCard / StoryCard).
interface GalleryAsset {
  id: string
  storage_url: string
  prompt_used: string | null
  is_selected: boolean
  created_at: string
}

function mapAsset(row: {
  id: string
  storage_url: string | null
  prompt_used: string | null
  is_selected: boolean | null
  created_at: string
}): GalleryAsset {
  return {
    id:          row.id,
    storage_url: row.storage_url ?? '',
    prompt_used: row.prompt_used,
    is_selected: row.is_selected ?? false,
    created_at:  row.created_at,
  }
}

// GET /api/clients/[id]/visual-assets?post_id=xxx
// Returns every ready image asset for a content post, selected one first.
// Used by Social Plan Studio cards to restore the gallery after the drawer
// closes / the page reloads.
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(req.url)
    const postId = searchParams.get('post_id')

    if (!postId) {
      return NextResponse.json({ success: false, error: 'post_id required' }, { status: 400 })
    }

    const access = await requireDashboardClientAccess(params.id)
    if (!access.ok) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status })
    }

    const { data, error } = await supabaseAdmin
      .from('visual_assets')
      .select('id, storage_url, prompt_used, is_selected, created_at')
      .eq('client_id', params.id)
      .eq('post_id', postId)
      .eq('asset_type', 'image')
      .eq('generation_status', 'ready')
      .not('storage_url', 'is', null)
      .order('is_selected', { ascending: false })
      .order('created_at', { ascending: true })

    if (error) throw error

    return NextResponse.json({ success: true, assets: (data ?? []).map(mapAsset) })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[clients/visual-assets GET]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

// POST /api/clients/[id]/visual-assets
// Generates a fresh image from a raw prompt and persists it to visual_assets,
// linked to a content post. Each call appends a new variant — the gallery
// accumulates rather than overwriting. Returns the created asset.
// Body: { post_id: string, prompt: string, aspect_ratio?: string }
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { post_id, prompt, aspect_ratio = '1:1' } = await req.json() as {
      post_id?: string
      prompt?: string
      aspect_ratio?: string
    }

    if (!post_id || !prompt) {
      return NextResponse.json(
        { success: false, error: 'post_id and prompt required' },
        { status: 400 }
      )
    }

    const access = await requireDashboardClientAccess(params.id)
    if (!access.ok) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status })
    }

    // Next variant number = current count + 1 (smallint, monotonic per post).
    const { count } = await supabaseAdmin
      .from('visual_assets')
      .select('id', { count: 'exact', head: true })
      .eq('post_id', post_id)
      .eq('asset_type', 'image')

    const variant = (count ?? 0) + 1

    const { b64 } = await generateImage({ prompt, aspect_ratio })

    const { storage_url, file_size_kb } = await uploadFromBase64({
      base64:    b64,
      clientId:  params.id,
      postId:    post_id,
      assetType: 'image',
      // storage helper types variant as 1|2 for legacy callers; the DB column
      // is smallint and accepts any positive int. Cast keeps strict mode happy.
      variant:   variant as 1 | 2,
    })

    const { data: asset, error } = await supabaseAdmin
      .from('visual_assets')
      .insert({
        post_id,
        client_id:         params.id,
        asset_type:        'image',
        provider:          'openai',
        prompt_used:       prompt,
        variant,
        generation_status: 'ready',
        storage_url,
        file_size_kb,
        cost_usd:          0.04,
        is_selected:       false,
      })
      .select('id, storage_url, prompt_used, is_selected, created_at')
      .single()

    if (error) throw error

    return NextResponse.json({ success: true, asset: mapAsset(asset) })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[clients/visual-assets POST]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
