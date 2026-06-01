import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAccounts, uploadMediaFromUrl, schedulePost } from '@/lib/publer/client'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

// POST /api/clients/[id]/reels/[draftId]/publish
// 将 video_ready 状态的 Reel 视频通过 Publer 安排发布
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; draftId: string } }
) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
    const { account_id, scheduled_at, caption: captionOverride } = await req.json()
    if (!account_id || !scheduled_at) {
      return NextResponse.json({ error: 'account_id and scheduled_at are required' }, { status: 400 })
    }

    const { data: draft } = await supabaseAdmin
      .from('reels_drafts')
      .select('id, status, video_url, fb_caption, client_id')
      .eq('id', params.draftId)
      .eq('client_id', params.id)
      .single()

    if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    if (draft.status !== 'video_ready') {
      return NextResponse.json({ error: 'Video is not ready yet' }, { status: 400 })
    }
    if (!draft.video_url) {
      return NextResponse.json({ error: 'No video URL found' }, { status: 400 })
    }

    const accounts = await getAccounts()
    const account = accounts.find((a: { id: string; provider: string }) => a.id === account_id)
    if (!account) return NextResponse.json({ error: 'Publer account not found' }, { status: 404 })

    const fileName = draft.video_url.split('/').pop() ?? 'reel.mp4'
    const media = await uploadMediaFromUrl(draft.video_url, fileName)

    const finalCaption = typeof captionOverride === 'string' ? captionOverride : (draft.fb_caption ?? '')

    const result = await schedulePost({
      accountId: account_id,
      provider: account.provider,
      assetType: 'video',
      media,
      caption: finalCaption,
      scheduledAt: new Date(scheduled_at).toISOString(),
    })

    return NextResponse.json({ success: true, job_id: result.job_id })
  } catch (err: unknown) {
    console.error('[reels/publish]', err)
    return NextResponse.json({ error: 'Failed to schedule post. Please try again.' }, { status: 500 })
  }
}
