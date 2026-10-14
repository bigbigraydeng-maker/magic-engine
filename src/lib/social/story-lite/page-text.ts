/**
 * Story "lite" — plain-Chinese wording for the preview page. Pure functions, no I/O.
 * The page never shows codes, hashes or table words: every code maps to a sentence a PM can act on.
 */
import type { LitePackState } from './service'
import type { LiteItemStatus } from './types'

const PROBLEM_TEXT: Record<string, string> = {
  NOT_PENDING: '这条已经处理过了，不能再授权',
  CHANNEL_NOT_SUPPORTED: '这个渠道现在还不能自动发（目前只支持 Facebook）',
  SLOT_IN_PAST: '计划发布时间已经过了',
  SLOT_AFTER_EXPIRY: '计划发布时间晚于授权的有效期，到时候发不出',
  ACCOUNT_MISMATCH: '要发的主页和客户登记的主页对不上',
  PRICE_IN_TEXT: '文字里出现了价格，Story 不放价格，请先改掉',
  FILE_CHANGED: '图片和当初登记的不一样了，请重新确认图片',
  FILE_UNREACHABLE: '现在打不开这张图片，请检查图片链接',
  VIDEO_NOT_ACCEPTABLE: '这个视频不合要求（要 1 到 60 秒、竖屏、宽至少 540 像素、能正常打开），请让视频工厂重新出片',
  CLIENT_NOT_ACTIVE: '这个客户现在不是启用状态',
  PACK_NOT_DRAFT: '这一周已经授权过或已经停掉了',
}

export function describeProblem(code: string): string {
  return PROBLEM_TEXT[code] ?? '这一条有问题，先别授权，请找开发看一下'
}

const ITEM_STATUS_TEXT: Record<LiteItemStatus, string> = {
  PENDING: '等待发布',
  CLAIMED: '正在发布',
  SENT: '已发出',
  UNKNOWN_OUTCOME: '不确定有没有发出去，请到 Facebook 主页核对',
  FAILED: '发布失败',
  BLOCKED: '检查没通过，没发',
  MISSED: '错过了时间，没发',
}

export function describeItemStatus(status: LiteItemStatus): string {
  return ITEM_STATUS_TEXT[status]
}

const PACK_STATE_TEXT: Record<LitePackState, string> = {
  DRAFT: '还没授权',
  AUTHORIZED: '已授权',
  REVOKED: '已停掉',
  EXPIRED: '授权已过期',
}

export function describePackState(state: LitePackState): string {
  return PACK_STATE_TEXT[state]
}

export interface ModeBanner {
  tone: 'rehearsal' | 'live'
  headline: string
  detail: string
}

export function describeMode(live: boolean): ModeBanner {
  if (live) {
    return {
      tone: 'live',
      headline: '真发已开：授权后，到点会真的发到 Facebook 主页',
      detail: '点「停」可以随时停下还没发的；已经发出去的不会撤回，需要的话要到 Facebook 主页手动删除。',
    }
  }
  return {
    tone: 'rehearsal',
    headline: '演练模式：不会真发',
    detail: '现在点授权只是记下你同意，系统到点只会检查、不会发出任何内容。注意：授权在有效期内一直算数，之后一旦开启真发，没发的内容会自动发出，不用再授权一次。',
  }
}

const NZ_ZONE = 'Pacific/Auckland'

/** e.g. "10月14日 周三 09:00"（新西兰时间）. Unreadable input is shown as-is, never invented. */
export function formatSlot(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: NZ_ZONE,
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('month')}月${get('day')}日 ${get('weekday')} ${get('hour')}:${get('minute')}`
}

/** "共 5 条，10月14日 周三 09:00 到 10月20日 周二 18:00（新西兰时间）"; empty list says so. */
export function describeRange(slots: string[]): string {
  const times = slots.map((s) => Date.parse(s)).filter((t) => !Number.isNaN(t))
  if (times.length === 0) return '这一周里还没有 Story'
  const first = formatSlot(new Date(Math.min(...times)).toISOString())
  const last = formatSlot(new Date(Math.max(...times)).toISOString())
  return `共 ${slots.length} 条，${first} 到 ${last}（新西兰时间）`
}

/** Item status line: a story that was never sent shows what the week's state means for it. */
export function describeItemStatusInPack(status: LiteItemStatus, packState: LitePackState): string {
  if (status === 'PENDING' && packState === 'REVOKED') return '已停，不会发'
  if (status === 'PENDING' && packState === 'EXPIRED') return '授权已过期，不会发'
  return describeItemStatus(status)
}

/** What the page says after the authorise / stop call came back with an error code. */
const ACTION_ERROR_TEXT: Record<string, string> = {
  GLOBAL_ADMIN_REQUIRED: '只有管理员能授权',
  PACK_CHANGED_SINCE_PREVIEW: '你看过之后这一周的内容被改过了，页面已刷新，请重新看一遍再授权',
  PACK_NOT_AUTHORIZABLE: '这一周现在不能授权，请看上面标出的问题',
  ALREADY_AUTHORIZED: '这一周已经授权过了',
  PACK_REVOKED: '这一周已经停掉了',
  NOTHING_TO_REVOKE: '这一周已经停过了',
}

export function describeActionError(code: string): string {
  return ACTION_ERROR_TEXT[code] ?? '没成功，请刷新页面再试；还不行就找开发'
}

/** What the page says right after 「停」, from the stop result. Never claims "all stopped" while something is unsettled. */
export function describeStopResult(title: string, sentCount: number, inFlightCount: number, summaryAvailable = true): string {
  const parts = [`已停「${title}」这一周，这一周还没发的不会再发。`]
  if (!summaryAvailable) {
    parts.push('但现在读不到哪些已经发出去了，不确定有没有已发出的，请到 Facebook 主页核对，已发出的要手动删除。')
    return parts.join('')
  }
  if (sentCount > 0) parts.push(`已经发出去的 ${sentCount} 条不会撤回，需要的话请到 Facebook 主页手动删除。`)
  if (inFlightCount > 0) parts.push(`另有 ${inFlightCount} 条正在发或不确定有没有发出去，请到 Facebook 主页核对，已发出的要手动删除。`)
  return parts.join('')
}

/**
 * A small picture for the page's thumbnail. Supabase storage can resize on the fly (about 70 KB instead of 2-3 MB);
 * any other address is returned as is. The caller falls back to the original if the small one fails to load.
 */
export function thumbnailUrl(url: string): string {
  const marker = '/storage/v1/object/public/'
  const at = url.indexOf(marker)
  if (at < 0 || url.includes('?')) return url
  return `${url.slice(0, at)}/storage/v1/render/image/public/${url.slice(at + marker.length)}?width=180&height=320&resize=cover&quality=60`
}

/** New Zealand calendar date of an instant, "2026-10-14"; unreadable input comes back as "" (never invented). */
export function nzDateKey(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', { timeZone: NZ_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

/** "10月14日 周三" for a "YYYY-MM-DD" New Zealand date key. */
export function describeNzDay(dateKey: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  if (!match) return dateKey
  const noon = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12))
  const weekday = new Intl.DateTimeFormat('zh-CN', { timeZone: 'UTC', weekday: 'short' }).format(noon)
  return `${Number(match[2])}月${Number(match[3])}日 ${weekday}`
}

/** "08:30" in New Zealand time; unreadable input is shown as-is. */
export function formatClock(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat('zh-CN', { timeZone: NZ_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
}
