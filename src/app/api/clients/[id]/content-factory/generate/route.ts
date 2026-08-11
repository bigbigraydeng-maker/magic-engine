import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateCandidate, type ViralRef } from '@/lib/content-factory/topic-agent'

export const dynamic = 'force-dynamic'
export const maxDuration = 120  // 走一次 Claude 改写，给足时间

// POST /api/clients/[id]/content-factory/generate
// body: { viral: ViralRef }
// 选题助理：把一条爆款按客户人设改写成候选 → 写进 content_posts(status='draft' = 看板"选题"段)
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  // 鉴权闸（2026-08-05 狄仁杰复审）：这条路由原来**完全没有任何登录校验**，
  // 而中间件的 matcher 只覆盖 /dashboard 和 /portal，不管 /api。
  // 实测：匿名 curl 带一个 client_id 就能拿到该客户的内容流水线（CTS 返回 30KB）。
  const __access = await requireDashboardClientAccess(params.id)
  if (!__access.ok) {
    return NextResponse.json({ error: __access.error }, { status: __access.status })
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { viral?: ViralRef }
    const viral = body.viral
    if (!viral?.title || !viral?.transcript) {
      return NextResponse.json(
        { error: 'viral.title 和 viral.transcript 必填' },
        { status: 400 },
      )
    }

    const candidate = await generateCandidate(params.id, viral)

    const { data, error } = await supabaseAdmin
      .from('content_posts')
      .insert({
        client_id: params.id,
        title:      candidate.title,
        script:     candidate.script,   // 完整逐字稿 → 详情抽屉展示
        caption:    candidate.hook,     // 前3秒钩子 → 卡片摘要
        pillar_id:  candidate.pillar,
        platforms:  candidate.platforms ?? [],
        status:     'draft',            // 看板"选题"段
        route:      'route_a',          // route NOT NULL
        source:     candidate.source,   // 溯源：抄自哪条爆款
      })
      .select('id, title, status')
      .single()

    if (error) throw error

    return NextResponse.json({ post: data, candidate })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
