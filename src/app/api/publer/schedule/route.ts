import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAccounts, uploadMediaFromUrl, schedulePost } from '@/lib/publer/client'
import { judgeOutgoingPost, priceGateMessage } from '@/lib/content/price-claim-gate'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

// POST /api/publer/schedule
// 手动从 Visuals 页面触发：用指定 asset + 账号 + 时间 发布到 Publer
export async function POST(req: NextRequest) {
  try {
    const { asset_id, account_id, scheduled_at, caption } = await req.json()

    if (!asset_id || !account_id || !scheduled_at) {
      return NextResponse.json({ error: 'asset_id, account_id, scheduled_at are required' }, { status: 400 })
    }

    const { data: asset } = await supabaseAdmin
      .from('visual_assets')
      .select('id, asset_type, generation_status, storage_url, post_id, client_id')
      .eq('id', asset_id)
      .single()

    if (!asset) return NextResponse.json({ error: 'Asset not found' }, { status: 404 })

    // 🔴 这条路会把东西真发到客户的社媒账号上,却一直没有任何鉴权 ——
    // 光靠一个 asset_id 就能拿别人客户的素材去发。鉴权必须在读到 asset 之后做:
    // 该发给谁由**素材自己的 client_id** 决定,不能让调用方传客户身份进来。
    const access = await requireDashboardClientAccess(asset.client_id)
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }

    if (asset.generation_status !== 'ready') {
      return NextResponse.json({ error: 'Asset not ready' }, { status: 400 })
    }
    if (!asset.storage_url) {
      return NextResponse.json({ error: 'Asset has no storage URL' }, { status: 400 })
    }

    const accounts = await getAccounts()
    const account = accounts.find(a => a.id === account_id)
    if (!account) return NextResponse.json({ error: 'Publer account not found' }, { status: 404 })

    let finalCaption = caption ?? ''
    if (!finalCaption && asset.post_id) {
      const { data: post } = await supabaseAdmin
        .from('content_posts')
        .select('caption, hashtags')
        .eq('id', asset.post_id)
        .single()
      const tags = post?.hashtags ? `\n\n${post.hashtags}` : ''
      finalCaption = `${post?.caption ?? ''}${tags}`.trim()
    }

    // 真价只配真画面 —— 这条路直接排期发布，出去就收不回来了。
    const verdict = await judgeOutgoingPost(supabaseAdmin, {
      clientId: asset.client_id,
      caption:  finalCaption,
      imageUrl: asset.storage_url,
    })
    if (verdict.blocked) {
      return NextResponse.json(
        { error: priceGateMessage(verdict.source), code: 'price_claim_unbacked' },
        { status: 409 },
      )
    }

    const fileName = asset.storage_url.split('/').pop() ?? 'media'
    const media = await uploadMediaFromUrl(asset.storage_url, fileName)

    const result = await schedulePost({
      accountId: account_id,
      provider: account.provider,
      assetType: asset.asset_type,
      media,
      caption: finalCaption,
      scheduledAt: new Date(scheduled_at).toISOString(),
    })

    return NextResponse.json({ success: true, job_id: result.job_id })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[publer/schedule]', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
