/**
 * 广告 Agent 定时任务是否「太久没成功」—— 纯函数，无 I/O。
 */

import {
  type AdAgentJobId,
  type AdAgentScheduledJob,
  jobById,
  staleThresholdHours,
} from './agent-jobs'

export interface StaleJobFinding {
  jobId: AdAgentJobId
  label: string
  lastSuccessAt: string | null
  thresholdHours: number
  hoursSince: number | null
}

function hoursBetween(iso: string, now: Date): number {
  return (now.getTime() - new Date(iso).getTime()) / 3_600_000
}

export function evaluateJobStaleness(
  job: AdAgentScheduledJob,
  lastSuccessAt: string | null,
  now: Date,
): StaleJobFinding | null {
  const thresholdHours = staleThresholdHours(job)
  if (lastSuccessAt === null) {
    return {
      jobId: job.id,
      label: job.label,
      lastSuccessAt: null,
      thresholdHours,
      hoursSince: null,
    }
  }
  const hoursSince = hoursBetween(lastSuccessAt, now)
  if (hoursSince <= thresholdHours) return null
  return {
    jobId: job.id,
    label: job.label,
    lastSuccessAt,
    thresholdHours,
    hoursSince,
  }
}

export function evaluateClientJobStaleness(
  inputs: Partial<Record<AdAgentJobId, string | null>>,
  now: Date,
): StaleJobFinding[] {
  const out: StaleJobFinding[] = []
  for (const id of Object.keys(inputs) as AdAgentJobId[]) {
    const finding = evaluateJobStaleness(jobById(id), inputs[id] ?? null, now)
    if (finding) out.push(finding)
  }
  return out
}

/** 多任务合成一段人话（不含技术字段名）。 */
export function formatStaleJobsSummary(findings: readonly StaleJobFinding[]): string {
  if (findings.length === 0) return ''
  const parts = findings.map((f) => {
    if (f.lastSuccessAt === null) {
      return `「${f.label}」最近没查到成功记录`
    }
    const age =
      f.hoursSince === null
        ? '有一段时间'
        : f.hoursSince < 48
          ? `已超过 ${Math.floor(f.hoursSince)} 小时`
          : `已超过 ${Math.floor(f.hoursSince / 24)} 天`
    return `「${f.label}」${age}没成功更新`
  })
  return parts.join('；')
}
