// 讲课片发布 cron — 把「点了发布」的讲课片真正发到平台。
// 为什么单独一条 cron:发布要等 Facebook 拉视频(几分钟),塞网页请求里会 502 超时
// (真实事故 2026-08-04)。点按钮只登记,这里执行,成功失败都回写页面。

import { NextRequest, NextResponse } from 'next/server'
import { runLecturePublishSweep } from '@/lib/factory/lecture-publish'
import { startCronRun } from '@/lib/cron/run-logger'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const run = await startCronRun('lecture-publish')
  try {
    const { handled } = await runLecturePublishSweep()
    const ok = handled.filter((h) => h.ok).length
    await run.finish({
      processed: handled.length,
      completed: ok,
      failed: handled.length - ok,
      summary: {
        note: handled.length === 0 ? '没有待发布的讲课片' : `发了 ${ok}/${handled.length} 条`,
        results: handled,
      },
    })
    return NextResponse.json({ ok: true, handled })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await run.finish({ error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
