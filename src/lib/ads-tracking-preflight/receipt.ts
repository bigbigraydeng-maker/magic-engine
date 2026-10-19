/**
 * 广告开投前「追踪与环境就绪」检查 —— 回执组装（平台通用）。
 *
 * 设计稿：docs/specs/2026-10-19-ads-tracking-preflight-workflow.md
 *
 * 🔴 平台通用：本文件不许出现客户名 / 客户 ID / 像素编号 / 域名。
 * 🔴 只读：回执里 no_publish 恒为 true。绿灯只是「该做的检查都过了」，不是发布 / 扣费授权。
 * 🔴 灰（没读到 / 没证据）永不等于绿，也不等于 0。
 */

import type { Light } from '@/lib/marketing-plan/promo/gates'
import { GATE_LABELS, overallLight, preconditionsMet } from './judge'
import type {
  TrackingClientReceipt,
  TrackingGateKey,
  TrackingGateReceipt,
  TrackingPhase,
  TrackingReadError,
  TrackingReceiptItem,
  TrackingRunReceipt,
  TrackingTrigger,
} from './types'

/** cron_run_logs 里这一轮检查的任务名。 */
export const TRACKING_PREFLIGHT_JOB = 'ads-tracking-preflight'

/** 回执超过这么多小时就算过期，页面上要提示重跑。 */
export const TRACKING_RECEIPT_STALE_HOURS = 36

/** 每道门「不处理会怎样」：给非技术的产品经理看，一句话说清代价。 */
export const GATE_IMPACT: Record<TrackingGateKey, string> = {
  'tracking.account_dataset_aligned': '广告账户、官网和 ME 回传各记各的数据集，转化会记到别处，广告优化拿不到',
  'tracking.pixel_alive': '开投后 Meta 收不到访客行为数据，广告没法自己优化，花的钱也衡量不了',
  'tracking.lead_event_seen': '广告带来的询盘 Meta 看不到，优化会瞎投',
  'tracking.lead_event_quality': '留资信号质量低，Meta 认不出是谁，优化变差',
  'tracking.ga4_events': 'GA4 里看不到询盘，报表对不上',
  'tracking.landing_ok': '广告点进去是坏页面或追踪丢了，钱白花',
  'tracking.lead_reaches_crm': '客人填了表但 CRM 里没有，没人跟进',
  'tracking.capi_ready': 'ME 往 Meta 回传成交会失败，广告学不到谁真买了',
  'env.token_and_crons': '令牌或同步任务出问题，线索和数据读不进来',
  'env.account_billing': '广告账户或付款有问题，投不出去或半路被停',
  'post.t1h': '开投 1 小时后数据不对，可能一直在白花钱',
  'post.t24h': '开投一天后数据不对，要尽快查',
}

const FALLBACK_HOW = '打开推广计划页，按页面上每一项后面的「怎么办」处理。'
const MAX_WHAT_LENGTH = 300

export interface ItemLinks {
  fallback: string
  byGate?: Partial<Record<TrackingGateKey, string>>
}

function needsItem(gate: TrackingGateReceipt): boolean {
  if (gate.na) return false
  if (gate.status === 'red') return true
  return gate.status === 'gray' && gate.hard === true
}

function itemWhat(gate: TrackingGateReceipt): string {
  const text = `${GATE_LABELS[gate.key]}：${gate.reason}。${GATE_IMPACT[gate.key]}`
  return text.length <= MAX_WHAT_LENGTH ? text : text.slice(0, MAX_WHAT_LENGTH)
}

export function buildReceiptItems(
  clientId: string,
  gates: readonly TrackingGateReceipt[],
  links: ItemLinks,
): TrackingReceiptItem[] {
  const items: TrackingReceiptItem[] = []
  for (const gate of gates) {
    if (!needsItem(gate)) continue
    items.push({
      client_id: clientId,
      gate_key: gate.key,
      hard: gate.hard,
      what: itemWhat(gate),
      how: gate.how.length > 0 ? gate.how : FALLBACK_HOW,
      href: links.byGate?.[gate.key] ?? links.fallback,
    })
  }
  return items
}

export function buildClientReceipt(input: {
  requestId: string
  clientId: string
  checkedAt: string
  trigger: TrackingTrigger
  phase: TrackingPhase
  gates: TrackingGateReceipt[]
  readErrors: TrackingReadError[]
  links: ItemLinks
  /** 开投后读回才传：开投时刻（ISO） */
  launchedAt?: string | null
}): TrackingClientReceipt {
  return {
    request_id: input.requestId,
    client_id: input.clientId,
    checked_at: input.checkedAt,
    trigger: input.trigger,
    phase: input.phase,
    launched_at: input.launchedAt ?? null,
    overall: overallLight(input.gates),
    preconditions_met: preconditionsMet(input.gates),
    gates: input.gates,
    items: buildReceiptItems(input.clientId, input.gates, input.links),
    read_errors: input.readErrors,
    no_publish: true,
  }
}

export function buildRunReceipt(input: {
  requestId: string
  checkedAt: string
  trigger: TrackingTrigger
  clients: TrackingClientReceipt[]
}): TrackingRunReceipt {
  const { clients } = input
  let status: TrackingRunReceipt['status'] = 'ok'
  let error: string | null = null

  if (clients.length === 0) {
    status = 'not_configured'
    error = '没有任何客户配置了开投前追踪检查，本轮什么都没查'
  } else {
    const partial = clients.filter(c => c.read_errors.length > 0).length
    if (partial > 0) {
      status = 'partial'
      error = `${partial} 个客户有一部分没读到，详见各客户回执`
    }
  }

  return {
    request_id: input.requestId,
    checked_at: input.checkedAt,
    status,
    error,
    no_publish: true,
    trigger: input.trigger,
    clients,
  }
}

// ─── 运行时校验（读回执的人不信数据库里的 JSON）──────────────────────────────

const LIGHTS: readonly Light[] = ['green', 'yellow', 'red', 'gray']
const RUN_STATUSES: readonly TrackingRunReceipt['status'][] = ['ok', 'partial', 'not_configured']

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isLight(value: unknown): value is Light {
  return typeof value === 'string' && (LIGHTS as readonly string[]).includes(value)
}

function isGateLike(value: unknown): boolean {
  if (!isObject(value)) return false
  return (
    typeof value.key === 'string' &&
    isLight(value.status) &&
    typeof value.hard === 'boolean' &&
    typeof value.reason === 'string' &&
    typeof value.how === 'string'
  )
}

function isItemLike(value: unknown): boolean {
  if (!isObject(value)) return false
  return (
    typeof value.client_id === 'string' &&
    typeof value.gate_key === 'string' &&
    typeof value.hard === 'boolean' &&
    typeof value.what === 'string' &&
    typeof value.how === 'string' &&
    typeof value.href === 'string'
  )
}

function isClientLike(value: unknown): boolean {
  if (!isObject(value)) return false
  return (
    typeof value.client_id === 'string' &&
    typeof value.checked_at === 'string' &&
    Array.isArray(value.gates) &&
    value.gates.every(isGateLike) &&
    Array.isArray(value.items) &&
    value.items.every(isItemLike) &&
    Array.isArray(value.read_errors)
  )
}

export function isTrackingRunReceiptLike(value: unknown): value is TrackingRunReceipt {
  if (!isObject(value)) return false
  return (
    typeof value.request_id === 'string' &&
    typeof value.checked_at === 'string' &&
    typeof value.status === 'string' &&
    (RUN_STATUSES as readonly string[]).includes(value.status) &&
    (value.error === null || typeof value.error === 'string') &&
    value.no_publish === true &&
    typeof value.trigger === 'string' &&
    Array.isArray(value.clients) &&
    value.clients.every(isClientLike)
  )
}

// ─── 从 cron_run_logs 里挑最新一份含该客户的「开投前」回执 ─────────────────────

/**
 * 🔴 只认开投前体检（phase === 'preflight'）。开投后读回（post_t1h / post_t24h）和体检写在同一个
 * 任务名下，但它只有一道门：不挑阶段的话，读回会把早上的红灯待办顶掉、推广计划看板的十道门全灰，
 * 36 小时「回执过期」的判据也会被读回刷新。
 */
export function pickLatestClientReceipt(
  rows: readonly { status: string | null; started_at: string; summary: unknown }[],
  clientId: string,
): { receipt: TrackingClientReceipt; started_at: string } | null {
  for (const row of rows) {
    if (row.status === 'running') continue
    if (!isTrackingRunReceiptLike(row.summary)) continue
    const receipt = row.summary.clients.find(c => c.client_id === clientId && c.phase === 'preflight')
    if (receipt) return { receipt, started_at: row.started_at }
  }
  return null
}

export function receiptAgeHours(checkedAt: string, now: Date): number | null {
  const ms = Date.parse(checkedAt)
  if (Number.isNaN(ms)) return null
  return (now.getTime() - ms) / 3_600_000
}
