import { NextRequest, NextResponse } from 'next/server'
import { startCronRun } from '@/lib/cron/run-logger'
import { handleDispatch, rejectUnauthorized } from '@/lib/cron/dispatch/handle'

export const dynamic = 'force-dynamic'

/** Sub-daily jobs. Render curls this every 5 minutes. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const denied = rejectUnauthorized(req)
  if (denied) return denied
  const run = await startCronRun('cron-dispatch-frequent')
  return handleDispatch(req, 'frequent', run)
}
