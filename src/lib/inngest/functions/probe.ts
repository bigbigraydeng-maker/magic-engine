/**
 * Magic Engine 2.0 · Inngest 云端探针函数（Issue #1346）
 *
 * 🔴 **只用来证明「接收半边真的通了」**：Inngest 云端把事件投递到本应用的
 *    `/api/inngest` 端点 → 本函数被执行 → 返回一条 receipt。它**没有任何副作用**：
 *    不调 provider、不写库、不发布、不花钱。验收看的是「Inngest 有没有真的执行它、
 *    留下 receipt」，不是「有没有断言函数存在」（声明了≠接上了）。
 *
 * 🔴 **专属探针事件，不复用真实业务事件**：主应用发的 `daily_plan.publish_queue.ready`
 *    已被本机内容工厂 worker 消费。若探针也听同一事件，云端会再消费一份 → 同一事件两处
 *    执行，正是要防的平行系统（子牙复审必改项）。故探针用**没有别人监听**的专属事件
 *    `cloud/probe.ping`（见 client.ts 的 WORKER_OWNED_EVENTS 与 route 契约测试）。
 *
 * 🔴 **fail-closed 参考形态**：探针本身无副作用，但演示真实消费者必须遵守的形态 ——
 *    缺关键字段就短路返回 `ok:false`，绝不「缺了当默认值继续」。#1347 的真实消费者
 *    在此形态基础上加预算闸 + 授权事件校验（传输层只给 5 分钟重放窗口、无去重，靠不住）。
 */

import { inngest, CLOUD_FN_PREFIX } from '../client'

/** 专属探针事件名 —— 无其它函数监听。 */
export const CLOUD_PROBE_PING_EVENT = 'cloud/probe.ping'

/**
 * 判定一条探针 payload 是否可受理（fail-closed）。抽出来供直测。
 * 🔴 source_id 必须是非空字符串；eventTs 必须是**有限正数**（0 / 负数不是真实事件时间，拒）。
 */
export function probeReceiptFor(
  data: unknown,
  eventTs: number | undefined,
): { ok: true; source_id: string; received_ts: number; app: string } | { ok: false; reason: string } {
  const source =
    data && typeof data === 'object' && 'source_id' in data
      ? (data as { source_id?: unknown }).source_id
      : undefined
  if (typeof source !== 'string' || source.trim().length === 0) {
    return { ok: false, reason: 'missing_source_id' }
  }
  if (typeof eventTs !== 'number' || !Number.isFinite(eventTs) || eventTs <= 0) {
    return { ok: false, reason: 'missing_event_ts' }
  }
  return { ok: true, source_id: source, received_ts: eventTs, app: 'magic-engine-web' }
}

export const probePing = inngest.createFunction(
  { id: `${CLOUD_FN_PREFIX}probe-ping-receipt`, name: 'Cloud probe: ping → receipt (no side effects)' },
  { event: CLOUD_PROBE_PING_EVENT },
  async ({ event }) => probeReceiptFor(event.data, event.ts),
)
