/**
 * Inngest event for one 张骞 discovery run. The event is only the wake-up bell;
 * the record is the `client_discovery_jobs` row (status / progress_note / error).
 * Payload carries no secrets. Human authorization = the staff/user click on
 * "开始发现" that reached the discover route (`auth_basis: 'human_click'`).
 */

import type { InngestOutboundEvent } from '@/lib/workflows/inngest-event'

export const ZHANGQIAN_DISCOVERY_REQUESTED = 'zhangqian.discovery.requested'

export type ZhangqianDiscoveryRequestedData = {
  request_id: string
  job_id: string
  client_id: string
  domain: string
  semrush_db: string | null
  /** 0 for admin runs (billing no-op). */
  projected_mtc: number
  auth_basis: 'human_click'
  created_at: string
}

export function buildDiscoveryRequestedEvent(
  input: Omit<ZhangqianDiscoveryRequestedData, 'request_id' | 'auth_basis' | 'created_at'>,
  createdAt: string,
): InngestOutboundEvent<ZhangqianDiscoveryRequestedData> {
  return {
    // One event per job: Inngest de-duplicates the same id for 24h.
    id: `zhangqian_discovery:${input.job_id}`,
    name: ZHANGQIAN_DISCOVERY_REQUESTED,
    data: { ...input, request_id: input.job_id, auth_basis: 'human_click', created_at: createdAt },
  }
}
