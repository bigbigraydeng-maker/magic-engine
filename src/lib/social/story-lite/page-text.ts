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

/** Counts of one week's Story items, per line, for the headline. */
export interface StoryTally {
  total: number
  /** The database says SENT (not checked against the platform). */
  recordedSent: number
  /** Time has passed but nothing went out (still PENDING, or MISSED). */
  overdue: number
  /** Still waiting for its time. */
  waiting: number
  /** Blocked, failed or unsure: a person must look. */
  blocked: number
  /** PENDING but the week was stopped or expired: will not be sent. */
  stopped: number
  /** PENDING in a week nobody has authorised yet: will not be sent until someone authorises it. */
  unauthorised: number
}

/** A Story is only called "past its time" after this grace period, so a slot that is just about to go out is not reported as missed. */
export const OVERDUE_GRACE_MS = 10 * 60 * 1000

export function tallyStoryItems(
  items: ReadonlyArray<{ status: LiteItemStatus; slot_at: string }>,
  packState: LitePackState,
  now: Date,
): StoryTally {
  const tally: StoryTally = { total: items.length, recordedSent: 0, overdue: 0, waiting: 0, blocked: 0, stopped: 0, unauthorised: 0 }
  const stoppedPack = packState === 'REVOKED' || packState === 'EXPIRED'
  for (const item of items) {
    if (item.status === 'SENT') {
      tally.recordedSent += 1
    } else if (item.status === 'BLOCKED' || item.status === 'FAILED' || item.status === 'UNKNOWN_OUTCOME') {
      tally.blocked += 1
    } else if (item.status === 'MISSED') {
      tally.overdue += 1
    } else if (stoppedPack) {
      tally.stopped += 1
    } else if (packState === 'DRAFT') {
      tally.unauthorised += 1
    } else {
      const slot = new Date(item.slot_at).getTime()
      if (!Number.isNaN(slot) && slot + OVERDUE_GRACE_MS < now.getTime()) tally.overdue += 1
      else tally.waiting += 1
    }
  }
  return tally
}

/** One line for the Story headline. Only appends the stopped part when stopped > 0. */
export function describeStoryHeadline(tally: StoryTally): string {
  if (tally.total === 0) return 'Story：本周没有排 Story'
  const parts = [
    `Story：本周 ${tally.total} 条`,
    `库里记为已发 ${tally.recordedSent}`,
    `已过点没发出 ${tally.overdue}`,
    `待发 ${tally.waiting}`,
    `被拦 ${tally.blocked}`,
  ]
  if (tally.stopped > 0) parts.push(`已停或授权过期不会发 ${tally.stopped}`)
  if (tally.unauthorised > 0) parts.push(`还没授权，不会发 ${tally.unauthorised}`)
  return parts.join(' · ')
}

/** Text for one Story item on the overview. */
export function describeOverviewItemStatus(
  status: LiteItemStatus,
  packState: LitePackState,
  slotAt: string,
  now: Date,
): string {
  if (status === 'SENT') return '库里记为已发'
  const stoppedPack = packState === 'REVOKED' || packState === 'EXPIRED'
  if (status === 'PENDING' && !stoppedPack && packState !== 'DRAFT') {
    const slot = new Date(slotAt).getTime()
    if (!Number.isNaN(slot) && slot + OVERDUE_GRACE_MS < now.getTime()) return '已过点，没发出（库里仍是待发）'
  }
  return describeItemStatusInPack(status, packState)
}

/** Statuses whose database record says the video was uploaded; none of them has been checked against the platform. */
const RECORDED_UPLOADED_STATUSES = ['published', 'measuring', 'closed']

/** The database says this Reel was uploaded (not checked against the platform). One definition for the headline and every row. */
export function isRecordedUploaded(reel: { status: string; published_at: string | null }): boolean {
  return reel.published_at !== null || RECORDED_UPLOADED_STATUSES.includes(reel.status)
}

/** What the database says about a Reel's upload state, in plain words; null when it was never uploaded. */
export function describeReelUploadState(reel: { status: string; published_at: string | null; video_state?: 'DRAFT' | 'PUBLISHED' | null }): string | null {
  if (!isRecordedUploaded(reel)) return null
  if (reel.video_state === 'DRAFT') return 'Facebook 草稿，未公开'
  if (reel.video_state === 'PUBLISHED') return '已公开（Facebook）'
  return '库里记为已上传 · 平台状态未核'
}

/** Reel headline. */
export function describeReelHeadline(reels: ReadonlyArray<{ status: string; published_at: string | null; video_state?: 'DRAFT' | 'PUBLISHED' | null }>): string {
  if (reels.length === 0) return 'Reel：现在没有可看的 Reel'
  const inReview = reels.filter((r) => r.status === 'in_review').length
  const uploaded = reels.filter(isRecordedUploaded)
  const drafts = uploaded.filter((r) => r.video_state === 'DRAFT').length
  const published = uploaded.filter((r) => r.video_state === 'PUBLISHED').length
  const unknown = uploaded.length - drafts - published
  return `Reel：在审 ${inReview} · Facebook 草稿 ${drafts} · 已公开 ${published} · 库里记为已上传但平台状态未核 ${unknown}`
}

/** The read-only variety hint line. Never blocks anything. */
export function describeVarietyLine(variety: {
  same_track_max: number
  price_screen_count: number
  total: number
}): { text: string; warn: boolean } {
  if (variety.total === 0) return { text: '最近的 Reel：没有 Reel，不统计', warn: false }
  const track = variety.same_track_max > 0 ? `同一首 BGM 最多出现 ${variety.same_track_max} 次` : 'BGM 未读到'
  // a tiny batch must not light the warning on its own: the price-screen share needs at least 4 Reels to mean anything
  const warn = variety.same_track_max >= 2 || (variety.total >= 4 && variety.price_screen_count * 3 > variety.total)
  const suffix = warn ? '（规则见放行规则文档）' : ''
  return { text: `最近 ${variety.total} 条 Reel：${track}；价格屏 ${variety.price_screen_count}/${variety.total}${suffix}`, warn }
}
