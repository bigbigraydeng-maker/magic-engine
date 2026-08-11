/**
 * GET/POST /api/cron/ad-readback-sweep
 *
 * 每天把**所有在投的广告组**过一遍上线闸门，不管广告是谁建的。
 *
 * 为什么是这个触发点（2026-08-05 子牙复审）：
 *   闸门原来只在「ME 自己建完广告」那一步跑一次。而 2026-08-04 真正得罪
 *   Boris / Richard / Jude 那批广告是在 Meta 后台直接建的 —— 规则再对也
 *   永远轮不到它说话。改成按账户扫在投广告组，覆盖率从约等于 0 变成 100%。
 *
 * 发现的 blocker 走今日待办的「🙋 需要你动手」栏（`pm-todo/manual-items.ts` 读
 * 本任务最近一次的运行记录），不留在日志里 —— 发现不许死在日志里。
 *
 * Auth:
 *   GET : Authorization: Bearer ${CRON_SECRET}   （Render 定时触发）
 *   POST: x-cron-secret: ${CRON_SECRET}          （人手补跑）
 *
 * ⚠️ 这个 cron 在 Render 上必须 link `me-shared-cron-secret` 环境变量组，否则每次
 *    401 静默失败 —— 上一个踩这个坑的 cron 哑了 51 天。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { startCronRun } from '@/lib/cron/run-logger'
import { sweepAllClients } from '@/lib/ads-strategy/readback-sweep'

// 每个客户串行、每个广告组还要再拉一次广告列表；客户多了会久。
export const maxDuration = 600

async function run(): Promise<NextResponse> {
  const cronRun = await startCronRun('ad-readback-sweep')

  let results
  try {
    results = await sweepAllClients(supabaseAdmin)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await cronRun.finish({ error: msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  const failed = results.filter((r) => r.error).length
  const blockers = results.reduce((n, r) => n + r.blockers, 0)
  const warns = results.reduce((n, r) => n + r.warns, 0)
  const adSets = results.reduce((n, r) => n + r.adSetsChecked, 0)

  await cronRun.finish({
    processed: results.length,
    completed: results.length - failed,
    failed,
    // 待办那边直接读这份 summary，所以细节要全留着，不能只留计数。
    summary: { adSets, blockers, warns, results },
  })

  return NextResponse.json({ ok: true, clients: results.length, adSets, blockers, warns, results })
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return run()
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return run()
}
