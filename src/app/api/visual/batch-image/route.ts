import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateImage } from '@/lib/visual/openai-images'
import { uploadFromBase64 } from '@/lib/visual/storage'
import { requireSession } from '@/lib/auth/require-session'

interface BatchResult {
  post_id: string
  asset_id: string | null
  ok: boolean
  error?: string
}

// POST /api/visual/batch-image
// Body: { post_ids: string[] }  (max 20)
// Processes sequentially to avoid OpenAI rate limits.
// On success per post: inserts visual_assets + upgrades content_posts.status to 'approved'.
export async function POST(req: NextRequest) {
  const session = await requireSession()
  if (!session.ok) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { post_ids } = await req.json() as { post_ids?: string[] }

    if (!Array.isArray(post_ids) || post_ids.length === 0) {
      return NextResponse.json({ success: false, error: 'post_ids required' }, { status: 400 })
    }
    if (post_ids.length > 20) {
      return NextResponse.json({ success: false, error: 'Max 20 posts per batch' }, { status: 400 })
    }

    const { data: dbPosts, error: fetchErr } = await supabaseAdmin
      .from('content_posts')
      .select('id, client_id, visual_brief')
      .in('id', post_ids)

    if (fetchErr) throw fetchErr

    const postMap = new Map(
      (dbPosts ?? []).map(p => [p.id as string, p as { id: string; client_id: string; visual_brief: string | null }])
    )

    const results: BatchResult[] = []

    for (const postId of post_ids) {
      const post = postMap.get(postId)
      if (!post?.visual_brief) {
        results.push({ post_id: postId, asset_id: null, ok: false, error: 'No visual_brief' })
        continue
      }

      try {
        const { b64 } = await generateImage({ prompt: post.visual_brief, aspect_ratio: '1:1' })

        const { storage_url, file_size_kb } = await uploadFromBase64({
          base64: b64,
          clientId: post.client_id,
          postId,
          assetType: 'image',
          variant: 1,
        })

        const { data: asset, error: insertErr } = await supabaseAdmin
          .from('visual_assets')
          .insert({
            post_id:           postId,
            client_id:         post.client_id,
            asset_type:        'image',
            provider:          'openai',
            prompt_used:       post.visual_brief,
            variant:           1,
            generation_status: 'ready',
            storage_url,
            file_size_kb,
            cost_usd:          0.04,
          })
          .select('id')
          .single()

        if (insertErr) throw insertErr

        await supabaseAdmin
          .from('content_posts')
          .update({ status: 'approved' })
          .eq('id', postId)

        results.push({ post_id: postId, asset_id: asset?.id ?? null, ok: true })
      } catch (itemErr: unknown) {
        const msg = itemErr instanceof Error ? itemErr.message : String(itemErr)
        results.push({ post_id: postId, asset_id: null, ok: false, error: msg })
      }
    }

    return NextResponse.json({ success: true, results })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[batch-image]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
