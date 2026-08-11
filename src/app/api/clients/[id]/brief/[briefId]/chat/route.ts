import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { NextRequest, NextResponse } from 'next/server'
import { refineBrief } from '@/lib/brief/refine'
import type { BriefRefineRequest } from '@/types/magic-engine'

/**
 * POST /api/clients/[id]/brief/[briefId]/chat
 *
 * Claude refinement endpoint. User sends a natural language request;
 * Claude returns a patch with only the changed fields.
 *
 * Body: BriefRefineRequest
 * {
 *   message: string
 *   history: BriefChatMessage[]
 * }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; briefId: string } }
) {
  // 鉴权闸（2026-08-05 狄仁杰复审）：这条路由原来**完全没有任何登录校验**，
  // 而中间件的 matcher 只覆盖 /dashboard 和 /portal，不管 /api。
  // 实测：匿名 curl 带一个 client_id 就能拿到该客户的内容流水线（CTS 返回 30KB）。
  const __access = await requireDashboardClientAccess(params.id)
  if (!__access.ok) {
    return NextResponse.json({ error: __access.error }, { status: __access.status })
  }

  try {
    const body = (await req.json()) as Partial<BriefRefineRequest>

    if (!body.message?.trim()) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 })
    }

    const result = await refineBrief({
      briefId: params.briefId,
      message: body.message.trim(),
      history: body.history ?? [],
    })

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      reasoning: result.reasoning,
      patch: result.patch,
      brief: result.updatedBrief,
      cost_usd: result.costUsd,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
