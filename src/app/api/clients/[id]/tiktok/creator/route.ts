import { inspectTikTokVideo } from '@/lib/tiktok/video-proof'
import { loadLecturePost } from '@/lib/factory/lecture-post'
import { NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { getTikTokCreatorInfo, humanTikTokError } from '@/lib/factory/publish/tiktok-adapter'
export const dynamic = 'force-dynamic'
export const maxDuration = 120
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  try {
    const postId = new URL(_req.url).searchParams.get('post_id')
    if (!postId) return NextResponse.json({ error:'请选择成片' },{status:400})
    const loaded = await loadLecturePost(params.id, postId)
    if (!loaded?.post.source_video_url) return NextResponse.json({ error:'未找到此客户的成片' },{status:404})
    const creator = await getTikTokCreatorInfo(params.id)
    const videoProof = await inspectTikTokVideo(loaded.post.source_video_url)
    return NextResponse.json({...creator,videoProof}, { headers: { 'Cache-Control': 'no-store' } }) }
  catch (e) { return NextResponse.json({ error: humanTikTokError(e instanceof Error ? e.message : '') }, { status: 400 }) }
}
