/**
 * 广告 Agent 后台定时任务 —— 只读监控用的间隔与容错（纯数据，无 I/O）。
 */

export type AdAgentJobId =
  | 'insights'
  | 'entity_snapshots'
  | 'spend_fetch'
  | 'meta_leads_sync'
  | 'prescription_weekly'

export interface AdAgentScheduledJob {
  id: AdAgentJobId
  /** 给非技术同事看的名字 */
  label: string
  /** 预期多久成功跑一轮（小时） */
  intervalHours: number
  /** 超过「间隔 × 容错」仍无成功 → 报警 */
  tolerance: number
}

/** 与 src/lib/cron/registry.ts 登记节奏对齐；容错 2.5 跟下游表新鲜度口径一致（日任务约 26h）。 */
export const AD_AGENT_SCHEDULED_JOBS: readonly AdAgentScheduledJob[] = [
  { id: 'insights', label: '广告每日结果入库', intervalHours: 24, tolerance: 2.5 },
  { id: 'entity_snapshots', label: '广告设置快照', intervalHours: 6, tolerance: 2.5 },
  { id: 'spend_fetch', label: '每日花费拉取', intervalHours: 24, tolerance: 2.5 },
  { id: 'meta_leads_sync', label: 'Facebook 新客户同步', intervalHours: 0.5, tolerance: 3 },
  { id: 'prescription_weekly', label: '周方案进度复查', intervalHours: 168, tolerance: 1.25 },
] as const

export function jobById(id: AdAgentJobId): AdAgentScheduledJob {
  const hit = AD_AGENT_SCHEDULED_JOBS.find((j) => j.id === id)
  if (!hit) throw new Error(`unknown ad agent job: ${id}`)
  return hit
}

export function staleThresholdHours(job: AdAgentScheduledJob): number {
  return job.intervalHours * job.tolerance
}
