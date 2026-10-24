import { NextRequest, NextResponse } from 'next/server'
import type { CronRunHandle } from '@/lib/cron/run-logger'
import { retainBackground } from './background'
import { DISPATCH_CATALOG } from './catalog'
import { selectDue } from './due'
import { invokeDispatchJob } from './invoke'
import { runDueJobs } from './run'
import type { DispatchBucket, DispatchInvoker } from './types'

export function rejectUnauthorized(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: 'Server misconfiguration: CRON_SECRET not set' },
      { status: 500 },
    )
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

function failureSummary(failed: { service: string; status: number }[]): string {
  return failed.map((job) => `${job.service} HTTP ${job.status}`).join('; ').slice(0, 500)
}

/**
 * Decide which handlers are due, answer immediately, then run them here.
 * The HTTP call is what Cloudflare times out at ~100s. The work is not.
 */
export async function handleDispatch(
  req: NextRequest,
  bucket: DispatchBucket,
  run: CronRunHandle,
  now: Date = new Date(),
  invoke: DispatchInvoker = invokeDispatchJob,
): Promise<NextResponse> {
  const due = selectDue(DISPATCH_CATALOG, bucket, now)
  const names = due.map((job) => job.service)
  const dryRun = req.nextUrl.searchParams.get('dry_run') === '1'
  if (dryRun || due.length === 0) {
    await run.finish({
      processed: due.length,
      completed: dryRun ? 0 : due.length,
      summary: { bucket, dry_run: dryRun, due: names },
    })
    return NextResponse.json({ ok: true, bucket, dry_run: dryRun, due: names })
  }

  const secret = process.env.CRON_SECRET ?? ''
  const work = runDueJobs(due, secret, invoke)
    .then(async (report) => {
      const failed = report.filter((job) => !job.ok)
      await run.finish({
        processed: report.length,
        completed: report.length - failed.length,
        failed: failed.length,
        error: failed.length > 0 ? failureSummary(failed) : undefined,
        summary: { bucket, jobs: report },
      })
    })
    .catch(async (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[cron-dispatch] ${bucket} fan-out failed: ${message}`)
      await run.finish({ failed: 1, error: message.slice(0, 500) })
    })
  retainBackground(work)
  return NextResponse.json({ accepted: true, bucket, due: names }, { status: 202 })
}
