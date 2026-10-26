/** Shared wording and small formatters for the tour-catalog admin page. */

import type { CatalogDepartureView } from './types'

/** 接口错误码的中文说法。未知的码显示成一句通用的话,不把英文码露给使用者。 */
export const ERROR_LABELS: Record<string, string> = {
  feed_not_configured: '这家客户的网站还没有开通团数据读取，请联系开发',
  client_domain_missing: '这家客户的档案里还没有登记网站，请先在客户设置里填上网站',
  catalog_load_failed: '服务器暂时读不到数据，请点重试；还不行请联系开发',
  feed_unavailable: '网站暂时读取不到',
  conflict: '撤销失败：导入之后又有人改过这些班期，为避免覆盖已拒绝撤销',
  not_applicable: '这次导入现在不能撤销',
  alias_not_found: '这个叫法已经不存在了',
  alias_failed: '删除失败，请稍后重试',
  feed_missing_content_fields:
    '官网现在给出的团数据还不完整（没有图片和简介），先不读入。等官网更新后再试，否则读进来会缺内容',
  catalog_not_empty: '目录里已经有团了，不能再整份读入',
}

/** "2026-10-10T00:26:16+13:00" -> "10月10日 00:26" in the viewer's local time; raw text if unparseable. */
export function formatBatchTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** "2026-10-10T03:30:00Z" -> "2026年10月10日 16:30" in the viewer's local time; raw text if unparseable. */
export function formatDateTimeWithYear(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${date.getFullYear()}年${formatBatchTime(value)}`
}

/** Shown instead of a raw code the page has no wording for. */
export const UNKNOWN_ERROR_TEXT = '服务器暂时没有回应，请稍后再试'

export function errorLabel(code: string): string {
  return ERROR_LABELS[code] ?? UNKNOWN_ERROR_TEXT
}

export const ASSISTANT_LIMIT_TEXT = '今天的 AI 助手次数用完了，明天再用，或者直接手动修改。'

/** Plain-Chinese sentence for a failed AI assistant call; never the raw code. */
export function assistantErrorLabel(code: string | undefined, status: number): string {
  if (status === 429 || code === 'assistant_limit') return ASSISTANT_LIMIT_TEXT
  if (code === 'assistant_truncated') return '这个改动太长，AI 一次没写完，请拆成几步再说'
  return 'AI 助手暂时用不了，请稍后再试'
}

/** 班期状态的中文说法。 */
export const DEPARTURE_STATUS_LABELS: Record<string, string> = {
  open: '可订',
  limited: '少量余位',
  sold_out: '已满团',
  closed: '已关闭',
  cancelled: '已取消',
}

/** Shown after any save that only touches the draft (wording while channels read the published catalog). */
export const SAVED_AS_DRAFT_TEXT = '已存为草稿，客人还看不到'
/** Same moment, while nothing reads the catalog yet: do not talk about what customers see. */
export const SAVED_AS_DRAFT_TEXT_UNCONNECTED = '已存为草稿，还没上架'

export function savedAsDraftText(channelsConnected: boolean): string {
  return channelsConnected ? SAVED_AS_DRAFT_TEXT : SAVED_AS_DRAFT_TEXT_UNCONNECTED
}

export function departureAddedText(channelsConnected: boolean): string {
  return channelsConnected ? '已新增到草稿，客人还看不到' : '已新增到草稿，还没上架'
}

/** Always shown under a price input, so the accepted way of writing is known before saving. */
export const PRICE_HINT_TEXT = '写法例：From NZD $4,999 per person；还没定写 TBC'

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

/** Plain-Chinese sentence for one AI-proposal warning; unknown codes get a generic line, never raw fields. */
export function proposalWarningText(warning: { code: string } & Record<string, unknown>): string {
  if (warning.code === 'itinerary_shrinks') {
    return `行程会从 ${String(warning.from)} 天减到 ${String(warning.to)} 天，后面的天会被删掉。确定吗？`
  }
  if (warning.code === 'itinerary_mostly_changed') {
    return `行程里 ${String(warning.total)} 天有 ${String(warning.changed)} 天标题都变了，像是换成了别的行程，请仔细核对。`
  }
  if (warning.code === 'itinerary_extras_unmatched') {
    const days = Array.isArray(warning.days) ? warning.days.join('、') : ''
    return `第 ${days} 天的住宿和节日标记对不上原来的行程，没有自动带过来，请逐天确认。`
  }
  return '这条修改有需要留意的地方，请仔细核对。'
}
