/**
 * Magic Engine 2.0 · Inngest 云端消费者：GEO 自动重测（Issue #1347 · 切片 3a · 骨架）
 *
 * 🔴 **本切片 (3a) 是骨架，不真调 provider、不自动触发**：
 *      · 无 cron trigger —— 只监听显式发出的 `geo/remeasure.due` 事件。3b 才加定时扫描。
 *      · `runBatchStub` 是**未实装 stub** —— 任何被路由到本函数的事件，会走
 *        authorize → runBatchStub throws → runner 返回 batch_failed → settle actual=0
 *        释放预留。链路真通，但**不会花任何钱**。
 *      · 合并 3a 后不部署 cron、不接真 provider；即使有人手工发 due 事件，也只是 receipt 里
 *        多一条 batch_failed，不产生外部支出。
 *
 * 🔴 **平台事件归属（一事件一主，见 client.ts WORKER_OWNED_EVENTS）**：`geo/remeasure.due`
 *    是本云端 app 的专属事件 —— 本机 factory-worker 不监听、不消费。云端函数 id `cloud-` 前缀。
 *
 * 🔴 **单 step 装配（3a 的实际结构，非最终形态）**：`step.run(id, fn)` 把 authorize →
 *    measure → settle 装进**同一个** step，重试整条 run 时该 step 的返回值命中缓存不重跑。
 *    3a stub 场景下无害；3b 装真 provider 后必须拆成三段独立 step（`authorize` / `measure` /
 *    `settle`）并给 provider 请求带 `reservation_id` 派生的幂等键 —— 否则
 *    crash-after-provider-before-settle 会 provider 双花而账本记一笔。完整 3b 交接单见
 *    `src/lib/geo-remeasure/runner.ts` 的头部注释（子牙/狄仁杰/魏征 三审共识）。
 */

import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { createSupabaseGeoBudgetStore } from '@/lib/geo-remeasure/budget-store-supabase'
import { authorizeMeasureSettle, type RemeasureBatchRunner, type RemeasureBatchResult } from '@/lib/geo-remeasure/runner'
import type { GeoBudgetStore } from '@/lib/geo-remeasure/budget-ledger'

/** 云端专属事件名 —— 无其他 app / worker 监听（有契约测试锁死）。 */
export const GEO_REMEASURE_DUE_EVENT = 'geo/remeasure.due'

export interface GeoRemeasureDueData {
  readonly client_id: string
  readonly query_set_version: string
  readonly reservation_id: string
  readonly period_key: string
  readonly worst_case_usd: number
}

export type ParsedDue =
  | { readonly ok: true; readonly value: GeoRemeasureDueData }
  | { readonly ok: false; readonly reason: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PERIOD_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/ // 月份严格 01-12（S1 魏征 + §A 狄仁杰）

/** payload 校验（fail-closed）。抽出来供直测 —— 缺字段 / 类型不对 一律拒。 */
export function parseRemeasureDue(raw: unknown): ParsedDue {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'payload_not_object' }
  const d = raw as Record<string, unknown>
  if (typeof d.client_id !== 'string' || !UUID_RE.test(d.client_id)) return { ok: false, reason: 'invalid_client_id' }
  if (typeof d.query_set_version !== 'string' || d.query_set_version.trim().length === 0 || d.query_set_version.length > 128) return { ok: false, reason: 'invalid_query_set_version' }
  if (typeof d.reservation_id !== 'string' || d.reservation_id.trim().length === 0 || d.reservation_id.length > 128) return { ok: false, reason: 'invalid_reservation_id' }
  if (typeof d.period_key !== 'string' || !PERIOD_KEY_RE.test(d.period_key)) return { ok: false, reason: 'invalid_period_key' }
  if (typeof d.worst_case_usd !== 'number' || !Number.isFinite(d.worst_case_usd) || d.worst_case_usd <= 0) {
    return { ok: false, reason: 'invalid_worst_case_usd' }
  }
  return {
    ok: true,
    value: {
      client_id: d.client_id,
      query_set_version: d.query_set_version,
      reservation_id: d.reservation_id,
      period_key: d.period_key,
      worst_case_usd: d.worst_case_usd,
    },
  }
}

/**
 * 未实装 stub。切片 3b 会用真装配（openAiTransport + createGeoBaselineParser +
 * GeoSupabaseStore + loadFrozenQueryScope + buildFrozenPlan + runGeoMeasurementBatch）替换它。
 * 现在直接抛 —— runner 会走 batch_failed，settle 0 释放预留，绝不花钱。
 */
export const runBatchStub: RemeasureBatchRunner = async (): Promise<RemeasureBatchResult> => {
  throw new Error('geo_remeasure_not_implemented (slice_3a_stub — real provider assembly lands in slice 3b)')
}

/** 依赖注入版：便于集成测试直接注入假 budget / 假 runBatch。 */
export function createGeoRemeasureOneFunction(deps: {
  budget: GeoBudgetStore
  runBatch: RemeasureBatchRunner
}) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}geo-remeasure-one`,
      name: 'GEO remeasure one client (authorize → measure → settle)',
      // 🔴 同一客户串行：防重复投递把同一 client 在同一时刻并发跑（配合账本层的 reservationId
      //    幂等构成双层防线）。
      concurrency: { limit: 1, key: 'event.data.client_id' },
    },
    { event: GEO_REMEASURE_DUE_EVENT },
    async ({ event, step }) => {
      const parsed = parseRemeasureDue(event.data)
      if (!parsed.ok) return { kind: 'invalid_payload', reason: parsed.reason }
      const d = parsed.value
      const req = {
        reservationId: d.reservation_id,
        clientId: d.client_id,
        periodKey: d.period_key,
        worstCaseUsd: d.worst_case_usd,
      }
      // 🔴 3a 单 step 装配：authorize→measure→settle 打包成一个 durable 单元。
      //    3a stub 无害；**3b 必须拆三段** step 并配 provider 幂等键 —— 见 runner.ts 头部
      //    "3b 复审必须验证" 条款（三审共识）。step id 用 reservationId 保证重放击中同一 step。
      return await step.run(`remeasure-${d.reservation_id}`, async () =>
        authorizeMeasureSettle(req, deps.budget, deps.runBatch),
      )
    },
  )
}

/**
 * 生产实例（3a stub 版）：budget = Supabase 真 store（跨进程原子）；runBatch = stub。
 * 3b 上线前，本函数被路由到的任何事件都会**只走通链路、不花钱**。
 */
export const geoRemeasureOne = createGeoRemeasureOneFunction({
  budget: createSupabaseGeoBudgetStore(supabaseAdmin),
  runBatch: runBatchStub,
})
