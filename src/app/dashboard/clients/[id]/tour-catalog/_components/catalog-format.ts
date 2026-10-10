/** Shared wording and small formatters for the tour-catalog admin page. */

import type { CatalogDepartureView } from './types'

/** 接口错误码的中文说法。未知的码原样显示。 */
export const ERROR_LABELS: Record<string, string> = {
  feed_not_configured: '这家客户的网站还没有开通团数据读取，请联系开发',
  client_domain_missing: '这家客户的档案里还没有登记网站，请先在客户设置里填上网站',
  catalog_load_failed: '服务器暂时读不到数据，请点重试；还不行请联系开发',
  feed_unavailable: '网站暂时读取不到',
  conflict: '撤销失败：导入之后又有人改过这些班期，为避免覆盖已拒绝撤销',
  not_applicable: '这次导入现在不能撤销',
  alias_not_found: '这个叫法已经不存在了',
  alias_failed: '删除失败，请稍后重试',
}

/** "2026-10-10T00:26:16+13:00" -> "10月10日 00:26" in the viewer's local time; raw text if unparseable. */
export function formatBatchTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function errorLabel(code: string): string {
  return ERROR_LABELS[code] ?? code
}

/** 班期状态的中文说法。 */
export const DEPARTURE_STATUS_LABELS: Record<string, string> = {
  open: '可订',
  limited: '少量余位',
  sold_out: '已满团',
  closed: '已关闭',
  cancelled: '已取消',
}

/** Shown after any save that only touches the draft. */
export const SAVED_AS_DRAFT_TEXT = '已存为草稿，客人还看不到'

/** 导入记录状态的中文说法。 */
export const BATCH_STATUS_LABELS: Record<string, string> = {
  previewed: '只预览未导入',
  applied: '已导入到草稿',
  rolled_back: '已撤销',
  rejected: '已作废',
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/** 即将出发 = 出团日不早于今天,且状态是可订 / 少量余位。 */
export function upcomingCount(departures: CatalogDepartureView[]): number {
  const today = todayIso()
  return departures.filter(
    d => d.departOn >= today && (d.status === 'open' || d.status === 'limited'),
  ).length
}

/** 展示价文案：没价显示「未定价」，含 TBC 显示「价格待定」，否则原样显示。 */
export function priceText(displayPriceText: string | null): string {
  if (!displayPriceText) return '未定价'
  if (displayPriceText.toUpperCase().includes('TBC')) return '价格待定'
  return displayPriceText
}
