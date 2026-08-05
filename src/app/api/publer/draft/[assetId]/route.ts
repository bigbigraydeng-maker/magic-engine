import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAccounts } from '@/lib/publer/client'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

// GET /api/publer/draft/[assetId]
// 返回 Publer 弹窗所需的所有数据：caption、hashtags、账号列表
export async function GET(
  _req: NextRequest,
  { params }: { params: { assetId: string } }
) {
  try {
    const [{ data: asset }, accounts] = await Promise.all([
      supabaseAdmin
        .from('visual_assets')
        .select('id, asset_type, generation_status, post_id, client_id')
        .eq('id', params.assetId)
        .single(),
      getAccounts(),
    ])

    if (!asset) return NextResponse.json({ error: 'Asset not found' }, { status: 404 })

    // 这条路会吐出该客户的贴文正文 + 全部 Publer 账号列表,一直没鉴权。
    // 跟 /api/publer/schedule 同一个口径:客户身份由素材自己的 client_id 决定。
    const access = await requireDashboardClientAccess(asset.client_id)
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }

    let caption = ''
    let hashtags = ''
    if (asset.post_id) {
      const { data: post } = await supabaseAdmin
        .from('content_posts')
        .select('caption, hashtags')
        .eq('id', asset.post_id)
        .single()
      caption = post?.caption ?? ''
      hashtags = post?.hashtags ?? ''
    }

    return NextResponse.json({ caption, hashtags, accounts })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
