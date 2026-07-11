// P21.J M2 — factory-review-sweeper cron(*/10,spec §7.2)
// 三方向:①rendered 工单 → Airtable 审核卡(转 in_review)
//        ②审核动作回流(通过/打回·画面质量/打回·预算不对,白名单 fail-closed + 回执)
//        ③Winner Intake 表单 → winner_structures(entry_channel=manual_intake)
// Auth: CRON_SECRET bearer(同全部 ME crons)。逐条 try/catch,单条失败不拖垮整轮。

import { NextRequest, NextResponse } from 'next/server'
import {
  pullReviewActions,
  pullWinnerIntake,
  pushRenderedToAirtable,
} from '@/lib/factory/review-sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const push = await pushRenderedToAirtable()
    const pull = await pullReviewActions()
    const intake = await pullWinnerIntake()

    const errors = [...push.errors, ...pull.errors, ...intake.errors]
    if (errors.length > 0) {
      console.error(`[factory-review-sweeper] ${errors.length} errors: ${errors.join(' | ')}`)
    }
    return NextResponse.json({
      ok: true,
      pushed: push.pushed,
      approved: pull.approved,
      rejected: pull.rejected,
      budget_updated: pull.budgetUpdated,
      refused: pull.refused,
      winner_imported: intake.imported,
      winner_failed: intake.failed,
      errors,
    })
  } catch (err) {
    // AIRTABLE_API_KEY 缺失等整体性故障:fail loud,cron 监控可见
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[factory-review-sweeper] fatal: ${msg}`)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
