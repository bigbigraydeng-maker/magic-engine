import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { submitImageGeneration } from '@/lib/visual/atlas'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

// Shape returned to the gallery UI (PostCard / StoryCard).
interface GalleryAsset {
  id: string
  storage_url: string
  prompt_used: string | null
  is_selected: boolean
  created_at: string
  generation_status: string
}

function mapAsset(row: {
  id: string
  storage_url: string | null
  prompt_used: string | null
  is_selected: boolean | null
  created_at: string
  generation_status: string | null
}): GalleryAsset {
  return {
    id:                row.id,
    storage_url:       row.storage_url ?? '',
    prompt_used:       row.prompt_used,
    is_selected:       row.is_selected ?? false,
    created_at:        row.created_at,
    generation_status: row.generation_status ?? 'ready',
  }
}

// GET /api/clients/[id]/visual-assets?post_id=xxx
// Returns all image assets for a content post (including generating/failed),
// selected first. Used by Social Plan Studio cards to restore gallery after
// drawer closes / page reloads, and for polling generation status.
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
      .select('id, storage_url, prompt_used, is_selected, created_at, generation_status')
      .eq('client_id', params.id)
      .eq('post_id', postId)
      .eq('asset_type', 'image')
      .in('generation_status', ['ready', 'generating', 'queued_for_retry'])
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
// Submits an async image generation job to Atlas and immediately persists a
// visual_asset row with generation_status = 'generating'. Returns the asset
// row at once — the caller polls GET until status = 'ready'.
// The cron /api/cron/poll-visual-jobs picks up 'generating' rows and finalises them.
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

    // Resolve aspect ratio to pixel dimensions (Atlas requires width/height).
    const [w, h] = resolvePixelDimensions(aspect_ratio)

    // Submit async job to Atlas — returns immediately with a job_id.
    const { job_id } = await submitImageGeneration({ prompt, width: w, height: h })

    // Next variant number = current count + 1.
    const { count } = await supabaseAdmin
      .from('visual_assets')
      .select('id', { count: 'exact', head: true })
      .eq('post_id', post_id)
      .eq('asset_type', 'image')

    const variant = (count ?? 0) + 1

    const { data: asset, error } = await supabaseAdmin
      .from('visual_assets')
      .insert({
        post_id,
        client_id:         params.id,
        asset_type:        'image',
        provider:          'wavespeed',
        provider_job_id:   job_id,
        prompt_used:       prompt,
        variant,
        generation_status: 'generating',
        is_selected:       false,
        queued_at:         new Date().toISOString(),
      })
      .select('id, storage_url, prompt_used, is_selected, created_at, generation_status')
      .single()

    if (error) throw error

    return NextResponse.json({ success: true, asset: mapAsset(asset) })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[clients/visual-assets POST]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

function resolvePixelDimensions(aspectRatio: string): [number, number] {
  const map: Record<string, [number, number]> = {
    '1:1':  [1024, 1024],
    '4:5':  [896, 1120],
    '9:16': [720, 1280],
    '16:9': [1280, 720],
  }
  return map[aspectRatio] ?? [1024, 1024]
}
