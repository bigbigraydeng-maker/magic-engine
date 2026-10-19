/**
 * 这一轮要查谁、查什么 —— 把触发它的事件内容先洗一遍（纯函数）。
 *
 * 触发有三种：每天早上的定时、人手 / 开投前叫醒（ads.tracking_preflight.requested）、
 * 开投后读回（ads.tracking_postlaunch.requested）。事件内容是外面发进来的，不能直接信：
 * 缺东西 / 类型不对 / 客户没配置，都不去猜，一律不查并写明原因，由函数记进回执，不静默。
 */

import {
  ADS_TRACKING_POSTLAUNCH_REQUESTED,
  ADS_TRACKING_PREFLIGHT_REQUESTED,
} from '@/lib/inngest/ads-events'
import type { TrackingPhase, TrackingTrigger } from './types'

export interface RunPlan {
  trigger: TrackingTrigger
  phase: TrackingPhase
  clientIds: string[]
  /** 开投后读回才有：开投时刻（ISO） */
  launchedAt: string | null
  /** 事件内容有问题时的说明；null = 一切正常 */
  error: string | null
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function postLaunchPlan(data: unknown, configured: readonly string[]): RunPlan {
  const fail = (error: string): RunPlan => ({ trigger: 'postlaunch', phase: 'post_t1h', clientIds: [], launchedAt: null, error })
  const d = asRecord(data)
  if (typeof d.client_id !== 'string' || d.client_id === '') return fail('开投后读回的事件里没有客户编号')
  if (d.phase !== 't1h' && d.phase !== 't24h') return fail('开投后读回的事件里阶段不对（只认 t1h / t24h）')
  if (typeof d.launched_at !== 'string' || Number.isNaN(Date.parse(d.launched_at))) {
    return fail('开投后读回的事件里开投时间读不懂')
  }
  if (!configured.includes(d.client_id)) return fail('这个客户没有配置开投前追踪检查，不去猜')
  return {
    trigger: 'postlaunch',
    phase: d.phase === 't1h' ? 'post_t1h' : 'post_t24h',
    clientIds: [d.client_id],
    launchedAt: d.launched_at,
    error: null,
  }
}

function requestedPlan(data: unknown, configured: readonly string[]): RunPlan {
  const d = asRecord(data)
  const base = { trigger: 'requested' as const, phase: 'preflight' as const, launchedAt: null }
  if (d.client_id === undefined) return { ...base, clientIds: [...configured], error: null }
  if (typeof d.client_id !== 'string' || d.client_id === '') {
    return { ...base, clientIds: [], error: '开投前检查的事件里客户编号格式不对' }
  }
  if (!configured.includes(d.client_id)) {
    return { ...base, clientIds: [], error: '这个客户没有配置开投前追踪检查，不去猜' }
  }
  return { ...base, clientIds: [d.client_id], error: null }
}

export function planRun(input: { eventName: string; data: unknown; configuredClientIds: readonly string[] }): RunPlan {
  const { eventName, data, configuredClientIds } = input
  if (eventName === ADS_TRACKING_POSTLAUNCH_REQUESTED) return postLaunchPlan(data, configuredClientIds)
  if (eventName === ADS_TRACKING_PREFLIGHT_REQUESTED) return requestedPlan(data, configuredClientIds)
  return { trigger: 'cron', phase: 'preflight', clientIds: [...configuredClientIds], launchedAt: null, error: null }
}
