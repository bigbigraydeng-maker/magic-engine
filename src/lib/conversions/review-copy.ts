/**
 * 今日待办和成交核对页共用的客人称呼、天数、过期说明。
 * 两处各写一份时，邮件会说「7 天前」，页面却已经按精确时间把发送按钮关掉。
 */

import { formatMoney } from './money'
import { DAY_MS, META_EVENT_WINDOW_DAYS, eventAgeMs, isPastEventWindow } from './event-window'

export function displayCustomerFirst(name: string | null | undefined): string | null {
  const trimmed = name?.trim()
  if (!trimmed) return null
  return trimmed.replace(/\b\w/g, (c) => c.toUpperCase())
}

export function conversionAgeDays(occurredAt: string, now: Date | number): number {
  return Math.floor(eventAgeMs(occurredAt, now) / DAY_MS)
}

/** 和核对页同一句。未满 1 天写「今天」，否则写取整后的「N 天前」。 */
export function conversionAgeLabel(occurredAt: string, now: Date | number): string {
  if (eventAgeMs(occurredAt, now) < DAY_MS) return '今天'
  return `${conversionAgeDays(occurredAt, now)} 天前`
}

/** 核对页过期黄字。邮件里过了窗口的条目用同一句，不再另写「7 天前」。 */
export function conversionPastWindowNotice(days: number, windowDays: number = META_EVENT_WINDOW_DAYS): string {
  return `已过去 ${days} 天，广告平台只收 ${windowDays} 天内的 —— 现在发也收不进去，选「不发送」即可。`
}

/**
 * `isPastEventWindow()` 的查询分界：`occurred_at` 早于这个时刻的行，现在发平台一定拒收。
 * 列表用 `.gte(cutoff)` 留下还发得出去的；清理用 `.lt(cutoff)`。
 */
export function pastEventWindowCutoffIso(now: Date | number): string {
  const ms = typeof now === 'number' ? now : now.getTime()
  return new Date(ms - META_EVENT_WINDOW_DAYS * DAY_MS).toISOString()
}

type ReviewRow = {
  outcome_kind: 'purchase' | 'balance' | 'lead'
  customer_first: string | null
  amount_minor: number | null
  currency: string | null
  order_ref: string | null
  occurred_at: string
}

const STILL_IN_WINDOW_HOW =
  '打开页面，看一眼客人和金额对不对，对就点「告诉广告平台」（会再确认一次），不对就点「不发送」并选个原因。'

const PAST_WINDOW_HOW = '打开页面，在这条上点「不发送」并选原因「超过时限」即可。'

/** 今日待办一条「要不要告诉广告平台」的正文。称呼和过期句跟核对页同一份。 */
export function conversionReviewWhat(row: ReviewRow, now: Date): { what: string; how: string; expired: boolean } {
  const name = displayCustomerFirst(row.customer_first) ?? '这位客人'
  const expired = isPastEventWindow(row.occurred_at, now)
  if (expired) {
    return {
      expired: true,
      what: `${name}：⚠️ ${conversionPastWindowNotice(conversionAgeDays(row.occurred_at, now))}`,
      how: PAST_WINDOW_HOW,
    }
  }
  const when = conversionAgeLabel(row.occurred_at, now)
  if (row.outcome_kind === 'lead') {
    return {
      expired: false,
      what:
        `${name} ${when}来问过一次。要把「这是个真实咨询」告诉广告平台吗？` +
        '告诉后，平台会去找更多像他这样会主动来问的人；不告诉，平台只知道谁点了广告，不知道谁真的开口。',
      how: STILL_IN_WINDOW_HOW,
    }
  }
  const money = formatMoney(row.amount_minor, row.currency) ?? '一笔款'
  const kindWord = row.outcome_kind === 'balance' ? '付了尾款' : '付了定金'
  return {
    expired: false,
    what:
      `${name} ${when}${kindWord} ${money}${row.order_ref ? `（单号 ${row.order_ref}）` : ''}。` +
      '要把这笔成交告诉广告平台吗？' +
      '告诉后，平台会去找更多像他这样真会掏钱的人，同样的预算能带回更多真客户；' +
      '不告诉，平台会继续找那些爱填表但不付钱的人。',
    how: STILL_IN_WINDOW_HOW,
  }
}
