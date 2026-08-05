/**
 * GET /api/cron/execution-auto-run —— 把执行看板上排好的动作真正跑掉。
 *
 * 起因（2026-08-05 实测）：`execution_items` 里 281 件待办，**最后一件「完成」
 * 是 7-21，15 天前**。判定用的两道闸 2026-08-04 就写好了，一直零调用方 ——
 * 「诊断 → 方案 → 动作」这条链跑到最后一步就停在看板上给人看。
 *
 * 只做一件事：挑出「现在还被认着、而且机器真能独立做完」的动作，写成**草稿**。
 * 不发布、不开 PR、不碰客户网站、不花广告费。
 *
 * `?dry_run=1` —— 只选不做，把每条候选的判定原样返回。
 * 上线第一步就用它把名单打出来人眼确认（PM 认可的上线方式）。
 *
 * Auth: Bearer ${CRON_SECRET}
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { startCronRun } from '@/lib/cron/run-logger'
import { runAutoRunBatch, MAX_ITEMS_PER_RUN } from '@/lib/execution/auto-run'
import { generateWeeklyBlogForClient } from '@/lib/blog/weekly-blog'

export const dynamic = 'force-dynamic'
// Vercel-only knob, inert on Render —— 真正的天花板是 cron 的 curl --max-time 900，
// 批次自己用 BATCH_BUDGET_MS 收口。对齐 blog-weekly。
export const maxDuration = 900

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

  // 🔴 默认真跑；要空跑必须显式带 ?dry_run=1。
  //    反过来（默认空跑）的话，忘了改开关的那天它会一直安静地什么都不做，
  //    而运行记录长得跟正常跑完一模一样 —— 那正是这套东西要修的病。
  const dryRun = req.nextUrl.searchParams.get('dry_run') === '1'
  // 首轮真跑用 ?max=1 试水。只往小了调 —— 传大了 selectAutoRunCandidates 会夹回上限。
  const maxParam = Number(req.nextUrl.searchParams.get('max'))
  const maxItems = Number.isFinite(maxParam) && maxParam > 0 ? maxParam : MAX_ITEMS_PER_RUN

  const cronRun = await startCronRun('execution-auto-run')

  try {
    const result = await runAutoRunBatch(
      supabaseAdmin,
      { generateBlog: (client) => generateWeeklyBlogForClient(supabaseAdmin, client) },
      new Date(),
      { dryRun, maxItems },
    )

    await cronRun.finish({
      processed: result.considered,
      completed: result.generated,
      failed: result.failed,
      // 一件都没跑时必须说清是「没有候选」还是「全被拦下了」——
      // 两者在运行记录里长得一样，而含义完全相反。
      summary: {
        dry_run: dryRun,
        runnable: result.runnable,
        generated: result.generated,
        deferred_by_quota: result.deferred_by_quota,
        released_stale: result.released_stale,
        note:
          result.considered === 0
            ? '本轮没有任何候选动作（看板上没有白名单类型的待办，或都在退避期内）'
            : result.runnable === 0
              ? '有候选但一件都不能自动跑 —— 逐条原因见 verdicts'
              : undefined,
        verdicts: result.verdicts,
        results: result.results,
      },
    })

    return NextResponse.json({
      success: true,
      dry_run: dryRun,
      max_per_run: Math.min(MAX_ITEMS_PER_RUN, maxItems),
      considered: result.considered,
      runnable: result.runnable,
      generated: result.generated,
      failed: result.failed,
      deferred_by_quota: result.deferred_by_quota,
      released_stale: result.released_stale,
      verdicts: result.verdicts,
      results: result.results,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await cronRun.finish({ failed: 1, error: msg })
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
