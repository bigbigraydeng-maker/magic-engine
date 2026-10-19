/**
 * 手动触发入口的「洗请求」这一步（纯函数，不碰网络、不写任何东西）。
 *
 * 外面发进来的请求内容不能直接信：缺字段、类型不对、客户没配置，都不去猜，
 * 一律拒绝并写明原因。校验复用 plan-run 的 planRun —— 跟定时 / 事件触发走同一套规矩，
 * 免得手动入口和自动入口对「什么算合法」各说各话。
 */

import {
  ADS_TRACKING_POSTLAUNCH_REQUESTED,
  ADS_TRACKING_PREFLIGHT_REQUESTED,
} from '@/lib/inngest/ads-events'
import { planRun } from './plan-run'

export type TriggerResult =
  | { ok: true; dry_run: boolean; event: { name: string; data: Record<string, unknown> } }
  | { ok: false; status: 400; error: string }

const MAX_REASON_CHARS = 40

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function fail(error: string): TriggerResult {
  return { ok: false, status: 400, error }
}

function buildCandidate(kind: 'preflight' | 'postlaunch', body: Record<string, unknown>): { name: string; data: Record<string, unknown> } {
  const clientId = body.client_id as string
  if (kind === 'preflight') {
    const reason = typeof body.reason === 'string' && body.reason !== '' ? body.reason.slice(0, MAX_REASON_CHARS) : 'manual'
    return { name: ADS_TRACKING_PREFLIGHT_REQUESTED, data: { client_id: clientId, reason } }
  }
  return {
    name: ADS_TRACKING_POSTLAUNCH_REQUESTED,
    data: { client_id: clientId, phase: body.phase, launched_at: body.launched_at },
  }
}

export function buildTriggerEvent(body: unknown, configuredClientIds: readonly string[]): TriggerResult {
  const d = asRecord(body)
  if (!d) return fail('请求内容必须是 JSON 对象')
  if (d.kind !== 'preflight' && d.kind !== 'postlaunch') return fail('kind 只能是 preflight 或 postlaunch')
  if (typeof d.client_id !== 'string' || d.client_id === '') {
    return fail('必须点名一个客户（client_id），不支持「所有客户」')
  }

  // 只有严格写 dry_run: false 才算真发；"false" / 0 / null / 不写都按演练。
  const dryRun = d.dry_run !== false
  const candidate = buildCandidate(d.kind, d)

  const plan = planRun({ eventName: candidate.name, data: candidate.data, configuredClientIds })
  if (typeof plan.error === 'string' || plan.clientIds.length !== 1) {
    return fail(plan.error ?? '没有可查的客户')
  }

  return { ok: true, dry_run: dryRun, event: candidate }
}
