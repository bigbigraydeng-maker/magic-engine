export type DispatchAuth = 'bearer' | 'x-cron-secret'
export type DispatchMethod = 'GET' | 'POST'
export type DispatchBucket = 'frequent' | 'daily' | 'weekly'

export interface DispatchJob {
  /** Registry / Render service name. Not always the URL slug. */
  service: string
  /** Path segment under /api/cron/. */
  route: string
  method: DispatchMethod
  auth: DispatchAuth
  /** UTC cron expression. This is the schedule to preserve. */
  schedule: string
  query?: string
  healthcheckUrl?: string
  /** Set when the service name and the schedule disagree, and we kept production. */
  scheduleNote?: string
}

export interface DispatchInvocation {
  status: number
  body: string
}

export type DispatchInvoker = (
  job: DispatchJob,
  secret: string,
) => Promise<DispatchInvocation>

export interface DispatchJobReport {
  service: string
  status: number
  ok: boolean
  ms: number
  ping: 'skipped' | 'ok' | 'failed'
  error?: string
}
