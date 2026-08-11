import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { enqueueRenderJob } from '@/lib/factory/render-queue'

export const dynamic = 'force-dynamic'

// PATCH /api/clients/[id]/content-factory/[postId]
// body: { action: 'confirm' | 'reject' }
// 选题段的确认/打回：confirm → approved(进备料段)，reject → rejected(留选题段)
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; postId: string } },
) {
  // 鉴权闸（2026-08-05 狄仁杰复审）：这条路由原来**完全没有任何登录校验**，
  // 而中间件的 matcher 只覆盖 /dashboard 和 /portal，不管 /api。
  // 实测：匿名 curl 带一个 client_id 就能拿到该客户的内容流水线（CTS 返回 30KB）。
  const __access = await requireDashboardClientAccess(params.id)
  if (!__access.ok) {
    return NextResponse.json({ error: __access.error }, { status: __access.status })
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { action?: string }
    const status =
      body.action === 'confirm' ? 'approved'    // 选题：确认做 → 建做片任务
      : body.action === 'reject' ? 'rejected'    // 打回
      : body.action === 'schedule' ? 'scheduled' // 出片：满意 → 去发布
      : null
    if (!status) {
      return NextResponse.json({ error: "action 必须是 'confirm' / 'reject' / 'schedule'" }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('content_posts')
      .update({ status })
      .eq('client_id', params.id)   // 双重限定，防越权改到别客户
      .eq('id', params.postId)
      .select('id, status, format')
      .single()

    if (error) throw error
    if (!data) return NextResponse.json({ error: '未找到该内容' }, { status: 404 })

    // 讲课式不在这里排做片——要先在单讲工作台选制作方式/传录像，直接排必失败(魏征 m2)
    if (body.action === 'confirm' && data.format === '讲课式') {
      return NextResponse.json({ post: data, render: { jobId: null, created: false, reason: '讲课式内容请进该讲的工作台开始做片' } })
    }

    // 确认 = 建做片任务(流水线入口)。best-effort：建任务失败不回滚确认，只回报。
    let render: { jobId: string | null; created: boolean; reason?: string; error?: string } | undefined
    if (body.action === 'confirm') {
      try {
        render = await enqueueRenderJob({ clientId: params.id, contentPostId: params.postId })
      } catch (e) {
        render = { jobId: null, created: false, error: e instanceof Error ? e.message : String(e) }
      }
    }

    return NextResponse.json({ post: data, render })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
