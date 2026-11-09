import { NextRequest, NextResponse } from 'next/server'
import {
  loadDueBriefs,
  generateDueBriefs,
  runPostBriefSweeps,
} from '@/lib/messenger/brief-cycle'

/**
 * GET /api/cron/messenger-brief-hourly —— **手动补触发**客户需求卡。
 *
 * 🔴 **定时不再走这条路由**（2026-09-07 改）。每小时的写卡由 Inngest 上的
 *    `cloud-messenger-brief-after-sync` 干：私信同步跑完发一张条子，它收到就写。
 *
 * 🔴 **原来的走法坏了 14 天**：`render.yaml` 里是 `curl 私信同步 && curl 本路由`，
 *    而那个 `&&` 守的是 curl 的退出码 —— 回答的是「网关有没有在超时前给我响应」，
 *    不是「同步有没有跑完」。同步 2026-08-17 起每轮约 140 秒、网关约 125 秒掐断返 524，
 *    于是本路由**从 2026-08-23 起一次都没被执行过**，销售的客户需求卡停在 8 月 23 号。
 *    判据换成条子之后，响应超不超时跟写不写卡完全无关。
 *    整段来龙去脉见 `@/lib/messenger/sync-completed-event`。
 *
 * 🔴 **本路由不写 `cron_run_logs`**：运行记录是「定时器有没有按时跑」的证据。
 *    手动补触发写进去，会把「人手点了一下」伪装成「定时链路正常」——
 *    正好盖住这次要监控的那件事。定时那条的运行记录由 Inngest 函数写。
 *
 * 🔴 **一轮不许在一个请求里跑完**：整轮 160~210 秒，网关约 125 秒就掐。本路由按
 *    `BRIEFS_PER_CHUNK` 分批只是为了跟定时那条走同一套判据，**它自己仍然可能超时** ——
 *    超时了服务端照样跑完，只是你看不到那个 JSON。要看结果就查 `conversation_briefs`。
 *
 * Auth: Bearer ${CRON_SECRET}
 */

export const maxDuration = 800

export async function GET(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'Server misconfiguration: CRON_SECRET not set' },
      { status: 500 },
    )
  }

  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()

  let due
  try {
    due = await loadDueBriefs(now)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }

  // 🔴 时间预算按本路由自己的 `maxDuration`（800 秒）来，不用 `CHUNK_TIME_BUDGET_MS`
  //    的 90 秒。那 90 秒是给 Inngest**一段**用的（段必须在网关约 125 秒内返回）；
  //    本路由是手动补触发，整轮一口气跑完才是它存在的意义 —— 用 90 秒会让补触发
  //    每次只补掉 1/3，剩下的又要人再点一次。
  const { generated, failed, aborted } = await generateDueBriefs(due, now, { budgetMs: 700_000 })
  // 账户级故障（余额用光 / 密钥被拒）那一轮不跑扫尾：它们要读刚写好的卡，而这一轮没写完。
  const sweeps = aborted ? null : await runPostBriefSweeps(now)

  return NextResponse.json({
    ok: aborted === null,
    trigger: 'manual',
    candidates: due.length,
    generated,
    failed,
    aborted,
    ...(sweeps ?? {}),
  })
}
