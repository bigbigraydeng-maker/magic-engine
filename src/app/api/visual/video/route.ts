import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { submitVideoGeneration } from '@/lib/visual/seedance'

export async function POST(req: NextRequest) {
  try {
    const { post_id, client_id, variant = 1, aspect_ratio = '9:16', production_package_id } = await req.json()

    if (!post_id || !client_id) {
      return NextResponse.json(
        { success: false, error: 'post_id and client_id required' },
        { status: 400 }
      )
    }

    const { data: post } = await supabaseAdmin
      .from('content_posts')
      .select('visual_brief, revision_notes')
      .eq('id', post_id)
      .single()

    if (!post?.visual_brief) {
      return NextResponse.json(
        { success: false, error: 'No visual_brief on this post' },
        { status: 400 }
      )
    }

    const prompt = post.revision_notes
      ? `${post.visual_brief}. ${post.revision_notes}`
      : post.visual_brief

    const { job_id } = await submitVideoGeneration({ prompt, aspect_ratio })

    const { data: asset, error } = await supabaseAdmin
      .from('visual_assets')
      .insert({
        post_id,
        client_id,
        asset_type: 'video',
        provider: 'seedance',
        prompt_used: prompt,
        variant,
        generation_status: 'generating',
        provider_job_id: job_id,
      })
      .select()
      .single()

    if (error) throw error

    // Link to production package if provided (non-blocking)
    if (production_package_id && asset) {
      supabaseAdmin
        .from('production_items')
        .insert({
          package_id: production_package_id,
          client_id,
          content_type: 'visual_asset',
          visual_asset_id: asset.id,
          sort_order: 0,
          status: 'ready',
        })
        .select('id')
        .single()
        .then(({ data: item, error: itemErr }) => {
          if (itemErr) {
            console.error('[visual/video] production_items insert failed:', itemErr)
            return
          }
          if (item) {
            supabaseAdmin
              .from('visual_assets')
              .update({ production_item_id: item.id })
              .eq('id', asset.id)
              .then(({ error: upErr }) => {
                if (upErr) console.error('[visual/video] production_item_id back-ref failed:', upErr)
              })
          }
        })
    }

    return NextResponse.json({
      success: true,
      asset_id: asset?.id,
      job_id,
      message: 'Video generation started. Poll /api/visual/status/:assetId for updates.',
    })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[visual/video]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
