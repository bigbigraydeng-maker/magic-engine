/**
 * 笔记里 AI 读出来的「回电时间」，必须在员工原话里有依据（2026-11-15）。
 *
 * 事故（CTS，PM 11-15）：员工只写「please follow up 2027 catalogue」「I will follow up Best of China 13 May departure」，
 * AI 却排出了 11-16 / 11-13 / 11-15 …… 的回电，进了日历和「今天要联系」。11-10 起 35 条回电里 25 条不是员工约的：
 * 拿团的出发日（13 May）、天数（15 day tour）当回电日期，或者干脆编；还有 5 条早于笔记本身的时间。
 *
 * 做法（确定性的后验，不再信模型自觉）：从原话里自己找「回电时间表达」，AI 给的日子必须落在其中之一：
 *   · 相对说法：明天 / today / tonight / 周五 / next Thursday / in three weeks (from 4 Nov)；
 *   · 具体日期：18 or 19 Nov、11月18日。**团的出发日不算**（后面跟 departure / 出发 的日期整段拿掉），
 *     也不算离笔记超过 60 天的日期（跟「约回电」按钮同一条上限；那都是出发日）；
 *   · 原话里有相对说法，就以它为准、不看具体日期（员工常把月份打错：「tomorrow morning 14 May」）。
 * 原话里没有任何回电时间 → 置空（「有下一步」仍然成立，客人还在跟进名单里，只是不排具体时间）。
 * AI 给的日子对不上、但原话里只有一个说法 → 改成原话的那一天，时刻取原话里说的（没说就 09:00）。
 * 最后：回电早于这条笔记的时间 → 置空。
 *
 * 只依赖纯字符串和时区换算，不碰网络。员工点「约回电」按钮的路径不经过这里。
 */

import { localCalendarDate, localWallToInstant } from './callback-pick'

export const MAX_NOTE_CALLBACK_AHEAD_DAYS = 60
const DAY_MS = 86_400_000

interface Ymd {
  y: number
  m: number
  d: number
}

const MONTH_ALT =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'
const MONTH_ALT_NO_MAY = MONTH_ALT.replace('|may|', '|')
const MONTH_NUM: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 }
const WEEKDAYS: Array<[RegExp, number]> = [
  [/\bmon(?:day)?\b|周一|星期一|礼拜一/gi, 1],
  [/\btue(?:s|sday)?\b|周二|星期二|礼拜二/gi, 2],
  [/\bwed(?:nesday)?\b|周三|星期三|礼拜三/gi, 3],
  [/\bthu(?:r|rs|rsday)?\b|周四|星期四|礼拜四/gi, 4],
  [/\bfri(?:day)?\b|周五|星期五|礼拜五/gi, 5],
  [/\bsat(?:urday)?\b|周六|星期六|礼拜六/gi, 6],
  [/\bsun(?:day)?\b|周日|周天|星期日|星期天|礼拜天/gi, 0],
]

const ORD = '(?:st|nd|rd|th)?'
/** 「13 May 2027 departure」「departure 13 May」：这是团的出发日，不是回电。 */
const DEPARTURE_AFTER = new RegExp(`\\d{1,2}\\s*${ORD}\\s*(?:${MONTH_ALT})\\b(?:\\s*,?\\s*\\d{4})?\\s*[(\\-–,]?\\s*(?:dep\\w*|decat\\w*|出发)`, 'gi')
const DEPARTURE_BEFORE = new RegExp(`(?:dep\\w*|出发)\\s*(?:date|on|:)?\\s*\\d{1,2}\\s*${ORD}\\s*(?:${MONTH_ALT})\\b(?:\\s*,?\\s*\\d{4})?`, 'gi')

const dayNumber = (x: Ymd): number => Math.floor(Date.UTC(x.y, x.m - 1, x.d) / DAY_MS)
const keyOf = (x: Ymd): string => `${x.y}-${x.m}-${x.d}`

function addDays(x: Ymd, n: number): Ymd {
  const t = new Date(Date.UTC(x.y, x.m - 1, x.d + n))
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}

function monthOf(token: string): number {
  return MONTH_NUM[token.slice(0, 3).toLowerCase()] ?? 0
}

/** 没写年份的日期：取离笔记当天最近、不早于一周前的那一天。 */
function inferDate(m: number, d: number, today: Ymd): Ymd | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const cand = { y: today.y, m, d }
  return dayNumber(cand) < dayNumber(today) - 7 ? { ...cand, y: today.y + 1 } : cand
}

function relativeDays(note: string, today: Ymd, explicit: readonly Ymd[]): Ymd[] {
  const out: Ymd[] = []
  const t = note.replace(/day\s+after\s+tomorrow|后天/gi, () => {
    out.push(addDays(today, 2))
    return ' '
  })
  if (/\btomorrow\b|明天|明早|明晚/i.test(t)) out.push(addDays(today, 1))
  if (/\btoday\b|\btonight\b|今天|今晚|今早/i.test(t)) out.push(today)
  const weekday = new Date(Date.UTC(today.y, today.m - 1, today.d)).getUTCDay()
  for (const [re, w] of WEEKDAYS) {
    if (!new RegExp(re.source, 'i').test(t)) continue
    // 原话同时写了星期和日期、并且对得上（「10 月 31 日（周六）」）：就是那一天，哪怕就是今天；对不上才按「下一个这个星期几」。
    const same = explicit.find((x) => dayNumber(x) >= dayNumber(today) && new Date(Date.UTC(x.y, x.m - 1, x.d)).getUTCDay() === w)
    out.push(same ?? addDays(today, ((w - weekday + 6) % 7) + 1))
  }
  return out
}

function inNUnits(note: string, today: Ymd): Ymd[] {
  const out: Ymd[] = []
  const en = new RegExp(`\\bin\\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve|\\d{1,2})\\s*(day|week)s?(?:\\s+from\\s+(\\d{1,2})\\s*${ORD}\\s*(${MONTH_ALT})\\b)?`, 'gi')
  for (const hit of note.matchAll(en)) {
    const n = NUMBER_WORDS[hit[1].toLowerCase()] ?? Number(hit[1])
    const base = hit[3] ? inferDate(monthOf(hit[4]), Number(hit[3]), today) : today
    if (base && n > 0) out.push(addDays(base, hit[2].toLowerCase() === 'week' ? n * 7 : n))
  }
  for (const hit of note.matchAll(/(\d{1,2})\s*(?:天|周|个?星期)后/g)) {
    const n = Number(hit[1])
    out.push(addDays(today, /天/.test(hit[0]) ? n : n * 7))
  }
  return out
}

function explicitDates(note: string, today: Ymd): Ymd[] {
  const cleaned = note.replace(DEPARTURE_AFTER, ' ').replace(DEPARTURE_BEFORE, ' ')
  const out: Ymd[] = []
  const push = (m: number, d: number, year?: number): void => {
    const x = year ? { y: year, m, d } : inferDate(m, d, today)
    if (x && m >= 1 && m <= 12 && d >= 1 && d <= 31) out.push(x)
  }
  const dayFirst = new RegExp(`(\\d{1,2})${ORD}(?:\\s*(?:or|and|/|,)\\s*(\\d{1,2})${ORD})?\\s*(?:of\\s+)?(${MONTH_ALT})\\b(?:\\s*,?\\s*(\\d{4}))?`, 'gi')
  for (const h of cleaned.matchAll(dayFirst)) {
    for (const d of [h[1], h[2]]) if (d) push(monthOf(h[3]), Number(d), h[4] ? Number(h[4]) : undefined)
  }
  const monthFirst = new RegExp(`\\b(${MONTH_ALT_NO_MAY})\\s*(\\d{1,2})${ORD}\\b`, 'gi')
  for (const h of cleaned.matchAll(monthFirst)) push(monthOf(h[1]), Number(h[2]))
  for (const h of cleaned.matchAll(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/g)) push(Number(h[1]), Number(h[2]))
  return out
}

const CN_DIGIT: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

/** 「三」「十」「十一」「十二」→ 3 / 10 / 11 / 12。 */
function chineseHour(t: string): number {
  if (t === '十') return 10
  if (t.startsWith('十')) return 10 + (CN_DIGIT[t[1]] ?? 0)
  if (t.endsWith('十')) return (CN_DIGIT[t[0]] ?? 0) * 10
  return CN_DIGIT[t] ?? -1
}

function clockOf(note: string): { h: number; m: number } {
  const ampm = /(\d{1,2})(?:[:.](\d{2}))?\s*([ap])\.?\s?m\b/i.exec(note)
  if (ampm) {
    const h = Number(ampm[1]) % 12 + (ampm[3].toLowerCase() === 'p' ? 12 : 0)
    return { h, m: Number(ampm[2] ?? 0) }
  }
  const hhmm = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(note)
  if (hhmm) return { h: Number(hhmm[1]), m: Number(hhmm[2]) }
  const cn = /(\d{1,2}|[零〇一二两三四五六七八九十]{1,3})\s*点(?:半)?/.exec(note)
  if (cn) {
    const n = /^\d+$/.test(cn[1]) ? Number(cn[1]) : chineseHour(cn[1])
    const pm = /下午|晚上|傍晚|今晚|明晚/.test(note) && n < 12
    if (n >= 0 && n <= 23) return { h: pm ? n + 12 : n, m: /半/.test(cn[0]) ? 30 : 0 }
  }
  if (/afternoon|下午/i.test(note)) return { h: 14, m: 0 }
  if (/evening|tonight|晚上|今晚|明晚/i.test(note)) return { h: 18, m: 0 }
  return { h: 9, m: 0 }
}

/** 只说了钟点没说哪天（「下午三点联系」「十一点」「5pm」）：指今天或明天。 */
const CLOCK_CUE_RE =
  /\b\d{1,2}\s*(?:am|pm)\b|\b\d{1,2}[:.]\d{2}\b|\d{1,2}\s*点|[零〇一二两三四五六七八九十]{1,3}点|[点:：]\d|上午|下午|早上|晚上|中午|傍晚|\bafternoon\b|\bevening\b|\bmorning\b/i

/** 原话里「回电时间」的候选日子（当地日历日），已去掉过去的和超过 60 天的。 */
export function callbackDayCandidates(note: string, today: Ymd): Ymd[] {
  const explicit = explicitDates(note, today)
  const relative = [...relativeDays(note, today, explicit), ...inNUnits(note, today)]
  const dated = relative.length > 0 ? relative : explicit
  const clockOnly = dated.length === 0 && CLOCK_CUE_RE.test(note) ? [today, addDays(today, 1)] : []
  const pool = [...dated, ...clockOnly]
  const lo = dayNumber(today)
  const seen = new Set<string>()
  return pool
    .filter((x) => dayNumber(x) >= lo && dayNumber(x) <= lo + MAX_NOTE_CALLBACK_AHEAD_DAYS)
    .filter((x) => (seen.has(keyOf(x)) ? false : (seen.add(keyOf(x)), true)))
    .sort((a, b) => dayNumber(a) - dayNumber(b))
}

export interface CallbackGroundingContext {
  /** 这条笔记记下的时间（解析发生在记笔记时，就是「现在」）。 */
  now: Date
  timeZone: string
}

/** AI 读出的回电时刻是否站得住；站不住就置空，只有一个说法对不上时改成原话那一天。 */
export function groundCallbackAt(note: string, aiCallback: string | null, ctx: CallbackGroundingContext): string | null {
  if (!aiCallback) return null
  const ai = new Date(aiCallback)
  if (Number.isNaN(ai.getTime())) return null
  const today = localCalendarDate(ctx.now, ctx.timeZone)
  const days = callbackDayCandidates(note, { y: today.y, m: today.m, d: today.d })
  if (days.length === 0) return null
  const aiDay = localCalendarDate(ai, ctx.timeZone)
  const matches = days.some((x) => keyOf(x) === keyOf({ y: aiDay.y, m: aiDay.m, d: aiDay.d }))
  let result = ai
  if (!matches) {
    const { h, m } = clockOf(note)
    const first = days[0]
    result = localWallToInstant(first.y, first.m, first.d, h, m, ctx.timeZone)
  }
  return result.getTime() < ctx.now.getTime() ? null : result.toISOString()
}
