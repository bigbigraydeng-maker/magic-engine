/**
 * POST /api/admin/conversions/ai-auto-review-run —— 手动触发一轮 AI 全自动审核
 * （PM 拍板 2026-09-15："成交审核换成 AI 直接判断，不要人再点一下"）。
 *
 * 🟢 **这条路由依然是手动入口，但现在不是唯一入口了（2026-09-15 更新）**：
 * `src/lib/inngest/functions/conversion-daily-pipeline.ts` 每天 06:00 Pacific/Auckland
 * 也会调同一个 `runAiAutoReviewForClient()`——PM 看到一次干净的手动试跑结果后拍板
 * 接了定时，详见 `ai-auto-review-run.ts` 文件头。这条手动路由继续留着，用于需要
 * 立刻手动补跑（不想等到明天 06:00）的场景，两条路径并存、互不冲突（都走同一套
 * 开关 + 熔断 + CAS 幂等）。
 *
 * 🔴 鉴权分两种情况，不能都用 `guardAdmin`（魏征最终复审 BLOCKER：这一步会真实
 * 触发对外发送，权限级别必须跟"审核/发送成交记录"那几个既有接口对齐，不能各自
 * 决定——2026-08-04 的教训是受限管理员照样能通过 `guardAdmin`，middleware 不管
 * `/api/*`）：
 *   · 传了 `clientId`（只跑一个客户）—— 用 `guardConversionRoute`：受限管理员
 *     只能碰自己被指定的那个客户，跟人工审核 `outcomes/[id]/review` 同一个级别。
 *   · 没传 `clientId`（一次跑遍所有开了这个开关的客户）—— 这是"影响多个客户"的
 *     操作，必须用 `guardGlobalAdmin`：受限管理员一律拒，不能靠"不传 clientId"
 *     绕过 `assertClientScope` 的检查（`guardConversionRoute` 在 clientId 为
 *     null 时本来就不会做客户级校验，这个入口不能依赖它兜底跨客户场景）。
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardGlobalAdmin } from '@/lib/auth/require-admin'
import { guardConversionRoute } from '@/lib/conversions/route-guard'
import { runAiAutoReviewForClient, type RunSummary } from '@/lib/conversions/ai-auto-review-run'
import { metaCapiWriter } from '@/lib/meta/capi/writer'

export const dynamic = 'force-dynamic'

interface Body {
  /** 只跑这一个客户；不传就跑所有开了 `ai_auto_review_enabled` 的客户。 */
  clientId?: unknown
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    body = {}
  }
  const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : ''

  let clientIds: string[]
  if (clientId) {
    const g = await guardConversionRoute(request, clientId)
    if (!g.ok) return g.response
    clientIds = [clientId]
  } else {
    const guard = await guardGlobalAdmin()
    if (guard) return guard

    const { data, error } = await supabaseAdmin
      .from('clients')
      .select('id')
      .eq('ai_auto_review_enabled', true)
    if (error) return NextResponse.json({ error: `读取客户列表失败：${error.message}` }, { status: 500 })
    clientIds = ((data ?? []) as { id: string }[]).map((c) => c.id)
  }

  const results: Record<string, RunSummary> = {}
  for (const id of clientIds) {
    try {
      results[id] = await runAiAutoReviewForClient(id, {
        supabase: supabaseAdmin,
        sendDeps: { writer: metaCapiWriter, fetcher: fetch },
      })
    } catch (e) {
      results[id] = { ran: false, reason: 'error', detail: e instanceof Error ? e.message : String(e) }
    }
  }

  return NextResponse.json({ results })
}
