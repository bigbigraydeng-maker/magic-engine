// P0.1 factory-publish-worker cron — approved 成片 → 发到客户平台(FB Reel / Publer)+ 三落库。
// 一次领 1 条发(FB 上传慢,防 300s 超时)。Auth: CRON_SECRET bearer(同全部 ME crons)。
//
// 🔴 首发安全阀:默认**草稿模式**(video_state=DRAFT,不公开)。PM 验完草稿格式、显式 go 后,
//    在 Render 设 FACTORY_PUBLISH_LIVE=true 才真发生产客户主页(不可逆)。这是「首次真发 PM 显式 go」的落地。

import { NextRequest, NextResponse } from 'next/server'
import { runPublishWorker } from '@/lib/factory/publish/publish-worker'
import { startCronRun } from '@/lib/cron/run-logger'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// 🔴 必须写 cron_run_logs(2026-08-03 补):此前这条路由不留任何运行痕迹,
// 于是「跑了但没事干」和「压根没跑」长得一模一样,监控无法分辨。
// 本仓有 daily-cron-digest 哑 51 天、工厂排产停摆 8 天都没告警的前科。
export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronRun = await startCronRun('factory-publish-worker')
  const live = process.env.FACTORY_PUBLISH_LIVE === 'true' // 未设 = 草稿模式(安全默认)
  try {
    const outcome = await runPublishWorker({
      draft: !live,
      workerId: `cron-${process.env.RENDER_INSTANCE_ID ?? 'local'}`,
    })
    await cronRun.finish({ summary: { live, ...outcome } })
    return NextResponse.json({ ok: true, live, ...outcome })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await cronRun.finish({ error: msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
