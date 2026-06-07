import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { Resend } from 'resend'
import { startCronRun } from '@/lib/cron/run-logger'

const TO_EMAIL = 'raydeng@magicengine.com.au'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronRun = await startCronRun('daily-cron-digest')

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data: runs, error } = await supabaseAdmin
    .from('cron_run_logs')
    .select('job_name, status, started_at, finished_at, duration_ms, processed, completed_count, failed_count, error_message')
    .gte('started_at', since)
    .order('started_at', { ascending: false })

  if (error) {
    await cronRun.finish({ failed: 1, error: error.message })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const failedRuns = (runs ?? []).filter(r => (r.failed_count ?? 0) > 0 || r.status === 'failed')

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

  // Build clean email — no client_ids, no raw error strings longer than 200 chars
  const rows = failedRuns.map(r => `
    <tr>
      <td style="padding:8px 12px;font-family:monospace;font-size:13px;border-bottom:1px solid #e2e8f0">${r.job_name}</td>
      <td style="padding:8px 12px;font-size:13px;border-bottom:1px solid #e2e8f0">${new Date(r.started_at).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', hour12: false })}</td>
      <td style="padding:8px 12px;font-size:13px;color:#dc2626;font-weight:600;border-bottom:1px solid #e2e8f0">${r.failed_count ?? 0} failed</td>
      <td style="padding:8px 12px;font-size:12px;color:#6b7280;border-bottom:1px solid #e2e8f0">${(r.error_message ?? '').substring(0, 200) || '—'}</td>
    </tr>
  `).join('')

  const html = `
    <div style="font-family:sans-serif;max-width:700px;margin:0 auto;padding:24px">
      <h2 style="margin:0 0 8px;font-size:18px;color:#0f172a">⚠ Cron Job Failures — Last 24 Hours</h2>
      <p style="margin:0 0 20px;font-size:14px;color:#64748b">
        ${failedRuns.length} job run(s) reported failures. Check Render logs for full details.
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
    from: 'Magic Engine Monitor <onboarding@resend.dev>',
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
    summary: { email_sent: true, failed_jobs: failedRuns.length },
  })

  return NextResponse.json({
    sent: true,
    failed_jobs: failedRuns.length,
    total_runs_checked: runs?.length ?? 0,
  })
}
