/**
 * GET /api/cron/kpi-backfill
 *
 * SEMrush KPI 自动回填 cron — P8.12.S2.3
 *
 * 每天（或每周）运行，对所有已批准且存在案例记录的处方：
 *   1. 检查距批准是否到达 30 / 60 / 90 天节点（±7 天窗口）
 *   2. 若到达且未录入，则拉取 SEMrush getDomainMetrics() 写入 prescription_outcomes
 *
 * Auth: Bearer ${CRON_SECRET}
 * Reference: ROADMAP.md P8.12.S2.3
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { backfillSemrushKpisForPrescription, type BackfillResult } from '@/lib/case-library/outcome-recorder'
import { startCronRun } from '@/lib/cron/run-logger'

// Allow up to 5 min for a full cron run across all clients
export const maxDuration = 300

// ── Types for the join query ──────────────────────────────────────────────────

interface PrescriptionRow {
  prescription_id: string
  approved_at: string
  client_id: string
  case_id: string
  domain: string | null
  semrush_db: string | null
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'Server misconfiguration: CRON_SECRET not set' },
      { status: 500 },
    )
  }

  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronRun = await startCronRun('kpi-backfill')

  // ── Fetch approved prescriptions that have a case record ──────────────────
  // JOIN: prescriptions → prescription_cases → clients
  const { data: rows, error: queryErr } = await supabaseAdmin
    .from('prescription_cases')
    .select(`
      id,
      prescription_id,
      client_id,
      prescriptions!inner(approved_at, status),
      clients!inner(domain, semrush_db)
    `)
    .eq('prescriptions.status', 'approved')
    .not('prescriptions.approved_at', 'is', null)

  if (queryErr) {
    await cronRun.finish({ failed: 1, error: queryErr.message })
    return NextResponse.json(
      { error: `Failed to load prescriptions: ${queryErr.message}` },
      { status: 500 },
    )
  }

  if (!rows || rows.length === 0) {
    await cronRun.finish({ processed: 0, completed: 0, failed: 0 })
    return NextResponse.json({
      success: true,
      message: 'No approved prescriptions with cases found',
      prescriptions_processed: 0,
      outcomes_written: 0,
    })
  }

  // Normalize rows from the join
  const prescriptions: PrescriptionRow[] = (rows as Array<Record<string, unknown>>).map(row => {
    const presc = row['prescriptions'] as Record<string, unknown> | null
    const client = row['clients'] as Record<string, unknown> | null
    return {
      prescription_id: row['prescription_id'] as string,
      approved_at:     (presc?.['approved_at'] as string) ?? '',
      client_id:       row['client_id'] as string,
      case_id:         row['id'] as string,
      domain:          (client?.['domain'] as string | null) ?? null,
      semrush_db:      (client?.['semrush_db'] as string | null) ?? null,
    }
  }).filter(r => r.approved_at && r.domain)

  // ── Process each prescription sequentially to avoid SEMrush rate limits ──
  const results: BackfillResult[] = []

  for (const p of prescriptions) {
    const result = await backfillSemrushKpisForPrescription(
      supabaseAdmin,
      p.prescription_id,
      p.case_id,
      p.client_id,
      p.approved_at,
      p.domain!,
      p.semrush_db ?? undefined,
    )
    results.push(result)
  }

  const totalWritten = results.reduce((s, r) => s + r.outcomesWritten, 0)
  const totalSkipped = results.reduce((s, r) => s + r.skipped, 0)
  const errors = results.filter(r => r.error).map(r => ({
    prescription_id: r.prescriptionId,
    error: r.error,
  }))

  await cronRun.finish({
    processed: prescriptions.length,
    completed: prescriptions.length - errors.length,
    failed: errors.length,
    summary: { outcomes_written: totalWritten, outcomes_skipped: totalSkipped },
  })
  return NextResponse.json({
    success: true,
    prescriptions_processed: prescriptions.length,
    outcomes_written: totalWritten,
    outcomes_skipped: totalSkipped,
    errors,
    results,
  })
}
