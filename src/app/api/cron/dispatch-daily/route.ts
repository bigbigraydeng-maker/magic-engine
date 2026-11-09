import { NextRequest, NextResponse } from 'next/server'
import { startCronRun } from '@/lib/cron/run-logger'
import { handleDispatch, rejectUnauthorized } from '@/lib/cron/dispatch/handle'

export const dynamic = 'force-dynamic'

/** Once-a-day jobs. Render curls this every 5 minutes so the minute stays exact. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const denied = rejectUnauthorized(req)
  if (denied) return denied
  const run = await startCronRun('cron-dispatch-daily')
  return handleDispatch(req, 'daily', run)
}
