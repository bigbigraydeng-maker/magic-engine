// P0.1 factory-publish-worker cron — approved 成片 → 发到客户平台(FB Reel / Publer)+ 三落库。
// 一次领 1 条发(FB 上传慢,防 300s 超时)。Auth: CRON_SECRET bearer(同全部 ME crons)。
//
// 🔴 首发安全阀:默认**草稿模式**(video_state=DRAFT,不公开)。PM 验完草稿格式、显式 go 后,
//    在 Render 设 FACTORY_PUBLISH_LIVE=true 才真发生产客户主页(不可逆)。这是「首次真发 PM 显式 go」的落地。

import { NextRequest, NextResponse } from 'next/server'
import { runPublishWorker } from '@/lib/factory/publish/publish-worker'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const live = process.env.FACTORY_PUBLISH_LIVE === 'true' // 未设 = 草稿模式(安全默认)
  try {
    const outcome = await runPublishWorker({
      draft: !live,
      workerId: `cron-${process.env.RENDER_INSTANCE_ID ?? 'local'}`,
    })
    return NextResponse.json({ ok: true, live, ...outcome })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
