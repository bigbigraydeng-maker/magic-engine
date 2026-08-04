/**
 * 把客户随口说的出行时间，变成系统能比较的日期。
 *
 * 为什么必须有这个：销售记下「明年三月」，系统存的就是这四个字。
 * 到了明年三月，没有任何东西会把这个人叫醒 —— 他会永远待在「以后才走」
 * 里，直到有人手工翻出来。CTS 现在 19 个人卡在这个状态，其中一位说的是
 * 「下个月左右」，那句话是上个月说的。
 *
 * 处理的真实原话（2026-07 从 CTS 库里抽的全集）：
 *   明年三月(5) · 明年(5) · 2027 年底 · 2027/2028 · 2026 年 11 月
 *   2027 年 5 月 · next year · 明年初 · 下个月左右 · 2026-10-15 · 2027 年三月
 *
 * 两条原则：
 *   1. 一律相对「说这句话的时间」算 —— 「明年」在 2026 年说和在 2027 年说
 *      不是同一年。所以 saidAt 必传。
 *   2. 认不出来就返回 null，绝不猜。猜错的代价是把人在错误的时间捞回名单，
 *      提前几个月打扰、或者晚了几个月错过 —— 都比「留在原地等人翻」更糟。
 */

/** 月份说法 → 月份数字（1-12）。中文数字、阿拉伯数字、英文都收。 */
const MONTHS: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6,
  七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

/** 一段时期在一年里落在哪个月（取该时期的头，宁可早联系也不要错过）。 */
const PERIOD_MONTH: Array<[RegExp, number]> = [
  [/年初|年头|开年|初$/, 1],
  [/上半年/, 1],
  [/年中/, 6],
  [/下半年/, 7],
  [/年底|年末|底$/, 11],
]

function clampMonth(m: number): number {
  return Math.min(12, Math.max(1, m))
}

/** UTC 月初。只精确到月 —— 客户说的本来就是月份粒度，装作知道哪一天是假精确。 */
function monthStart(year: number, month: number): Date {
  return new Date(Date.UTC(year, clampMonth(month) - 1, 1))
}

/**
 * 解析出行时间。
 *
 * @param raw   客户的原话（parseNote 存进 metadata.travel_window 的那一句）
 * @param saidAt 这句话是什么时候说的（触点的 occurred_at）
 * @returns 出行月份的月初（ISO），认不出来返回 null
 */
export function resolveTravelDate(raw: string | null | undefined, saidAt: Date): string | null {
  if (!raw) return null
  const s = String(raw).trim().toLowerCase()
  if (!s) return null

  const thisYear = saidAt.getUTCFullYear()
  const thisMonth = saidAt.getUTCMonth() + 1

  // 1) 完整日期："2026-10-15" / "2026/10/15"
  const iso = s.match(/(20\d{2})[-/](\d{1,2})(?:[-/](\d{1,2}))?/)
  if (iso) {
    const y = Number(iso[1])
    const m = Number(iso[2])
    if (m >= 1 && m <= 12) return monthStart(y, m).toISOString()
  }

  // 2) 明确年份："2027 年 5 月" / "2027 年底" / "2027/2028"（取头一年）
  const yearMatch = s.match(/(20\d{2})/)
  if (yearMatch) {
    const y = Number(yearMatch[1])

    // 年份后面跟月份："2026 年 11 月" / "2027 年三月"
    const after = s.slice(s.indexOf(yearMatch[1]) + 4)
    const numMonth = after.match(/(\d{1,2})\s*月/)
    if (numMonth) return monthStart(y, Number(numMonth[1])).toISOString()

    const cnMonth = after.match(/([一二三四五六七八九]|十[一二]?)\s*月/)
    if (cnMonth && MONTHS[cnMonth[1]]) return monthStart(y, MONTHS[cnMonth[1]]).toISOString()

    // 年份 + 时期："2027 年底"
    for (const [re, month] of PERIOD_MONTH) {
      if (re.test(s)) return monthStart(y, month).toISOString()
    }

    // 只给了年份 —— 保守取年初，宁可早点联系
    return monthStart(y, 1).toISOString()
  }

  // 3) 相对说法："明年三月" / "明年初" / "明年" / "next year"
  const nextYear = /明年|next\s*year/.test(s)
  const thisYearWord = /今年|this\s*year/.test(s)
  if (nextYear || thisYearWord) {
    const y = nextYear ? thisYear + 1 : thisYear

    const numMonth = s.match(/(\d{1,2})\s*月/)
    if (numMonth) return monthStart(y, Number(numMonth[1])).toISOString()

    const cnMonth = s.match(/([一二三四五六七八九]|十[一二]?)\s*月/)
    if (cnMonth && MONTHS[cnMonth[1]]) return monthStart(y, MONTHS[cnMonth[1]]).toISOString()

    const enMonth = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/)
    if (enMonth) return monthStart(y, MONTHS[enMonth[1]]).toISOString()

    for (const [re, month] of PERIOD_MONTH) {
      if (re.test(s)) return monthStart(y, month).toISOString()
    }

    // 只说了「明年」—— 取年初
    return monthStart(y, 1).toISOString()
  }

  // 4) 「下个月」「两个月后」「三周后」这类相对偏移
  const CN_NUM: Record<string, number> = {
    一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  }
  // 「三个月后」必须带「个」或「后」才算偏移 —— 否则「三月」（一个月份）
  // 会被当成「三个月后」，客户说三月走、系统给算成十月，差了半年。
  const monthOffset =
    s.match(/(?:(\d+)|([一两二三四五六七八九十]))\s*个\s*月/) ??
    s.match(/(?:(\d+)|([一两二三四五六七八九十]))\s*月\s*(?:后|之后)/)
  if (monthOffset) {
    const n = monthOffset[1] ? Number(monthOffset[1]) : CN_NUM[monthOffset[2]] ?? 0
    if (n > 0) {
      const d = new Date(saidAt.getTime())
      d.setUTCMonth(d.getUTCMonth() + n)
      return monthStart(d.getUTCFullYear(), d.getUTCMonth() + 1).toISOString()
    }
  }

  // 周没有这个歧义（没有「三周」当月份的说法）
  const weekOffset = s.match(/(?:(\d+)|([一两二三四五六七八九十]))\s*(?:个)?\s*(?:周|星期|礼拜)/)
  if (weekOffset) {
    const n = weekOffset[1] ? Number(weekOffset[1]) : CN_NUM[weekOffset[2]] ?? 0
    if (n > 0) {
      const d = new Date(saidAt.getTime())
      d.setUTCDate(d.getUTCDate() + n * 7)
      return monthStart(d.getUTCFullYear(), d.getUTCMonth() + 1).toISOString()
    }
  }
  if (/下个?月/.test(s)) {
    const d = new Date(saidAt.getTime())
    d.setUTCMonth(d.getUTCMonth() + 1)
    return monthStart(d.getUTCFullYear(), d.getUTCMonth() + 1).toISOString()
  }

  // 5) 只说了月份没说年："三月" / "11 月" —— 取下一个还没到的那个三月
  const bareNum = s.match(/^(\d{1,2})\s*月/)
  const bareCn = s.match(/^([一二三四五六七八九]|十[一二]?)\s*月/)
  const m = bareNum ? Number(bareNum[1]) : bareCn ? MONTHS[bareCn[1]] : 0
  if (m >= 1 && m <= 12) {
    const y = m >= thisMonth ? thisYear : thisYear + 1
    return monthStart(y, m).toISOString()
  }

  // 认不出来。宁可留在「以后才走」等人翻，也不要在错误的时间打扰客户。
  return null
}

/**
 * 提前多久把人捞回名单。
 *
 * 中国长线游客户通常提前 2–3 个月定行程，太早联系人还没想好、太晚位子没了。
 * 取 60 天：出行当月的前两个月开始跟。
 */
export const LEAD_DAYS = 60

/** 这个出行时间，现在该不该把人捞回名单了。 */
export function isDueToWake(travelAtIso: string | null | undefined, now: Date): boolean {
  if (!travelAtIso) return false
  const t = new Date(travelAtIso).getTime()
  if (Number.isNaN(t)) return false
  return t - LEAD_DAYS * 86_400_000 <= now.getTime()
}
