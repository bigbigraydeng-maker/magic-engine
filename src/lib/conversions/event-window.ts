/**
 * 广告平台「只收 N 天内的事件」这条时间窗口的唯一判定口径（2026-09-26）。
 *
 * 🔴 按**精确时间**算，不按「第几天」取整：Meta 拒收 event_time 早于发送时刻 7×24 小时
 *    的事件（见 `src/lib/meta/capi/writer.ts` 顶部引用的官方原文）。原来 AI 审核、今日待办、
 *    审核看板三处用 `Math.floor(天数) > 7`，距今 7.0–7.99 天的行被当成「还没过期」——
 *    AI 审核把它们交给模型，模型对「第 7 天算不算」拿不准，全判 uncertain，
 *    CTS 因此 2026-09-19 被 `uncertain_backlog` 熔断自动暂停（27 条 uncertain 理由全是这一句）。
 *
 * 这个文件不引任何服务端模块——审核看板是 'use client' 组件，也要 import 它
 * （同 `money.ts`；别把 writer 拉进浏览器 bundle，见 dashboard/conversions/page.tsx 的注释）。
 */

export const DAY_MS = 86_400_000

/** Meta Conversions API 的窗口天数。跟 `metaCapiWriter.maxEventAgeDays` 同一个数。 */
export const META_EVENT_WINDOW_DAYS = 7

/**
 * AI 自动审核「批准」前留的余量：离过期不到 1 小时的，不批了，直接判过期。
 *
 * 为什么要余量：每天流水线用开跑那一刻的时间做判断、分块跑，真正发送用的是真实时间，
 * 中间可能隔几十分钟。批准时还差几分钟到 7 天，发送时就过了——结果是「批了但发不出去」。
 * 发送那一步（`writeback-service.ts`）仍按零余量的精确窗口做最终把关，余量只影响 AI 批不批。
 */
export const APPROVAL_SAFETY_MARGIN_MS = 60 * 60 * 1000

function toMs(t: Date | number): number {
  return typeof t === 'number' ? t : t.getTime()
}

/** 事件发生到 `now` 过了多少毫秒。 */
export function eventAgeMs(occurredAt: string, now: Date | number): number {
  return toMs(now) - new Date(occurredAt).getTime()
}

/** 已经超出平台窗口——现在发，平台一定拒收。跟发送前最终把关同一口径。 */
export function isPastEventWindow(
  occurredAt: string,
  now: Date | number,
  windowDays: number = META_EVENT_WINDOW_DAYS,
): boolean {
  return eventAgeMs(occurredAt, now) > windowDays * DAY_MS
}

/** 已过期或离过期不到余量——AI 自动审核不再批准，也不再问模型，直接判过期。 */
export function isTooLateToApprove(
  occurredAt: string,
  now: Date | number,
  windowDays: number = META_EVENT_WINDOW_DAYS,
): boolean {
  return eventAgeMs(occurredAt, now) > windowDays * DAY_MS - APPROVAL_SAFETY_MARGIN_MS
}

/**
 * `isTooLateToApprove()` 的数据库查询版分界线：`occurred_at` **早于**这个时刻的行
 * 就是「来不及批了」的行（`.lt('occurred_at', cutoff)`），不早于的就还来得及。
 */
export function approvalCutoffIso(now: Date | number, windowDays: number = META_EVENT_WINDOW_DAYS): string {
  return new Date(toMs(now) - (windowDays * DAY_MS - APPROVAL_SAFETY_MARGIN_MS)).toISOString()
}
