import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { supabaseAdmin } from '@/lib/supabase'
import { startCronRun } from '@/lib/cron/run-logger'
import { meMailFrom, ME_MAIL_TO_ADDRESS } from '@/lib/email/sender'
import { loadTodoCounts, buildTodoEmail, nzWeekday } from '@/lib/pm-todo/daily-todo'
import { openFactoryWinnerRounds } from '@/lib/pm-todo/factory-winner-items'

/**
 * GET /api/cron/pm-daily-todo (22.E.S18 前置)
 *
 * NZ weekday mornings — the PM's rolling to-do email: today's pillar theme
 * plus live counts of drafts/findings/cards awaiting him. Always sends on
 * weekdays (a quiet day gets a one-line all-clear); never on NZ weekends.
 *
 * Complements daily-cron-digest (failure-only alert): this one is the
 * management rhythm, that one is the fire alarm.
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

  const cronRun = await startCronRun('pm-daily-todo')

  try {
    const now = new Date()
    const weekday = nzWeekday(now)

    // Guard: cron schedule is UTC-based; skip if it lands on an NZ weekend.
    if (weekday === 0 || weekday === 6) {
      await cronRun.finish({ processed: 0, completed: 1, summary: { skipped: 'nz_weekend' } })
      return NextResponse.json({ sent: false, reason: 'NZ weekend' })
    }

    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      await cronRun.finish({ failed: 1, error: 'RESEND_API_KEY not configured' })
      return NextResponse.json({ error: 'Email not configured' }, { status: 503 })
    }

    // 广告赢家待办：先把今天该开的新一轮写进推送记录，再读待办（读路径只读不写）。
    // 写失败的那条今天不出现；整步挂了也不挡邮件，只在运行记录里留一笔。
    const winnerRounds = await openFactoryWinnerRounds(supabaseAdmin, now).catch((e: unknown) => ({
      opened: [] as string[],
      failed: [{ winner_id: '*', error: e instanceof Error ? e.message : String(e) }],
    }))
    if (winnerRounds.failed.length > 0) console.error('[pm-daily-todo] 赢家待办开轮失败:', winnerRounds.failed)

    const counts = await loadTodoCounts(supabaseAdmin)
    const nzDateLabel = now.toLocaleDateString('en-NZ', {
      timeZone: 'Pacific/Auckland',
      day: 'numeric',
      month: 'short',
    })
    const email = buildTodoEmail(weekday, counts, nzDateLabel)

    const resend = new Resend(apiKey)
    const { error: sendError } = await resend.emails.send({
      from: meMailFrom('Magic Engine 今日待办'),
      to: [ME_MAIL_TO_ADDRESS],
      subject: email.subject,
      html: email.html,
    })

    if (sendError) {
      throw new Error(`Resend error: ${String(sendError)}`)
    }

    await cronRun.finish({
      processed: 1,
      completed: 1,
      summary: {
        sent: true,
        total_items: email.totalItems,
        weekday,
        winner_rounds_opened: winnerRounds.opened.length,
        winner_rounds_failed: winnerRounds.failed.length,
      },
    })

    return NextResponse.json({ sent: true, total_items: email.totalItems })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await cronRun.finish({ failed: 1, error: message })
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
