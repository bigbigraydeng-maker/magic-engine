/**
 * Inngest consumer for `zhangqian.discovery.requested` — runs one 张骞 discovery.
 *
 * Why Inngest: the run takes up to ~9 minutes. Run as fire-and-forget inside the
 * web request's process, a redeploy/restart silently lost it and left the user
 * watching a spinner until the 12-minute stale check. Here the run has a receipt
 * (the job row) and a terminal handler.
 *
 * 🔴 `retries: 0` on purpose: a retry would re-run the whole paid agent. A crash
 * ends in `onFailure`, which closes the job as failed and refunds the MTC hold.
 * 🔴 One event, one owner: cloud-only; the local factory-worker does not listen.
 */

import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { executeDiscoveryJob } from '@/lib/zhangqian/run-discovery-job'
import { failJob, getJob } from '@/lib/zhangqian/persistor'
import {
  ZHANGQIAN_DISCOVERY_REQUESTED,
  type ZhangqianDiscoveryRequestedData,
} from '@/lib/zhangqian/discovery-events'

export function parseDiscoveryEvent(raw: unknown): ZhangqianDiscoveryRequestedData | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>
  if (typeof d.job_id !== 'string' || typeof d.client_id !== 'string' || typeof d.domain !== 'string') return null
  return {
    request_id: typeof d.request_id === 'string' ? d.request_id : d.job_id,
    job_id: d.job_id,
    client_id: d.client_id,
    domain: d.domain,
    semrush_db: typeof d.semrush_db === 'string' ? d.semrush_db : null,
    projected_mtc: typeof d.projected_mtc === 'number' ? d.projected_mtc : 0,
    auth_basis: 'human_click',
    created_at: typeof d.created_at === 'string' ? d.created_at : new Date().toISOString(),
  }
}

/** Close a job the run never finished (nothing was charged, so nothing is refunded). No-op when it already reached a terminal state. */
export async function closeUnfinishedDiscoveryJob(
  data: ZhangqianDiscoveryRequestedData,
  message: string,
): Promise<'closed' | 'already_terminal'> {
  const job = await getJob(supabaseAdmin, data.job_id)
  if (job && job.status !== 'pending' && job.status !== 'running') return 'already_terminal'
  // No refund: precheckCharge only checks the balance, and commitCharge runs after the
  // job is marked completed. A job still pending/running here was never debited.
  await failJob(supabaseAdmin, data.job_id, `Agent error: ${message}`)
  return 'closed'
}

/**
 * Only a job still `pending` may start. If the hand-off was reported as failed (the
 * route already marked the job failed) but Inngest delivered the event anyway, the
 * run must not go ahead and charge for a result the user was told did not start.
 */
export async function shouldStartDiscoveryJob(jobId: string): Promise<boolean> {
  const job = await getJob(supabaseAdmin, jobId)
  return job?.status === 'pending'
}

export const zhangqianDiscovery = inngest.createFunction(
  {
    id: `${CLOUD_FN_PREFIX}zhangqian-discovery`,
    name: 'Run one Zhangqian discovery',
    retries: 0,
    concurrency: { limit: 1, key: 'event.data.client_id' },
    onFailure: async ({ event, error }) => {
      const data = parseDiscoveryEvent((event.data as { event?: { data?: unknown } }).event?.data)
      if (!data) return
      await closeUnfinishedDiscoveryJob(data, error?.message || 'unknown error')
    },
  },
  { event: ZHANGQIAN_DISCOVERY_REQUESTED },
  async ({ event, step }) => {
    const data = parseDiscoveryEvent(event.data)
    if (!data) return { status: 'skipped' as const }
    if (!(await step.run('check-pending', () => shouldStartDiscoveryJob(data.job_id)))) {
      return { status: 'skipped' as const, job_id: data.job_id }
    }
    await step.run('discover', () =>
      executeDiscoveryJob(data.job_id, data.client_id, data.domain, data.projected_mtc, data.semrush_db),
    )
    return { status: 'done' as const, job_id: data.job_id }
  },
)
