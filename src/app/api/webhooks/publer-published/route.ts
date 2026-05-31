/**
 * POST /api/webhooks/publer-published
 *
 * Called by Publer when a scheduled post is confirmed published.
 * Updates content_posts status and writes a flywheel_action outcome
 * (social.publish_post) for attribution tracking.
 *
 * P21.7: flywheel outcome write added (non-blocking).
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { logSocialPublishedAction } from '@/lib/flywheel/social-post-publish'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { publer_post_id, published_at } = body

    if (!publer_post_id) {
      return NextResponse.json({ error: 'publer_post_id required' }, { status: 400 })
    }

    const { data: post } = await supabaseAdmin
      .from('content_posts')
      .select('id, client_id')
      .eq('publer_post_id', publer_post_id)
      .single()

    if (!post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    const confirmedAt = published_at || new Date().toISOString()

    await supabaseAdmin
      .from('content_posts')
      .update({
        status:       'published',
        published_at: confirmedAt,
      })
      .eq('id', post.id)

    // P21.7: Write flywheel outcome (non-blocking — webhook always returns 200)
    logSocialPublishedAction(post.id, post.client_id, confirmedAt).then(actionId => {
      if (actionId) {
        console.log(`[publer-published] flywheel_action logged: ${actionId} for post ${post.id}`)
      }
    })

    return NextResponse.json({ success: true })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[webhook/publer-published]', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
