import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { NextRequest, NextResponse } from 'next/server'
import { chatIntakeConfig } from '@/lib/content-factory/config-agent'
import { getIntakeConfig } from '@/lib/content-factory/intake-config'

export const dynamic = 'force-dynamic'
export const maxDuration = 120  // 带工具的 Claude 对话

// GET /api/clients/[id]/content-factory/config-chat → 返回当前已存配置（重进设置页时预填面板）
export async function GET(
  _req: NextRequest,
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
    const config = await getIntakeConfig(params.id)
    return NextResponse.json({ config })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// POST /api/clients/[id]/content-factory/config-chat
// body: { history: [{role:'user'|'assistant', content}] }
// 配置助理：跟 FDE/客户对话，把选题进料配置存进 clients.factory_config.topic_intake
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
    const body = (await req.json().catch(() => ({}))) as {
      history?: Array<{ role: 'user' | 'assistant'; content: string }>
    }
    const history = Array.isArray(body.history) ? body.history : []
    if (history.length === 0 || history[history.length - 1]?.role !== 'user') {
      return NextResponse.json({ error: 'history 末尾必须是一条 user 消息' }, { status: 400 })
    }

    const result = await chatIntakeConfig(params.id, history)
    return NextResponse.json(result)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
