import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateImage } from '@/lib/visual/openai-images'
import { uploadFromBase64 } from '@/lib/visual/storage'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { chargeForGeneration, refundOnFail } from '@/lib/mtc/charge'

export async function POST(req: NextRequest) {
  try {
    const { post_id, client_id, variant = 1, prompt_override, aspect_ratio = '1:1', production_package_id } = await req.json()

    if (!post_id || !client_id) {
      return NextResponse.json(
        { success: false, error: 'post_id and client_id required' },
        { status: 400 }
      )
    }

    const access = await requireDashboardClientAccess(client_id)
    if (!access.ok) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status })
    }

    const { data: post } = await supabaseAdmin
      .from('content_posts')
      .select('visual_brief, revision_notes')
      .eq('id', post_id)
      .single()

    if (!post?.visual_brief && !prompt_override) {
      return NextResponse.json(
        { success: false, error: 'No visual_brief on this post' },
        { status: 400 }
      )
    }

    const basePrompt = prompt_override || (post?.revision_notes
      ? `${post.visual_brief}. Additional requirements: ${post.revision_notes}`
      : post?.visual_brief) || ''

    // MTC: deduct upfront; refund if anything from this point onward fails
    const charge = await chargeForGeneration(client_id, 'image_single', {
      referenceId: post_id,
      notes: 'visual/image generation',
    })
    if (!charge.ok) {
      return NextResponse.json(charge.body, { status: charge.status })
    }

    let b64: string
    let storage_url: string
    let file_size_kb: number
    let asset: { id: string } | null = null
    try {
      // Generate image synchronously via OpenAI gpt-image-1 (~10-30s)
      ;({ b64 } = await generateImage({ prompt: basePrompt, aspect_ratio }))

      // Upload base64 PNG directly to Supabase storage
      ;({ storage_url, file_size_kb } = await uploadFromBase64({
        base64: b64,
        clientId: client_id,
        postId: post_id,
        assetType: 'image',
        variant,
      }))

      // Insert as ready immediately — no polling needed
      const { data: insertedAsset, error } = await supabaseAdmin
        .from('visual_assets')
        .insert({
          post_id,
          client_id,
          asset_type: 'image',
          provider: 'openai',
          prompt_used: basePrompt,
          variant,
          generation_status: 'ready',
          storage_url,
          file_size_kb,
          cost_usd: 0.04,
        })
        .select()
        .single()

      if (error) throw error
      asset = insertedAsset
    } catch (genErr) {
      await refundOnFail(client_id, 'image_single', charge.mtcAmount, {
        referenceId: post_id,
        reason: genErr instanceof Error ? genErr.message : 'image generation failed',
      })
      throw genErr
    }

    if (post?.revision_notes) {
      await supabaseAdmin
        .from('content_posts')
        .update({ revision_notes: null })
        .eq('id', post_id)
    }

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
            console.error('[visual/image] production_items insert failed:', itemErr)
            return
          }
          if (item) {
            supabaseAdmin
              .from('visual_assets')
              .update({ production_item_id: item.id })
              .eq('id', asset.id)
              .then(({ error: upErr }) => {
                if (upErr) console.error('[visual/image] production_item_id back-ref failed:', upErr)
              })
          }
        })
    }

    return NextResponse.json({
      success: true,
      asset_id: asset?.id,
      storage_url,
      just_completed: true,
    })

  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : (err as { message?: string })?.message ?? String(err)
    console.error('[visual/image]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
