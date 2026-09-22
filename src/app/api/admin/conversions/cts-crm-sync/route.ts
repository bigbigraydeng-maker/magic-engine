/**
 * POST /api/admin/conversions/cts-crm-sync —— 手动跑一次 CTS CRM 表格同步
 * （Issue #1397 CAPI 续，2026-09-13）。
 *
 * PM 拍板先人工试跑：这一轮**只能手动触发**，不接 cron/Inngest（详见
 * `src/lib/conversions/cts-crm-sheet-sync-run.ts` 顶部说明）。
 *
 * 用 guardGlobalAdmin 而不是 guardAdmin —— 这不是编辑一条记录，是一次性读
 * 几百条客户 PII 并批量写库，风险面比单条操作大一圈，收紧到全局管理员。
 *
 * 写进去的行一律 `pending_review`，`clients.conversion_stage` 默认
 * `dry_run`：这个接口本身**不会**把任何东西真的发给 Meta。
 */

import { NextResponse } from 'next/server'
import { guardGlobalAdmin } from '@/lib/auth/require-admin'
import { runCtsCrmSync } from '@/lib/conversions/cts-crm-sheet-sync-run'

export const dynamic = 'force-dynamic'

export async function POST() {
  const guard = await guardGlobalAdmin()
  if (guard) return guard

  try {
    const summary = await runCtsCrmSync()
    return NextResponse.json({ summary })
  } catch (err) {
    return NextResponse.json(
      { error: `同步失败: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    )
  }
}
