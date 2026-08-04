import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { startCronRun } from '@/lib/cron/run-logger'
import { runIntakeForClient } from '@/lib/content-factory/intake-runner'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// 每日跑。对每个开了自动进料的客户：抓爆款 → 选题助理改写 → 写候选。
// 频率：daily 每天跑；weekly 只周一跑；off 跳过。
// Auth: Authorization: Bearer ${CRON_SECRET}
export async function POST(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const cronRun = await startCronRun('content-factory-intake')
  try {
    const isMonday = new Date().getUTCDay() === 1
    const { data } = await supabaseAdmin
      .from('clients')
      .select('id, factory_config')
      .not('factory_config', 'is', null)

    const results: Array<{ clientId: string; created: number; scanned: number }> = []
    let processed = 0, completed = 0, failed = 0

    for (const c of data ?? []) {
      const ti = (c.factory_config as { topic_intake?: { enabled?: boolean; cadence?: string } } | null)?.topic_intake
      if (!ti?.enabled || ti.cadence === 'off') continue
      if (ti.cadence === 'weekly' && !isMonday) continue

      processed += 1
      try {
        const r = await runIntakeForClient(c.id as string)
        completed += 1
        results.push({ clientId: c.id as string, created: r.created, scanned: r.scanned })
      } catch (e) {
        failed += 1
        results.push({ clientId: c.id as string, created: 0, scanned: 0 })
        void e
      }
    }

    await cronRun.finish({ processed, completed, failed, summary: { results } })
    return NextResponse.json({ processed, completed, failed, results })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    await cronRun.finish({ failed: 1, error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
