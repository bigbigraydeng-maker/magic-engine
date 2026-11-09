/**
 * 广告小时心跳是否停摆 —— 纯判据（设计稿 v0.2 §1：超过 N 小时无成功样本 → dev 待办）。
 * N = 3 小时，与小时级任务口径一致（非日任务 26h）。
 */

import {
  heartbeatConfigProblem,
  parseHeartbeatClientIds,
  resolveHeartbeatMode,
  type HeartbeatMode,
} from '@/lib/ads-strategy/heartbeat/run'

/** 与设计稿一致；改阈值须 PM 点头。 */
export const HEARTBEAT_STALL_THRESHOLD_HOURS = 3

export const AD_HEARTBEAT_JOB_NAME = 'ad-heartbeat'

export type HeartbeatMonitorPhase =
  | 'not_enabled'
  | 'misconfigured'
  | 'never_succeeded'
  | 'last_failed'
  | 'stalled'
  | 'ok'

export interface HeartbeatEnvConfig {
  mode: HeartbeatMode
  clientIds: string[]
  configProblem: string | null
}

export interface HeartbeatCronRun {
  status: 'completed' | 'failed' | 'running' | string
  finished_at: string | null
  started_at: string
}

export interface HeartbeatStallVerdict {
  phase: HeartbeatMonitorPhase
  thresholdHours: number
  lastSuccessAt: string | null
  hoursSinceSuccess: number | null
  configProblem: string | null
  lastRunStatus: string | null
}

export function readHeartbeatEnvConfig(
  rawMode: string | undefined,
  rawClientIds: string | undefined,
): HeartbeatEnvConfig {
  const clientIds = parseHeartbeatClientIds(rawClientIds)
  const mode = resolveHeartbeatMode(rawMode)
  return {
    mode,
    clientIds,
    configProblem: heartbeatConfigProblem(rawMode, clientIds),
  }
}

/** 当前配置是否期望有心跳成功采样（dry 且 0 客户 = 故意不跑，不当故障）。 */
export function heartbeatExpectsSampling(cfg: HeartbeatEnvConfig): boolean {
  if (cfg.configProblem) return true
  if (cfg.mode === 'off') return false
  if (cfg.clientIds.length === 0) return false
  return cfg.mode === 'dry' || cfg.mode === 'live'
}

function hoursBetween(iso: string, now: Date): number {
  return (now.getTime() - new Date(iso).getTime()) / 3_600_000
}

export function lastSuccessfulHeartbeatFinishedAt(
  runs: readonly HeartbeatCronRun[],
): string | null {
  for (const run of runs) {
    if (run.status !== 'completed') continue
    if (!run.finished_at) continue
    return run.finished_at
  }
  return null
}

export function evaluateHeartbeatStall(
  cfg: HeartbeatEnvConfig,
  runs: readonly HeartbeatCronRun[],
  now: Date,
  thresholdHours: number = HEARTBEAT_STALL_THRESHOLD_HOURS,
): HeartbeatStallVerdict | null {
  if (cfg.configProblem) {
    return {
      phase: 'misconfigured',
      thresholdHours,
      lastSuccessAt: null,
      hoursSinceSuccess: null,
      configProblem: cfg.configProblem,
      lastRunStatus: runs[0]?.status ?? null,
    }
  }

  if (!heartbeatExpectsSampling(cfg)) {
    return null
  }

  const lastSuccess = lastSuccessfulHeartbeatFinishedAt(runs)
  const latest = runs[0]

  if (!lastSuccess) {
    return {
      phase: 'never_succeeded',
      thresholdHours,
      lastSuccessAt: null,
      hoursSinceSuccess: null,
      configProblem: null,
      lastRunStatus: latest?.status ?? null,
    }
  }

  const hoursSince = hoursBetween(lastSuccess, now)
  if (hoursSince > thresholdHours) {
    return {
      phase: 'stalled',
      thresholdHours,
      lastSuccessAt: lastSuccess,
      hoursSinceSuccess: hoursSince,
      configProblem: null,
      lastRunStatus: latest?.status ?? null,
    }
  }

  if (latest && latest.status === 'failed') {
    return {
      phase: 'last_failed',
      thresholdHours,
      lastSuccessAt: lastSuccess,
      hoursSinceSuccess: hoursSince,
      configProblem: null,
      lastRunStatus: latest.status,
    }
  }

  return {
    phase: 'ok',
    thresholdHours,
    lastSuccessAt: lastSuccess,
    hoursSinceSuccess: hoursSince,
    configProblem: null,
    lastRunStatus: latest?.status ?? null,
  }
}

/** 要不要进今日待办（去重键：一天一条心跳类欠账）。 */
export function heartbeatStallShouldAlert(verdict: HeartbeatStallVerdict): boolean {
  if (verdict.phase === 'ok' || verdict.phase === 'not_enabled') return false
  return (
    verdict.phase === 'misconfigured' ||
    verdict.phase === 'never_succeeded' ||
    verdict.phase === 'stalled' ||
    verdict.phase === 'last_failed'
  )
}

export function heartbeatStallSummary(verdict: HeartbeatStallVerdict): string {
  switch (verdict.phase) {
    case 'misconfigured':
      return `广告小时心跳的环境开关配错了：${verdict.configProblem ?? '请核对开关'}`
    case 'never_succeeded':
      return '广告小时心跳已配置要跑客户，但最近几天没有一次成功跑完的记录'
    case 'stalled':
      return `广告小时心跳超过 ${Math.floor(verdict.hoursSinceSuccess ?? verdict.thresholdHours)} 小时没有成功采样（阈值 ${verdict.thresholdHours} 小时）`
    case 'last_failed':
      return '广告小时心跳最近一轮是报错结束的（更早还有成功记录）'
    default:
      return '广告小时心跳异常'
  }
}
