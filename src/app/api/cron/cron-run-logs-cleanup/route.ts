/**
 * GET /api/cron/cron-run-logs-cleanup
 *
 * 每天清一次 `cron_run_logs` 的旧运行记录。
 *
 * 🔴 这活儿以前挂在表上的 AFTER INSERT 触发器里 —— 每天 400~600 次插入就跑
 *    400~600 次全表 DELETE，并发插入时还有死锁风险，而死锁会让**插入本身失败**：
 *    运行记录写不进去恰好是这套监控最不能出的事。清理频率跟插入频率本来无关，
 *    所以搬到这里，每天一次。触发器在 20260907000001 里已拆掉。
 *
 * 保留规则**没有改**，逐字沿用生产上那个函数体（见同一个 migration 的文件头）：
 *   ① 7 天以上、跑完了、什么都没留下的空记录才删（每个任务至少保留最新一条）
 *   ② 180 天以上的一律删
 *
 * 🔴 2026-09-23 加了第二件活儿：清扫**停在「在跑」太久**的记录（`reapAbandonedCronRuns`）。
 *    放这里是因为它跟清理是同一种活儿 —— 都是这张表自己的家务，而且都不能失败得没人知道。
 *    为什么非要有这道清扫：部署换机会把在途请求连同收尾代码一起杀掉，那一行就永远停在
 *    `running`。SIGTERM 收口是尽力而为、不保证跑得到，这条才是保证（整段见 run-logger.ts 文件头）。
 *    代价是最坏要等到第二天这一轮才收 —— 在那之前，`health.ts` 的 `stuck` 判据
 *    （开跑超 1 小时）已经在报了，只是报得泛泛，说不出是哪个客户的什么东西丢了。
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}
 * 排班: render.yaml 服务 cron-run-logs-cleanup（50 16 * * *，UTC）
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { reapAbandonedCronRuns, startCronRun } from '@/lib/cron/run-logger'

export const maxDuration = 120

interface PurgeResult {
  purged_noise: number
  purged_expired: number
  remaining: number
  oldest_started_at: string | null
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronRun = await startCronRun('cron-run-logs-cleanup')

  const { data, error } = await supabaseAdmin.rpc('cron_run_logs_purge')

  if (error) {
    // 🔴 清理失败必须是**红的**。这张表是所有定时任务健康检查的唯一数据源，
    //    它悄悄涨到撑爆的那天，先坏的是监控本身。
    console.error('[cron-run-logs-cleanup] purge failed:', error.message)
    await cronRun.finish({ failed: 1, error: error.message })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const result = data as PurgeResult
  const purged = result.purged_noise + result.purged_expired

  // 清扫写失败只记日志、不把这一轮判成失败：它跟上面的清理是两件独立的家务，
  // 一件没干成不该把另一件的结果也抹掉。失败时 reapAbandonedCronRuns 自己会 console.error。
  const reaped = await reapAbandonedCronRuns()

  console.log('[cron-run-logs-cleanup]', { ...result, reaped_abandoned: reaped })
  await cronRun.finish({
    processed: purged,
    completed: purged,
    failed: 0,
    summary: { ...result, reaped_abandoned: reaped },
  })

  return NextResponse.json({ ...result, reaped_abandoned: reaped })
}
