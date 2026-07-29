import { NextRequest, NextResponse } from 'next/server'
import { refreshDemoClient } from '@/lib/demo/refresh'

/**
 * GET /api/cron/demo-refresh
 * Auth: Bearer ${CRON_SECRET}
 *
 * 每日把演示客户（Harbourline Physio）的时间序列前滚一天，
 * 让管理员演示账号看到的永远是「活的」数据而不是上周的快照。
 *
 * 只动 DEMO_CLIENT_ID 一个客户，不触碰任何真实客户数据。
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'Server misconfiguration: CRON_SECRET not set' }, { status: 500 })
  }

  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await refreshDemoClient()
    return NextResponse.json({ ok: true, ...result, refreshedAt: new Date().toISOString() })
  } catch (error) {
    const msg = error instanceof Error ? error.message : '刷新失败'
    console.error('[cron/demo-refresh]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
