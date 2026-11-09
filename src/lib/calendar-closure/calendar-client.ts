/**
 * Google Calendar 只读事件读取器（L3）——「给一个日历 ID + 一个新西兰日期，读回窗口内的事件」。
 *
 * 鉴权走服务账号（`GOOGLE_SERVICE_ACCOUNT_CREDENTIALS`），**不做域委派**：
 * 目标日历（默认 PM 的 `hello@magicengine.cloud`）是直接分享给这个服务账号的，
 * 所以 JWT 的 `sub` 就是服务账号自己（见 `mintServiceAccountToken`）。
 *
 * 不认识任何客户语义：不知道哪条事件该不该出待办、哪条已经关掉。那些判断属于调用方
 * （`calendar-closure-audit` 的核对逻辑），不该下沉到这里。
 *
 * 只读：这里只有 GET，没有任何写路径。
 */

import { loadServiceAccount, mintServiceAccountToken } from '@/lib/google-oauth/service-account'
import { shiftDate } from '@/lib/ledger/walk'
import { CALENDAR_TIMEZONE, PM_CALENDAR_ID, STALE_LOOKBACK_DAYS, type CalendarEvent } from './types'

export const CALENDAR_READONLY_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3/calendars'

/** 单次请求最多拉多少条；配合分页最多 5 页，够覆盖 14 天窗口。 */
const MAX_RESULTS = 250
/** 最多翻多少页；再多说明窗口配错了，宁可报错也不无限翻。 */
const MAX_PAGES = 5

export class CalendarReadError extends Error {
  constructor(
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message)
    this.name = 'CalendarReadError'
  }
}

export class CalendarNotConfiguredError extends Error {
  constructor() {
    super(
      '没有配置 GOOGLE_SERVICE_ACCOUNT_CREDENTIALS —— 日历读取需要服务账号，' +
        '且目标日历要分享给这个服务账号',
    )
    this.name = 'CalendarNotConfiguredError'
  }
}

export interface CalendarReadResult {
  events: CalendarEvent[]
  /** 第一页顶层返回的 etag/updated，用来证明这次不是缓存 */
  proof: { etag: string | null; updated: string | null }
}

/** Google Calendar API 返回的事件形状（只声明我们读的字段）。 */
interface CalendarApiEvent {
  id?: string
  status?: string
  summary?: string
  description?: string
  htmlLink?: string
  etag?: string
  updated?: string
  start?: { date?: string; dateTime?: string }
  creator?: { self?: boolean }
  organizer?: { self?: boolean }
  attendees?: { self?: boolean; responseStatus?: string }[]
}

interface CalendarApiResponse {
  etag?: string
  updated?: string
  nextPageToken?: string
  items?: CalendarApiEvent[]
}

/**
 * ISO 瞬时时间 -> 新西兰日期 `YYYY-MM-DD`。
 * 用 `en-CA` 是因为它的日期格式天然就是 `YYYY-MM-DD`，不用自己拼。
 */
export function toNzDate(dateTime: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CALENDAR_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(dateTime))
}

/**
 * 读窗口内的事件。窗口是 `[todayNz - 15 天, todayNz + 1 天]`（含两端），
 * 用 UTC 边界包住整个新西兰日，宁可多读几条也不漏。
 *
 * `opts.token` 给了就直接用（测试/复用），否则现铸一个服务账号 token。
 * 服务账号没配 -> `CalendarNotConfiguredError`；换 token 失败 -> `CalendarReadError(401, ...)`。
 */
export async function readCalendarEvents(opts: {
  todayNz: string
  calendarId?: string
  fetcher?: typeof fetch
  token?: string
}): Promise<CalendarReadResult> {
  const fetcher = opts.fetcher ?? fetch
  const calendarId = opts.calendarId ?? PM_CALENDAR_ID

  let token = opts.token
  if (!token) {
    const creds = loadServiceAccount()
    if (!creds) throw new CalendarNotConfiguredError()
    try {
      token = await mintServiceAccountToken(creds, CALENDAR_READONLY_SCOPE, { fetcher })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new CalendarReadError(401, `服务账号换 token 失败: ${message}`)
    }
  }

  const timeMin = `${shiftDate(opts.todayNz, -(STALE_LOOKBACK_DAYS + 1))}T00:00:00Z`
  const timeMax = `${shiftDate(opts.todayNz, 1)}T23:59:59Z`

  const events: CalendarEvent[] = []
  let proof: CalendarReadResult['proof'] = { etag: null, updated: null }
  let pageToken: string | undefined
  let page = 0

  while (true) {
    if (page >= MAX_PAGES) {
      throw new CalendarReadError(0, '事件过多，超过 5 页')
    }

    const params = new URLSearchParams({
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: String(MAX_RESULTS),
      timeZone: CALENDAR_TIMEZONE,
      timeMin,
      timeMax,
    })
    if (pageToken) params.set('pageToken', pageToken)

    const url = `${CALENDAR_API_BASE}/${encodeURIComponent(calendarId)}/events?${params.toString()}`

    let res: Response
    try {
      res = await fetcher(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new CalendarReadError(0, `Calendar API 请求失败: ${message}`)
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new CalendarReadError(res.status, `Calendar API 读取失败 (${res.status}): ${body.slice(0, 200)}`)
    }

    const json = (await res.json()) as CalendarApiResponse

    if (page === 0) {
      proof = { etag: json.etag ?? null, updated: json.updated ?? null }
    }

    for (const item of json.items ?? []) {
      if (item.status === 'cancelled') continue
      // 只收 PM 自己日历创建的事件：别人发来的邀请（标题可被陌生人随便写）不进巡检，也就不会进今日待办
      if (item.creator?.self !== true && item.organizer?.self !== true) continue
      if (item.attendees?.some((a) => a.self === true && a.responseStatus === 'declined')) continue

      const startNz = item.start?.date ?? (item.start?.dateTime ? toNzDate(item.start.dateTime) : null)
      if (!startNz) continue

      events.push({
        id: item.id ?? '',
        title: item.summary ?? '',
        description: item.description ?? '',
        startNz,
        htmlLink: item.htmlLink ?? '',
        etag: item.etag ?? null,
        updated: item.updated ?? null,
      })
    }

    page += 1
    if (!json.nextPageToken) break
    pageToken = json.nextPageToken
  }

  return { events, proof }
}
