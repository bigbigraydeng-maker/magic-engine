import type { DispatchInvoker, DispatchJob, DispatchJobReport } from './types'

const CONCURRENCY = 2

async function pingHealthcheck(url: string): Promise<'ok' | 'failed'> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    return res.ok ? 'ok' : 'failed'
  } catch {
    return 'failed'
  }
}

async function runOne(
  job: DispatchJob,
  secret: string,
  invoke: DispatchInvoker,
): Promise<DispatchJobReport> {
  const started = Date.now()
  try {
    const result = await invoke(job, secret)
    const ok = result.status >= 200 && result.status < 300
    const ping = ok && job.healthcheckUrl ? await pingHealthcheck(job.healthcheckUrl) : 'skipped'
    if (!ok) {
      console.error(`[cron-dispatch] ${job.service} HTTP ${result.status} ${result.body.slice(0, 200)}`)
    } else if (ping === 'failed') {
      console.error(`[cron-dispatch] ${job.service} healthcheck ping failed`)
    }
    return {
      service: job.service,
      status: result.status,
      ok,
      ms: Date.now() - started,
      ping,
      error: ok ? undefined : result.body.slice(0, 200),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[cron-dispatch] ${job.service} threw ${message}`)
    return {
      service: job.service,
      status: 0,
      ok: false,
      ms: Date.now() - started,
      ping: 'skipped',
      error: message.slice(0, 200),
    }
  }
}

/** Run due jobs with a small cap so one tick cannot stampede the web process. */
export async function runDueJobs(
  jobs: readonly DispatchJob[],
  secret: string,
  invoke: DispatchInvoker,
): Promise<DispatchJobReport[]> {
  const out: DispatchJobReport[] = new Array(jobs.length)
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < jobs.length) {
      const index = cursor
      cursor += 1
      out[index] = await runOne(jobs[index], secret, invoke)
    }
  }
  const workers = Math.min(CONCURRENCY, jobs.length)
  await Promise.all(Array.from({ length: workers }, () => worker()))
  return out
}
