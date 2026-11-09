import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { supabaseAdmin } from '@/lib/supabase'
import { startCronRun } from '@/lib/cron/run-logger'
import { meMailFrom, ME_MAIL_TO_ADDRESS } from '@/lib/email/sender'
import { gatherWeeklyReport, renderWeeklyReport, type WeeklyNotices } from '@/lib/weekly-report/build'
import { loadManualItems } from '@/lib/pm-todo/manual-items'
import { laneOf } from '@/lib/pm-todo/five-kinds'

/**
 * GET /api/cron/weekly-seo-report (22.E.S18)
 *
 * Sunday 18:30 UTC = Monday ~06:30 NZST — the PM's weekly watchdog report:
 * per focus client, rankings/auto-changes/blog/social/ads, every section
 * stamped with data freshness (stale data says 断流, never plays fresh).
 * Lands ~30 min before Monday's daily to-do email.
 *
 * Auth: Bearer ${CRON_SECRET}
 */

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
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

  const cronRun = await startCronRun('weekly-seo-report')

  try {
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      await cronRun.finish({ failed: 1, error: 'RESEND_API_KEY not configured' })
      return NextResponse.json({ error: 'Email not configured' }, { status: 503 })
    }

    const now = new Date()
    const nzDateLabel = now.toLocaleDateString('en-NZ', {
      timeZone: 'Pacific/Auckland',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
    // 知会从今日待办挪到这里（PM 2026-09-26）。读挂了不拖垮整封周报，但要在周报里说出来。
    // 跟客户数据并行取：网关大约 125 秒就断（PITFALLS F10），两段串着跑会逼近上限。
    const [clients, notices] = await Promise.all([
      gatherWeeklyReport(supabaseAdmin, now),
      loadManualItems(supabaseAdmin, now)
        .then((items): WeeklyNotices => ({
          rows: items
            .filter((m) => laneOf(m) === 'weekly')
            .map((m) => ({ client_name: m.client_name, what: m.what, how: m.how, href: m.href })),
        }))
        .catch((err: unknown): WeeklyNotices => ({ error: err instanceof Error ? err.message : String(err) })),
    ])
    const email = renderWeeklyReport(clients, nzDateLabel, notices)

    const resend = new Resend(apiKey)
    const { error: sendError } = await resend.emails.send({
      from: meMailFrom('Magic Engine 周报'),
      to: [ME_MAIL_TO_ADDRESS],
      subject: email.subject,
      html: email.html,
    })
    if (sendError) throw new Error(`Resend error: ${String(sendError)}`)

    await cronRun.finish({
      processed: clients.length,
      completed: 1,
      summary: {
        sent: true,
        clients: clients.map((c) => ({
          name: c.name,
          page1: c.seo.page1_now,
          stale_sections: [
            ...(c.seo.freshness.stale ? ['seo'] : []),
            ...(c.social.freshness.stale ? ['social'] : []),
            ...(c.ads.freshness.stale ? ['ads'] : []),
          ],
        })),
      },
    })

    return NextResponse.json({ sent: true, clients: clients.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await cronRun.finish({ failed: 1, error: message })
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
