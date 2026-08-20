import { NextRequest, NextResponse } from 'next/server'
import { startCronRun } from '@/lib/cron/run-logger'
import { runMarketIntelDaily } from '@/lib/market-intel/pipeline'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronRun = await startCronRun('market-intel-daily')

  try {
    const result = await runMarketIntelDaily()

    await cronRun.finish({
      processed: result.itemsConsidered,
      completed: result.itemsSentInEmail,
      failed: result.sourceFailures.length,
      summary: {
        sent: result.sent,
        reason: result.reason ?? null,
        items_selected: result.itemsSelected,
        items_flagged_for_review: result.itemsFlaggedForReview,
        source_failures: result.sourceFailures,
      },
    })

    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await cronRun.finish({ failed: 1, error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
