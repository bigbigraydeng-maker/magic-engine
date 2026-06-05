import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'

interface ApprovedPostRow {
  id: string
  visual_brief: string | null
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
    const [
      socialDraftRes,
      approvedPostsRes,
      socialScheduledRes,
      socialPublishedRes,
      blogDraftRes,
      blogGeneratingRes,
      execPendingRes,
      execInProgressRes,
    ] = await Promise.all([
      supabaseAdmin
        .from('content_posts')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .eq('status', 'draft'),
      supabaseAdmin
        .from('content_posts')
        .select('id, visual_brief')
        .eq('client_id', clientId)
        .eq('status', 'approved'),
      supabaseAdmin
        .from('content_posts')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .eq('status', 'scheduled'),
      supabaseAdmin
        .from('content_posts')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .eq('status', 'published'),
      supabaseAdmin
        .from('blog_posts')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .eq('status', 'draft'),
      supabaseAdmin
        .from('blog_posts')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .eq('status', 'generating'),
      supabaseAdmin
        .from('execution_items')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .eq('status', 'pending'),
      supabaseAdmin
        .from('execution_items')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .eq('status', 'in_progress'),
    ])

    const approvedPosts = (approvedPostsRes.data ?? []) as ApprovedPostRow[]
    const approvedPostIds = approvedPosts.map(post => post.id)

    let postsWithReadyAssets = new Set<string>()
    if (approvedPostIds.length > 0) {
      const { data: readyAssets, error: assetsErr } = await supabaseAdmin
        .from('visual_assets')
        .select('post_id')
        .in('post_id', approvedPostIds)
        .eq('generation_status', 'ready')
        .not('storage_url', 'is', null)

      if (assetsErr) {
        throw assetsErr
      }

      postsWithReadyAssets = new Set(
        (readyAssets ?? [])
          .map(row => row.post_id)
          .filter((value): value is string => typeof value === 'string')
      )
    }

    const socialNeedsImage = approvedPosts.filter(post => {
      const hasBrief = typeof post.visual_brief === 'string' && post.visual_brief.trim().length > 0
      return hasBrief && !postsWithReadyAssets.has(post.id)
    }).length

    const socialReadyToPublish = approvedPosts.filter(post => postsWithReadyAssets.has(post.id)).length

    return NextResponse.json({
      success: true,
      summary: {
        social: {
          draft: socialDraftRes.count ?? 0,
          needs_image: socialNeedsImage,
          ready_to_publish: socialReadyToPublish,
          scheduled: socialScheduledRes.count ?? 0,
          published: socialPublishedRes.count ?? 0,
        },
        seo: {
          draft: blogDraftRes.count ?? 0,
          generating: blogGeneratingRes.count ?? 0,
        },
        execution: {
          pending: execPendingRes.count ?? 0,
          in_progress: execInProgressRes.count ?? 0,
        },
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[workbench-summary GET]', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
