/**
 * POST /api/clients/[id]/memory/extract
 *
 * Phase 23.C — FDE 手动触发单客户的 L3 记忆抽取器。
 * 用途：在客户飞轮跑过几个 outcomes 后，FDE 想立即看到自动生成的 patterns /
 * preferences，不用等每日 cron。
 *
 * Body: {} （无 payload — clientId 已在 URL 中）
 *
 * Responses:
 *   200  { success: true, result: ExtractorResult }
 *   401/403  鉴权失败
 *   500  抽取器崩溃
 *
 * Reference: ROADMAP.md Phase 23.C
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { runExtractorForClient } from '@/lib/memory'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params

  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
    const result = await runExtractorForClient(supabaseAdmin, clientId)
    return NextResponse.json({ success: true, result })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[memory/extract] error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
