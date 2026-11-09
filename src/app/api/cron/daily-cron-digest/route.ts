import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { Resend } from 'resend'
import { startCronRun } from '@/lib/cron/run-logger'
import { meMailFrom, ME_MAIL_TO_ADDRESS } from '@/lib/email/sender'
import { failureCell, isAbandonedDigestRow, isDigestFailure, summaryFailureDetail } from '@/lib/cron/digest-cells'
import { failureSignature } from '@/lib/cron/failure-signature'
import { reconcile } from '@/lib/todo-reconciliation/reconcile'
import type { RawWorkItem } from '@/lib/todo-reconciliation/types'

const TO_EMAIL = ME_MAIL_TO_ADDRESS

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronRun = await startCronRun('daily-cron-digest')

  const now = new Date()
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()

  const { data: runs, error } = await supabaseAdmin
    .from('cron_run_logs')
    // `summary` 是新加的：一大类任务压根不写 error_message，客户级明细
    // （比如 questions_failed: 47）全在这一坨 JSON 里，不取就永远渲染不出来。
    .select('job_name, status, started_at, finished_at, duration_ms, processed, completed_count, failed_count, error_message, summary')
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    // PostgREST 不给 limit 时默认只回 1000 行且**不报错**（PITFALLS F9）。
    // 撞线时按 started_at 降序会静默丢掉最老的那批 —— 而卡死行按定义就是老行。
    .limit(2000)

  if (error) {
    await cronRun.finish({ failed: 1, error: error.message })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // 判据抽在 digest-cells.ts 里（`isDigestFailure`），那边有直接的断言覆盖。
  // 它比原来多接住一类：停在 `running` 的行 —— 原筛选两边都接不住它。
  const failedRuns = (runs ?? []).filter((r) => isDigestFailure(r, now))
  const abandonedCount = (runs ?? []).filter((r) => isAbandonedDigestRow(r)).length

  // Only send email if there are failures
  if (failedRuns.length === 0) {
    await cronRun.finish({ processed: runs?.length ?? 0, completed: 1, failed: 0, summary: { all_healthy: true } })
    return NextResponse.json({ sent: false, reason: 'No failures in last 24h', total_runs: runs?.length ?? 0 })
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    await cronRun.finish({ failed: 1, error: 'RESEND_API_KEY not configured' })
    return NextResponse.json({ error: 'Email not configured' }, { status: 503 })
  }

  const resend = new Resend(apiKey)

  // ── 降噪：同一个任务、同一个原因的 N 次失败收成一行 ──────────────────────
  // 2026-09-22 那封邮件 80 行，其中 prospecting-sweep 一家 25 行（31%，它因为
  // Google 地图账单没开已经连挂 505 次）、messenger-sync-hourly 24 行 ——
  // 真告警就是这么被淹死的。
  //
  // 收敛用的是**已有**的 `reconcile()`（src/lib/todo-reconciliation/reconcile.ts）：
  // 它的文件头逐字写着「48 repeated failures of the same cron job become one
  // reviewable line」，`RawWorkItemSource` 里本来就有 'cron_failure'，
  // 只是一直只接在一个喂静态假数据的预览接口上。这里是它第一个真实调用方。
  // 不自己另写一套收敛，是因为两套口径会给出两个不同的「今天有几件事」，
  // 而这个计数口径已经翻过两次车（见 src/lib/pm-todo/five-kinds.ts 头注）。
  const repFor = new Map<string, typeof failedRuns[number]>()
  const rawItems: RawWorkItem[] = failedRuns.map((r) => {
    const detail = (r.error_message ?? '').trim() || summaryFailureDetail(r.summary)
    // 签名为空（既没有错误信息也没有可数明细）时退回用状态分组 ——
    // 不要把所有空错误合成一条，那在不同任务上是完全不同的事。
    const key = `${r.job_name}::${failureSignature(detail) || r.status || 'unknown'}`
    if (!repFor.has(key)) repFor.set(key, r)
    return {
      id: `${r.job_name}@${r.started_at}`,
      source: 'cron_failure' as const,
      category: r.job_name,
      clientId: null,
      clientName: null,
      rootCauseKey: key,
      label: r.job_name,
      detail,
      createdAt: r.started_at,
    }
  })

  const clusters = reconcile(rawItems, now.toISOString()).unresolvedClusters
    // 次数多的排前面：一个长期故障从 2 次/天恶化到 200 次/天时，
    // 它会自动冒到最上面，而不是因为「是老问题」被压在看不见的底部（魏征复审）。
    .slice()
    .sort((a, b) => b.occurrenceCount - a.occurrenceCount)

  // Build clean email — no client_ids, no raw error strings longer than 200 chars
  const rows = clusters.map(c => {
    const r = repFor.get(c.rootCauseKey)
    if (!r) return ''
    const detail = (r.error_message ?? '').trim() || summaryFailureDetail(r.summary)
    const repeat = c.occurrenceCount > 1 ? ` ×${c.occurrenceCount}` : ''
    return `
    <tr>
      <td style="padding:8px 12px;font-family:monospace;font-size:13px;border-bottom:1px solid #e2e8f0">${r.job_name}${repeat}</td>
      <td style="padding:8px 12px;font-size:13px;border-bottom:1px solid #e2e8f0">${new Date(r.started_at).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', hour12: false })}</td>
      <td style="padding:8px 12px;font-size:13px;color:#dc2626;font-weight:600;border-bottom:1px solid #e2e8f0">${failureCell(r, now)}</td>
      <td style="padding:8px 12px;font-size:12px;color:#6b7280;border-bottom:1px solid #e2e8f0">${detail.substring(0, 200) || '—'}</td>
    </tr>
  `
  }).join('')

  const html = `
    <div style="font-family:sans-serif;max-width:700px;margin:0 auto;padding:24px">
      <h2 style="margin:0 0 8px;font-size:18px;color:#0f172a">⚠ Cron Job Failures — Last 24 Hours</h2>
      <p style="margin:0 0 20px;font-size:14px;color:#64748b">
        ${failedRuns.length} job run(s) reported failures, collapsed into ${clusters.length} distinct problem(s).
        ${abandonedCount > 0 ? ` ${abandonedCount} run(s) were closed as abandoned (still running past twice their expected duration).` : ''}
        Check Render logs for full details.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
        <thead>
          <tr style="background:#f8fafc">
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:#475569;text-transform:uppercase">Job</th>
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:#475569;text-transform:uppercase">Time (NZST)</th>
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:#475569;text-transform:uppercase">Failures</th>
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:#475569;text-transform:uppercase">Error</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top:20px;font-size:12px;color:#94a3b8">
        View the full dashboard: <a href="https://app.magicengine.com.au/dashboard/admin/cron-health" style="color:#d97706">Cron Health</a>
      </p>
    </div>
  `

  const { error: sendError } = await resend.emails.send({
    from: meMailFrom('Magic Engine Monitor'),
    to: [TO_EMAIL],
    subject: `⚠ ${failedRuns.length} cron job failure(s) — ${new Date().toLocaleDateString('en-NZ', { timeZone: 'Pacific/Auckland' })}`,
    html,
  })

  if (sendError) {
    console.error('[daily-cron-digest] Resend error:', sendError)
    await cronRun.finish({ failed: 1, error: String(sendError) })
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
  }

  await cronRun.finish({
    processed: runs?.length ?? 0,
    completed: 1,
    failed: 0,
    summary: { email_sent: true, failed_jobs: failedRuns.length, distinct_problems: clusters.length, abandoned: abandonedCount },
  })

  return NextResponse.json({
    sent: true,
    failed_jobs: failedRuns.length,
    total_runs_checked: runs?.length ?? 0,
  })
}
