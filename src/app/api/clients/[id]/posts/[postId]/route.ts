import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

// PATCH /api/clients/[id]/posts/[postId]
// Persists draft text edits from PostCard / StoryCard (debounced autosave).
// Only updates fields that are explicitly provided in the request body.
// Body: { caption?: string, visual_brief?: string }
// Returns: { success: true }
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; postId: string } }
) {
  try {
    const access = await requireDashboardClientAccess(params.id)
    if (!access.ok) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status })
    }

    const body = (await req.json().catch(() => ({}))) as {
      caption?: string
      visual_brief?: string
    }

    const patch: Record<string, string> = {}
    if (typeof body.caption === 'string')       patch.caption      = body.caption
    if (typeof body.visual_brief === 'string')  patch.visual_brief = body.visual_brief

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ success: true })
    }

    const { error } = await supabaseAdmin
      .from('content_posts')
      .update(patch)
      .eq('id', params.postId)
      .eq('client_id', params.id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[posts/[postId] PATCH]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
