import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateImage } from '@/lib/visual/openai-images'
import { uploadFromBase64 } from '@/lib/visual/storage'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import type { BlogPost } from '@/types/magic-engine'

/**
 * POST /api/clients/[id]/blog/[postId]/image
 * Generate and store a hero image for a blog post.
 *
 * Uses the post's existing featured_image_prompt (built with MB visual DNA +
 * Campaign context at article-generation time). The FDE can supply a
 * prompt_override in the request body to use a custom prompt instead.
 *
 * On success, sets blog_posts.featured_image_url and returns the updated post.
 * Image is stored in Supabase visual-assets/{clientId}/blog-hero/.
 */

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; postId: string } }
) {
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
    const { postId } = params
    const body = (await req.json()) as { prompt_override?: string }

    // Ownership check + fetch prompt + title for fallback
    const { data: post, error: fetchErr } = await supabaseAdmin
      .from('blog_posts')
      .select('id, featured_image_prompt, title, topic')
      .eq('id', postId)
      .eq('client_id', clientId)
      .single()

    if (fetchErr || !post) {
      return NextResponse.json({ success: false, error: 'Post not found' }, { status: 404 })
    }

    const promptOverride = body.prompt_override?.trim()
    const prompt =
      promptOverride ||
      post.featured_image_prompt ||
      `Professional editorial hero image for "${post.title || post.topic}", clean composition, natural lighting, high resolution`

    // Generate via gpt-image-1 — synchronous (~10-30s), returns base64 PNG
    const { b64 } = await generateImage({ prompt, aspect_ratio: '16:9' })

    // Upload to Supabase storage under blog-hero subfolder
    const { storage_url } = await uploadFromBase64({
      base64: b64,
      clientId,
      postId,
      assetType: 'image',
      folder: 'blog-hero',
    })

    const patch: Record<string, string> = { featured_image_url: storage_url }
    if (promptOverride) patch.featured_image_prompt = promptOverride

    const { data: updated, error: patchErr } = await supabaseAdmin
      .from('blog_posts')
      .update(patch)
      .eq('id', postId)
      .eq('client_id', clientId)
      .select('*')
      .single<BlogPost>()

    if (patchErr || !updated) {
      console.error('[blog image] update error:', patchErr)
      return NextResponse.json({ success: false, error: 'Failed to save image URL' }, { status: 500 })
    }

    return NextResponse.json({ success: true, post: updated })

  } catch (err: unknown) {
    console.error('[blog image] Unexpected error:', err)
    const message = err instanceof Error ? err.message : 'Image generation failed'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
