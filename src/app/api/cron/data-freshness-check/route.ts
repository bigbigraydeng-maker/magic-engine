/**
 * Layer 2 of the "让系统能说出我瞎了" defence — the daily data freshness check.
 *
 * It deliberately ignores whether any cron *ran*. On 2026-08-01 that signal was
 * proven worthless: a Render cron whose CRON_SECRET is unset gets a 401, and the
 * run-logging code sits behind the auth check, so the job leaves no trace at all
 * — not even a failure. keyword-snapshots-weekly was invisible that way for 53
 * days while every dashboard kept showing stale numbers as if they were current.
 *
 * So this route looks only at the product: for every stream in
 * data_freshness_expectations, when did the underlying table last receive a row?
 */

import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { supabaseAdmin } from '@/lib/supabase'
import { startCronRun } from '@/lib/cron/run-logger'
import { meMailFrom, ME_MAIL_TO_ADDRESS } from '@/lib/email/sender'
import { loadFreshnessRegistry, probeStream } from '@/lib/monitoring/freshness-probe'
import {
  decideNotification,
  evaluateFreshness,
  renderFreshnessEmail,
  selectActiveExpectations,
  summarize,
  type FreshnessResult,
  type FreshnessStatus,
  type NotificationDecision,
  type PreviousStreamStatus,
} from '@/lib/monitoring/data-freshness'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const JOB_NAME = 'data-freshness-check'

async function persist(results: FreshnessResult[], checkedOn: string): Promise<void> {
  if (results.length === 0) return

  // Fresh rows are stored too: the history tells you which day something broke,
  // and this table's own heartbeat is what the external check watches.
  const rows = results.map((r) => ({
    checked_on: checkedOn,
    expectation_id: r.expectationId,
    stream_key: r.streamKey,
    label: r.label,
    pillar: r.pillar,
    status: r.status,
    last_written_at: r.lastWrittenAt,
    age_hours: r.ageHours,
    max_age_hours: r.maxAgeHours,
    overdue_hours: r.overdueHours,
    row_count: r.rowCount,
    severity: r.severity,
    probe_error: r.probeError,
  }))

  const { error } = await supabaseAdmin
    .from('data_freshness_alerts')
    .upsert(rows, { onConflict: 'checked_on,stream_key' })

  if (error) throw new Error(`Failed to persist freshness results: ${error.message}`)
}

/**
 * The most recent previous verdict per stream, so the mail can say what CHANGED
 * rather than repeating the same list every morning.
 */
async function loadPreviousStatuses(checkedOn: string): Promise<PreviousStreamStatus[] | null> {
  const { data, error } = await supabaseAdmin
    .from('data_freshness_alerts')
    .select('stream_key, status, checked_on')
    .lt('checked_on', checkedOn)
    .order('checked_on', { ascending: false })
    .limit(500)

  if (error || !data) return null

  const latest = new Map<string, FreshnessStatus>()
  for (const row of data as Array<{ stream_key: string; status: FreshnessStatus }>) {
    if (!latest.has(row.stream_key)) latest.set(row.stream_key, row.status)
  }

  if (latest.size === 0) return null
  return [...latest.entries()].map(([streamKey, status]) => ({ streamKey, status }))
}

async function notify(
  results: FreshnessResult[],
  decision: NotificationDecision,
  now: Date,
): Promise<{ sent: boolean; reason: string }> {
  if (!decision.send) return { sent: false, reason: decision.reason }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return { sent: false, reason: 'RESEND_API_KEY not set' }

  const to = process.env.DATA_FRESHNESS_ALERT_TO || ME_MAIL_TO_ADDRESS
  const { subject, text, html } = renderFreshnessEmail(results, decision, now)

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from: meMailFrom('Magic Engine 数据体检'),
    to: to.split(',').map((addr) => addr.trim()).filter(Boolean),
    subject,
    text,
    html,
  })

  if (error) return { sent: false, reason: error.message }
  return { sent: true, reason: decision.reason }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'Server misconfiguration: CRON_SECRET not set' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronRun = await startCronRun(JOB_NAME)
  const now = new Date()
  const checkedOn = now.toISOString().slice(0, 10)

  try {
    const all = await loadFreshnessRegistry()
    const active = selectActiveExpectations(all, now)

    // An empty registry means this check silently protects nothing — exactly the
    // failure mode we exist to catch, so it is an error, not a quiet success.
    if (active.length === 0) {
      throw new Error('Freshness registry is empty — nothing is being monitored')
    }

    const previous = await loadPreviousStatuses(checkedOn)

    const results: FreshnessResult[] = []
    for (const expectation of active) {
      const observation = await probeStream(expectation)
      results.push(evaluateFreshness(expectation, observation, now))
    }

    await persist(results, checkedOn)

    const summary = summarize(results)
    const decision = decideNotification(results, previous, now)
    const email = await notify(results, decision, now)

    await cronRun.finish({
      processed: results.length,
      completed: summary.fresh,
      failed: summary.broken,
      summary: {
        checkedOn,
        total: summary.total,
        fresh: summary.fresh,
        stale: summary.stale,
        never: summary.never,
        criticalBroken: summary.criticalBroken,
        emailSent: email.sent,
        emailReason: email.reason,
        newlyBroken: decision.newlyBroken.map((r) => r.streamKey),
        recovered: decision.recovered,
        broken: results
          .filter((r) => r.status !== 'fresh')
          .map((r) => ({
            stream: r.streamKey,
            status: r.status,
            ageHours: r.ageHours,
            maxAgeHours: r.maxAgeHours,
          })),
      },
    })

    return NextResponse.json({
      success: true,
      timestamp: now.toISOString(),
      checkedOn,
      summary: {
        total: summary.total,
        fresh: summary.fresh,
        stale: summary.stale,
        never: summary.never,
        criticalBroken: summary.criticalBroken,
      },
      emailSent: email.sent,
      emailReason: email.reason,
      results: results.map((r) => ({
        stream: r.streamKey,
        label: r.label,
        pillar: r.pillar,
        status: r.status,
        lastWrittenAt: r.lastWrittenAt,
        ageHours: r.ageHours,
        maxAgeHours: r.maxAgeHours,
        probeError: r.probeError,
      })),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await cronRun.finish({ failed: 1, error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
