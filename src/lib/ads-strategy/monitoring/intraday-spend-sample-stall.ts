/**
 * 日内花费采样 cron（每 10 分钟）是否太久没成功 —— 纯判据，阈值来自 agent-jobs。
 */

import { jobById } from './agent-jobs'
import { evaluateJobStaleness, formatStaleJobsSummary, type StaleJobFinding } from './staleness'

/** 与 src/lib/cron/registry.ts jobName 一致 */
export const INTRADAY_SPEND_SAMPLE_CRON_JOB = 'ad-intraday-spend-sample'

/** 读 cron_run_logs 回溯窗口（小时） */
export const INTRADAY_SPEND_SAMPLE_LOOKBACK_HOURS = 24

export interface IntradaySpendSampleCronRun {
  status: string
  finished_at: string | null
  started_at: string
}

export function lastSuccessfulIntradaySpendSampleAt(
  runs: readonly IntradaySpendSampleCronRun[],
): string | null {
  for (const run of runs) {
    if (run.status !== 'completed') continue
    if (!run.finished_at) continue
    return run.finished_at
  }
  return null
}

export function evaluateIntradaySpendSampleStall(
  runs: readonly IntradaySpendSampleCronRun[],
  now: Date,
): StaleJobFinding | null {
  const job = jobById('intraday_spend_sample')
  const lastSuccess = lastSuccessfulIntradaySpendSampleAt(runs)
  return evaluateJobStaleness(job, lastSuccess, now)
}

export function intradaySpendSampleStallShouldAlert(finding: StaleJobFinding | null): boolean {
  return finding !== null
}

export function intradaySpendSampleStallWhat(finding: StaleJobFinding): string {
  const detail = formatStaleJobsSummary([finding])
  return `Magic Engine 后台的日内花费采样定时任务好像停了：${detail}。收盘花费预测和日内超限提醒可能不准，广告不会被自动改动。`
}

export function intradaySpendSampleStallHow(): string {
  return '这条不用你动手 —— 是开发排查。打开后台定时任务健康页看 ad-intraday-spend-sample 最近有没有报错。'
}
