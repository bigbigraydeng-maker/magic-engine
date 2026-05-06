import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateSocialSuggestions } from '@/lib/strategy/social-suggester'

/**
 * POST /api/clients/[id]/blog/[postId]/social-suggest
 *
 * Loads the blog post, asks GPT-4o-mini for 3 platform-specific
 * social riffs, and persists them as content_strategy_items rows
 * (action_type='social_content', linked_blog_post_id=postId).
 *
 * Reference: ROADMAP.md P8.D.2.4
 */
export const maxDuration = 60

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; postId: string } }
) {
  try {
    const { data: post, error } = await supabaseAdmin
      .from('blog_posts')
      .select('id, client_id, title, html_body, primary_keyword')
      .eq('id', params.postId)
      .single()

    if (error || !post) {
      return NextResponse.json(
        { success: false, error: 'Blog post not found' },
        { status: 404 }
      )
    }
    if (post.client_id !== params.id) {
      return NextResponse.json(
        { success: false, error: 'Blog post does not belong to client' },
        { status: 404 }
      )
    }

    const result = await generateSocialSuggestions({
      client_id: post.client_id,
      blog_post_id: post.id,
      title: post.title,
      html_body: post.html_body ?? '',
      primary_keyword: post.primary_keyword,
    })

    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
