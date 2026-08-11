import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { normaliseSource, type AssetSource } from '@/lib/assets/provenance'

export const dynamic = 'force-dynamic'

// Shape returned to the gallery UI — identical to the GalleryAsset returned by
// POST /api/clients/[id]/visual-assets so the Social Plan cards can treat a
// library pick the same as a freshly generated image.
interface GalleryAsset {
  id: string
  storage_url: string
  prompt_used: string | null
  is_selected: boolean
  created_at: string
  /** 底图在素材库里的来源 —— 交付前那道「真价只配真画面」的闸靠它判。 */
  source: AssetSource
}

// POST /api/clients/[id]/visual-assets/from-library
// Adds an existing analysed client-library photo to a content post's gallery.
// The library file is referenced by URL, not copied — one storage object can
// back many posts. Each call appends a new variant (gallery accumulates).
//
// NOTE: requires provider 'client_library' to be allowed by the
// visual_assets_provider_check constraint. See migration
// 20260601000002_add_client_library_provider.sql — the INSERT 400s until it runs.
//
// Body: { post_id: string, client_asset_id: string }
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const { post_id, client_asset_id } = (await req.json()) as {
      post_id?: string
      client_asset_id?: string
    }

    if (!post_id || !client_asset_id) {
      return NextResponse.json(
        { success: false, error: 'post_id and client_asset_id required' },
        { status: 400 },
      )
    }

    const access = await requireDashboardClientAccess(params.id)
    if (!access.ok) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status })
    }

    // Verify the library asset belongs to this client and is analysed.
    const { data: libraryAsset, error: lookupErr } = await supabaseAdmin
      .from('client_assets')
      .select('id, storage_url, original_filename, status, client_id, source')
      .eq('id', client_asset_id)
      .eq('client_id', params.id)
      .single()

    if (lookupErr || !libraryAsset) {
      return NextResponse.json(
        { success: false, error: 'Library asset not found for this client' },
        { status: 404 },
      )
    }
    if (libraryAsset.status !== 'analyzed') {
      return NextResponse.json(
        { success: false, error: `Library asset is not analyzed (status: ${libraryAsset.status})` },
        { status: 409 },
      )
    }
    if (!libraryAsset.storage_url) {
      return NextResponse.json(
        { success: false, error: 'Library asset has no storage_url' },
        { status: 409 },
      )
    }

    // Next variant = current count + 1 (smallint, monotonic per post) — same
    // logic as POST /api/clients/[id]/visual-assets.
    const { count } = await supabaseAdmin
      .from('visual_assets')
      .select('id', { count: 'exact', head: true })
      .eq('post_id', post_id)
      .eq('asset_type', 'image')

    const variant = (count ?? 0) + 1

    const { data: asset, error: insertErr } = await supabaseAdmin
      .from('visual_assets')
      .insert({
        post_id,
        client_id:         params.id,
        asset_type:        'image',
        provider:          'client_library',
        prompt_used:       `From library: ${libraryAsset.original_filename ?? client_asset_id}`,
        variant,
        generation_status: 'ready',
        storage_url:       libraryAsset.storage_url,
        cost_usd:          0,
        is_selected:       false,
      })
      .select('id, storage_url, prompt_used, is_selected, created_at')
      .single()

    if (insertErr) throw insertErr

    // 来源不落 visual_assets(那张表没这一列),跟着响应回给界面。刷新后由
    // GET /visual-assets 按 storage_url 回查素材库补上,两条路给出同一个值。
    return NextResponse.json({
      success: true,
      asset: mapAsset(asset, normaliseSource(libraryAsset.source)),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[clients/visual-assets/from-library POST]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

function mapAsset(
  row: {
    id: string
    storage_url: string | null
    prompt_used: string | null
    is_selected: boolean | null
    created_at: string
  },
  source: AssetSource,
): GalleryAsset {
  return {
    id:          row.id,
    storage_url: row.storage_url ?? '',
    prompt_used: row.prompt_used,
    is_selected: row.is_selected ?? false,
    created_at:  row.created_at,
    source,
  }
}
