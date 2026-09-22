/**
 * POST /api/admin/conversions/nal-messenger-sync —— 手动跑一次 NAL 私信同步
 * （承接 CTS CAPI 项目，2026-09-15）。
 *
 * PM 拍板先人工试跑：这一轮**只能手动触发**，不接 cron/Inngest（详见
 * `src/lib/conversions/nal-messenger-lead-sync-run.ts` 顶部说明）。
 *
 * 用 guardGlobalAdmin 而不是 guardAdmin —— 这不是编辑一条记录，是一次性读一批
 * 客户私信内容并批量写库，风险面比单条操作大一圈，收紧到全局管理员。
 *
 * 写进去的行一律 `pending_review`，`clients.conversion_stage` 默认 `dry_run`：
 * 这个接口本身**不会**把任何东西真的发给 Meta。
 */

import { NextResponse } from 'next/server'
import { guardGlobalAdmin } from '@/lib/auth/require-admin'
import { runNalMessengerLeadSync } from '@/lib/conversions/nal-messenger-lead-sync-run'

export const dynamic = 'force-dynamic'

export async function POST() {
  const guard = await guardGlobalAdmin()
  if (guard) return guard

  try {
    const summary = await runNalMessengerLeadSync()
    return NextResponse.json({ summary })
  } catch (err) {
    return NextResponse.json(
      { error: `同步失败: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    )
  }
}
