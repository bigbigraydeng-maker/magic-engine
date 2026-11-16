/**
 * Leads → client Google Sheets without Inngest. Knocked at minute 50 every hour by cron-dispatch-frequent
 * (in-process). Logic and switch: lib/lead-sheets/direct-run.ts. Per-client receipts → cron_run_logs 'lead-sheet-sync'
 * (same rows the Inngest path writes, marked runner: dispatcher).
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { cronRunHandle, startCronRunId } from '@/lib/cron/run-logger'
import { loadRoutedClientIds } from '@/lib/lead-sheets/config'
import { syncClientLeadSheets } from '@/lib/lead-sheets/sync'
import { runDirectLeadSheetSync } from '@/lib/lead-sheets/direct-run'
import { directFallbackEnabled } from '@/lib/telephony/direct-sweep'
import { LEAD_SHEET_JOB } from '@/lib/pm-todo/lead-sheet-items'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!directFallbackEnabled(process.env)) return NextResponse.json({ status: 'off' })

  const receipt = await runDirectLeadSheetSync({
    loadClientIds: () => loadRoutedClientIds(supabaseAdmin),
    async loadClientName(id) {
      const { data } = await supabaseAdmin.from('clients').select('name').eq('id', id).maybeSingle<{ name: string | null }>()
      return data?.name ?? null
    },
    sync: (client) => syncClientLeadSheets(supabaseAdmin, client),
    async logClient(r, startedAt) {
      const runId = await startCronRunId(LEAD_SHEET_JOB)
      const failedRoutes = r.routes.filter((x) => x.error)
      const error = [r.error, ...failedRoutes.map((x) => `${x.routeKey}: ${x.error}`)].filter(Boolean).join(' | ')
      await cronRunHandle(LEAD_SHEET_JOB, runId, startedAt).finish({
        processed: r.routes.length,
        completed: r.routes.length - failedRoutes.length,
        failed: failedRoutes.length + (r.error ? 1 : 0),
        summary: { appended: r.routes.reduce((n, x) => n + x.appended, 0), results: [r], runner: 'dispatcher' },
        ...(error ? { error } : {}),
      })
    },
  })

  if (receipt.status === 'roster_failed') {
    const runId = await startCronRunId(LEAD_SHEET_JOB)
    await cronRunHandle(LEAD_SHEET_JOB, runId, Date.now()).finish({
      processed: 0,
      completed: 0,
      failed: 1,
      summary: { results: [], runner: 'dispatcher' },
      error: `派单失败，这一轮一个客户都没同步：${receipt.error}`,
    })
    return NextResponse.json(receipt, { status: 500 })
  }
  return NextResponse.json(receipt)
}
