/**
 * 素材推广期（promo window）纯函数。
 *
 * 视频画面可能烧入出发日期/价格，过期不许再推。这里只做解析与判定，
 * 不碰数据库、不发请求。日期一律是新西兰（Pacific/Auckland）的 YYYY-MM-DD。
 */

export type PromoWindow =
  | { kind: 'dated'; start: string; end: string } // YYYY-MM-DD，新西兰日期，end 含当天
  | { kind: 'evergreen' } // 明确声明：视频里没有日期/价格

export type PromoVerdict = 'ok' | 'undeclared' | 'not_started' | 'expired' | 'expires_before_use_end'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 严格校验 YYYY-MM-DD 是否为真实存在的日历日期（2026-02-30 不行）。 */
function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  if (month < 1 || month > 12) return false
  if (day < 1 || day > 31) return false
  const ms = Date.UTC(year, month - 1, day)
  const d = new Date(ms)
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
}

/** 只允许这些键；出现任何别的键一律拒。 */
function hasOnlyKeys(obj: Record<string, unknown>, allowed: readonly string[]): boolean {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) return false
  }
  return true
}

/**
 * 严格解析推广期。
 * 缺失、形状不对、日期非法一律返回 null（= 未声明，不是 evergreen）。
 */
export function parsePromoWindow(raw: unknown): PromoWindow | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>

  const kind = obj.kind
  if (kind === 'evergreen') {
    if (!hasOnlyKeys(obj, ['kind'])) return null
    return { kind: 'evergreen' }
  }

  if (kind === 'dated') {
    if (!hasOnlyKeys(obj, ['kind', 'start', 'end'])) return null
    const start = obj.start
    const end = obj.end
    if (typeof start !== 'string' || typeof end !== 'string') return null
    if (!isRealDate(start) || !isRealDate(end)) return null
    if (start > end) return null
    return { kind: 'dated', start, end }
  }

  return null
}

/** Pacific/Auckland 的今天，YYYY-MM-DD。 */
export function nzToday(nowMs: number): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = fmt.formatToParts(new Date(nowMs))
  let year = ''
  let month = ''
  let day = ''
  for (const part of parts) {
    if (part.type === 'year') year = part.value
    else if (part.type === 'month') month = part.value
    else if (part.type === 'day') day = part.value
  }
  return `${year}-${month}-${day}`
}

/**
 * 判定推广期。顺序不许变：
 * undeclared → evergreen ok → expired → not_started → expires_before_use_end → ok。
 */
export function promoVerdict(
  window: PromoWindow | null | undefined,
  today: string,
  use?: { start: string; end: string },
): PromoVerdict {
  if (window === null || window === undefined) return 'undeclared'
  if (window.kind === 'evergreen') return 'ok'

  if (today > window.end) return 'expired'
  if ((use?.start ?? today) < window.start) return 'not_started'
  if (use !== undefined && use.end > window.end) return 'expires_before_use_end'
  return 'ok'
}

export interface PoolEntryLike {
  ref: string
  alias_refs?: string[]
  promo_window?: PromoWindow
}

export type PoolMatch = { kind: 'found'; entry: PoolEntryLike } | { kind: 'none' } | { kind: 'ambiguous' }

/**
 * 在素材池里按精确 id 匹配。命中条件：ref === videoId 或 alias_refs 包含 videoId。
 * 绝不按名字/时长猜。0 条 → none；恰好 1 条 → found；≥2 条不同条目 → ambiguous。
 */
export function matchPoolEntry<T extends PoolEntryLike>(
  pool: readonly T[],
  videoId: string,
): { kind: 'found'; entry: T } | { kind: 'none' } | { kind: 'ambiguous' } {
  const hits: T[] = []
  for (const entry of pool) {
    const refHit = entry.ref === videoId
    const aliasHit = Array.isArray(entry.alias_refs) && entry.alias_refs.includes(videoId)
    if (!refHit && !aliasHit) continue
    if (!hits.includes(entry)) hits.push(entry)
  }
  if (hits.length === 0) return { kind: 'none' }
  if (hits.length === 1) return { kind: 'found', entry: hits[0] }
  return { kind: 'ambiguous' }
}

/** 每个视频 id 一条判定；none / ambiguous 一律 undeclared、entryRef null。 */
export function videoVerdicts<T extends PoolEntryLike>(
  pool: readonly T[],
  videoIds: readonly string[],
  today: string,
  use?: { start: string; end: string },
): Array<{ videoId: string; verdict: PromoVerdict; entryRef: string | null }> {
  const out: Array<{ videoId: string; verdict: PromoVerdict; entryRef: string | null }> = []
  for (const videoId of videoIds) {
    const match = matchPoolEntry(pool, videoId)
    if (match.kind === 'found') {
      out.push({
        videoId,
        verdict: promoVerdict(match.entry.promo_window, today, use),
        entryRef: match.entry.ref,
      })
    } else {
      out.push({ videoId, verdict: 'undeclared', entryRef: null })
    }
  }
  return out
}

const VERDICT_RANK: Record<PromoVerdict, number> = {
  expired: 0,
  undeclared: 1,
  expires_before_use_end: 2,
  not_started: 3,
  ok: 4,
}

/** 取最坏的一条；空数组返回 'ok'。 */
export function worstVerdict(verdicts: readonly PromoVerdict[]): PromoVerdict {
  let worst: PromoVerdict = 'ok'
  for (const v of verdicts) {
    if (VERDICT_RANK[v] < VERDICT_RANK[worst]) worst = v
  }
  return worst
}

/** 从 'GMT+13:00' / 'GMT-05:30' / 'GMT' 解析出分钟偏移。 */
function parseOffsetMinutes(offset: string): number {
  if (offset === 'GMT' || offset === 'UTC') return 0
  const m = /^(?:GMT|UTC)([+-])(\d{2}):(\d{2})$/.exec(offset)
  if (!m) return 0
  const sign = m[1] === '-' ? -1 : 1
  const hours = Number(m[2])
  const minutes = Number(m[3])
  return sign * (hours * 60 + minutes)
}

const NZ_OFFSET_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Pacific/Auckland',
  timeZoneName: 'longOffset',
})

/** 某个时刻新西兰相对 UTC 的偏移（分钟）。 */
function nzOffsetMinutesAt(ms: number): number {
  let offset = 'GMT'
  for (const part of NZ_OFFSET_FMT.formatToParts(new Date(ms))) {
    if (part.type === 'timeZoneName') offset = part.value
  }
  return parseOffsetMinutes(offset)
}

/**
 * 该新西兰日期 23:59:59 对应的 epoch 毫秒。
 * 🔴 偏移要取「那个本地时刻」的，不是 UTC 当天 23:59:59 那一刻的：夏令时切换日两者差一小时，
 *    所以先用 UTC 时刻估一次，再用估出的时刻重取一次偏移。
 */
export function endOfNzDayMs(day: string): number {
  const year = Number(day.slice(0, 4))
  const month = Number(day.slice(5, 7))
  const date = Number(day.slice(8, 10))
  const naive = Date.UTC(year, month - 1, date, 23, 59, 59)
  const first = naive - nzOffsetMinutesAt(naive) * 60 * 1000
  return naive - nzOffsetMinutesAt(first) * 60 * 1000
}

/** 所有命中且为 dated 的视频里，最早的 end 对应的 endOfNzDayMs；没有 dated 返回 null。 */
export function promoEndCapMs<T extends PoolEntryLike>(
  pool: readonly T[],
  videoIds: readonly string[],
): number | null {
  let earliestEnd: string | null = null
  for (const videoId of videoIds) {
    const match = matchPoolEntry(pool, videoId)
    if (match.kind !== 'found') continue
    const window = match.entry.promo_window
    if (!window || window.kind !== 'dated') continue
    if (earliestEnd === null || window.end < earliestEnd) earliestEnd = window.end
  }
  if (earliestEnd === null) return null
  return endOfNzDayMs(earliestEnd)
}
