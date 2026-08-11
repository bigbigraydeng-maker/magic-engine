import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { NextRequest, NextResponse } from 'next/server'
import { runIntakeForClient } from '@/lib/content-factory/intake-runner'

export const dynamic = 'force-dynamic'
export const maxDuration = 300  // Apify 抓取 + 多次 Claude 改写，给满

// POST /api/clients/[id]/content-factory/run-intake
// 手动跑一次进料：读配置 → Apify 抓小红书/抖音 → 选题助理改写 → 写 content_posts。
// cron 也调这条逻辑(runIntakeForClient)。
export async function POST(
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
    const result = await runIntakeForClient(params.id)
    return NextResponse.json(result)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
