// Batch update post status or delete multiple posts at once
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

const ALLOWED_STATUSES = ['draft', 'approved', 'scheduled', 'published', 'rejected'] as const
type PostStatus = typeof ALLOWED_STATUSES[number]

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { post_ids, action, status } = body

    if (!Array.isArray(post_ids) || post_ids.length === 0) {
      return NextResponse.json({ success: false, error: 'post_ids array required' }, { status: 400 })
    }

    if (!post_ids.every((id: unknown) => typeof id === 'string' && id.length > 0)) {
      return NextResponse.json({ success: false, error: 'post_ids must be an array of non-empty strings' }, { status: 400 })
    }

    if (post_ids.length > 100) {
      return NextResponse.json({ success: false, error: 'Max 100 posts per batch' }, { status: 400 })
    }

    const resolvedAction: string = action ?? 'updateStatus'

    if (resolvedAction === 'delete') {
      const { data, error } = await supabaseAdmin
        .from('content_posts')
        .delete()
        .in('id', post_ids)
        .select('id')

      if (error) throw error
      return NextResponse.json({ success: true, deleted: data?.length ?? 0 })
    }

    if (resolvedAction === 'updateStatus') {
      if (!ALLOWED_STATUSES.includes(status as PostStatus)) {
        return NextResponse.json(
          { success: false, error: `status must be one of: ${ALLOWED_STATUSES.join(', ')}` },
          { status: 400 }
        )
      }

      const { data, error } = await supabaseAdmin
        .from('content_posts')
        .update({ status })
        .in('id', post_ids)
        .select('id, status')

      if (error) throw error
      return NextResponse.json({ success: true, updated: data?.length ?? 0 })
    }

    return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
