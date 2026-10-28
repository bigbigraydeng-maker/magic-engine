/**
 * 处方周更 —— 复查已经批准、正在执行的方案。
 *
 * 不生成方案，不批准，不落地。只读每份已批准方案做到哪了（阶段、待办、
 * 内容工单、挂在待办上的广告草稿、目标上已经有的数字），写成一段人话和
 * 调整建议，写进这条任务的运行记录。建议不会自动执行。
 * 加预算、减预算只出确认卡，不改预算、不写广告后台。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { createKernel } from '@/lib/kernel'
import {
  PRESCRIPTION_WEEKLY_CHECK_KIND,
  runPrescriptionWeeklyCheck,
} from '@/lib/diagnostic/prescription-weekly-check'
import { attachTuesdayBudgetAmounts } from '@/lib/diagnostic/tuesday-budget-amount'
import { runTuesdayBudgetTune } from '@/lib/diagnostic/tuesday-budget-tune'
import { startCronRun } from '@/lib/cron/run-logger'

export const dynamic = 'force-dynamic'
// 只读库、写一条运行记录，不再串行调用模型。
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const denied = cronDenied(req)
  if (denied) return denied
  if (await overlappingRun()) {
    return NextResponse.json({ ok: true, skipped: '已有一轮在跑，本次跳过' })
  }

  const cronRun = await startCronRun('prescription-weekly')
  try {
    const summary = await runPrescriptionWeeklyCheck(supabaseAdmin)
    const withBudgets = await attachTuesdayBudgetAmounts(supabaseAdmin, summary, new Date())
    const budgetTunes = await runTuesdayBudgetTune(() => createKernel(supabaseAdmin), withBudgets)
    const failed = summary.outcomes.filter((o) => o.result === 'error').length
    await cronRun.finish({
      processed: summary.considered,
      completed: summary.checked,
      failed,
      summary: {
        kind: PRESCRIPTION_WEEKLY_CHECK_KIND,
        note: '本周只复查已经批准、正在执行的方案。没有新开方案，也没有自动批准。加预算和减预算只出确认卡，不会自动改预算。',
        outcomes: withBudgets.outcomes,
        budget_tunes: budgetTunes,
      },
    })
    return NextResponse.json({ ok: true, ...withBudgets, budget_tunes: budgetTunes })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await cronRun.finish({ error: msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

function cronDenied(req: NextRequest): NextResponse | null {
  // 密钥没配时，比较目标会变成字面量 "Bearer undefined" —— 任何人发这个头就进来了，
  // 而这条链会写运行记录。仓库里有的定时接口先判断密钥存在再比对，这里必须是那一半。
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

async function overlappingRun(): Promise<boolean> {
  // 同一时间只许跑一轮。两轮叠在一起会各写一条运行记录，待办只认最新一条，
  // 早结束的那条会把晚结束的盖住。必须在 startCronRun 之前查 —— 之后查会读到自己刚插进去的那条。
  const { data: inFlight } = await supabaseAdmin
    .from('cron_run_logs')
    .select('id')
    .eq('job_name', 'prescription-weekly')
    .eq('status', 'running')
    .gte('started_at', new Date(Date.now() - 30 * 60_000).toISOString())
    .limit(1)
  return !!inFlight && inFlight.length > 0
}
