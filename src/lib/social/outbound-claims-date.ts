/** Date and duration detection for the outbound claim scanner. */

import {
  type ClaimHit,
  CN_NUM_CHARS,
  pad2,
  parseChineseNumber,
} from './outbound-claims-core'

/* ------------------------------------------------------------------ */
/* Date detection                                                      */
/* ------------------------------------------------------------------ */

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
}


function parseCnDay(dStr: string): number | null {
  if (/^\d+$/.test(dStr)) return Number(dStr)
  // 廿 = 20, 卅 = 30, with optional trailing digit: 廿五 = 25, 卅一 = 31
  const m = dStr.match(/^([廿卅])(.*)$/)
  if (m) {
    const base = m[1] === '廿' ? 20 : 30
    if (m[2] === '') return base
    const rest = parseChineseNumber(m[2])
    if (rest === null || rest < 1 || rest > 9) return null
    return base + rest
  }
  return parseChineseNumber(dStr)
}

function parseCnMonthDay(mStr: string, dStr: string): { m: number; d: number } | null {
  const m = /^\d+$/.test(mStr) ? Number(mStr) : parseChineseNumber(mStr)
  const d = parseCnDay(dStr)
  if (m === null || d === null) return null
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return { m, d }
}

export function detectDate(text: string, hits: ClaimHit[]): void {
  let m: RegExpExecArray | null

  // YYYY年M月D日/号
  const cnFull = /(\d{4})\s{0,3}年\s{0,3}(\d{1,2}|[一二三四五六七八九十]{1,12})\s{0,3}月\s{0,3}(\d{1,2}|[一二三四五六七八九十廿卅]{1,12})\s{0,3}[日号]/g
  while ((m = cnFull.exec(text)) !== null) {
    const md = parseCnMonthDay(m[2], m[3])
    if (md) hits.push({ kind: 'date', match: m[0], value: `${m[1]}-${pad2(md.m)}-${pad2(md.d)}` })
  }

  // YYYY/M/D, YYYY-M-D, YYYY.M.D
  const numericFull = /(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/g
  while ((m = numericFull.exec(text)) !== null) {
    const mo = Number(m[2])
    const d = Number(m[3])
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      hits.push({ kind: 'date', match: m[0], value: `${m[1]}-${pad2(mo)}-${pad2(d)}` })
    }
  }

  // M月D日/号 (no year)
  const cnShort = /(\d{1,2}|[一二三四五六七八九十]{1,12})\s{0,3}月\s{0,3}(\d{1,2}|[一二三四五六七八九十廿卅]{1,12})\s{0,3}[日号]/g
  while ((m = cnShort.exec(text)) !== null) {
    const md = parseCnMonthDay(m[1], m[2])
    if (md) hits.push({ kind: 'date', match: m[0], value: `${pad2(md.m)}-${pad2(md.d)}` })
  }

  // M月D with no day suffix, only when followed by a departure/deadline marker
  const cnNoSuffix = /(\d{1,2}|[一二三四五六七八九十]{1,12})\s{0,3}月\s{0,3}(\d{1,2}|[一二三四五六七八九十廿卅]{1,12})(?=\s{0,3}(?:出发|截止|前|止|至|到|开团|报名)|$)/g
  while ((m = cnNoSuffix.exec(text)) !== null) {
    const md = parseCnMonthDay(m[1], m[2])
    if (md) hits.push({ kind: 'date', match: m[0], value: `${pad2(md.m)}-${pad2(md.d)}` })
  }

  // English: 'dec 31', '16 november 2026', '31 dec', 'dec. 31st', '31st of december'
  const monthNames = Object.keys(MONTHS).join('|')
  const enMonthDay = new RegExp(`\\b(${monthNames})\\.?\\s{1,3}(\\d{1,2})(?:st|nd|rd|th)?(?:\\s{0,3},?\\s{0,3}(\\d{4}))?\\b`, 'gi')
  while ((m = enMonthDay.exec(text)) !== null) {
    const mo = MONTHS[m[1].toLowerCase()]
    const d = Number(m[2])
    if (mo && d >= 1 && d <= 31) {
      const value = m[3] ? `${m[3]}-${pad2(mo)}-${pad2(d)}` : `${pad2(mo)}-${pad2(d)}`
      hits.push({ kind: 'date', match: m[0], value })
    }
  }
  const enDayMonth = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s{1,3}(?:of\\s{1,3})?(${monthNames})\\.?(?:\\s{0,3},?\\s{0,3}(\\d{4}))?\\b`, 'gi')
  while ((m = enDayMonth.exec(text)) !== null) {
    const mo = MONTHS[m[2].toLowerCase()]
    const d = Number(m[1])
    if (mo && d >= 1 && d <= 31) {
      const value = m[3] ? `${m[3]}-${pad2(mo)}-${pad2(d)}` : `${pad2(mo)}-${pad2(d)}`
      hits.push({ kind: 'date', match: m[0], value })
    }
  }

  // English relative dates
  const enRelative = /\b(tomorrow|day after tomorrow|next (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month|year)|this (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend)|end of (?:the )?(?:month|year)|christmas|easter|new year)\b/gi
  while ((m = enRelative.exec(text)) !== null) {
    hits.push({ kind: 'date', match: m[0] })
  }

  // Numeric day/month without year: A[./-]B, only near a marker word.
  const numericShort = /(\d{1,2})\s{0,3}([./-])\s{0,3}(\d{1,2})/g
  while ((m = numericShort.exec(text)) !== null) {
    const a = Number(m[1])
    const b = Number(m[3])
    const matchText = m[0]
    const before = text.slice(Math.max(0, m.index - 1), m.index)
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 3)
    const markerAfter = /^\s*(?:出发|截止|前|止|开团|报名|号|日)/.test(after)
    const markerBefore = /[至到于在自从由]$/.test(before)
    if (!markerAfter && !markerBefore) continue
    const push = (mo: number, d: number) => {
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        hits.push({ kind: 'date', match: matchText, value: `${pad2(mo)}-${pad2(d)}` })
      }
    }
    if (a > 12 && b <= 12) push(b, a)
    else if (a <= 12 && b > 12) push(a, b)
    else if (a <= 12 && b <= 12) {
      push(a, b)
      push(b, a)
    }
  }

  // Day-first / labelled numeric dates: A/B/YYYY, A/B/YY, and labelled A/B.
  const dayFirstFull = /(?<!\d)(\d{1,2})\s{0,3}([/.\-])\s{0,3}(\d{1,2})\s{0,3}\2\s{0,3}(\d{4}|\d{2})(?!\d)/g
  while ((m = dayFirstFull.exec(text)) !== null) {
    const a = Number(m[1])
    const b = Number(m[3])
    let year = m[4]
    if (year.length === 2) year = `20${year}`
    const push = (mo: number, d: number) => {
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        hits.push({ kind: 'date', match: m![0], value: `${year}-${pad2(mo)}-${pad2(d)}` })
      }
    }
    if (a > 12 && b <= 12) push(b, a)
    else if (a <= 12 && b > 12) push(a, b)
    else if (a <= 12 && b <= 12) {
      push(b, a)
      push(a, b)
    }
  }

  // Labelled A/B or A.B with no year: 出发日期：12.25, 日期：25/12, 报名截止：12/20
  const DATE_LABELS = '出发日期|报名截止|截止日期|出发|日期|截止|开团|返程|回程|起飞'
  const labelledShort = new RegExp(`(?:${DATE_LABELS})\\s{0,3}[:：]?\\s{0,3}(\\d{1,2})\\s{0,3}([/.])\\s{0,3}(\\d{1,2})`, 'g')
  while ((m = labelledShort.exec(text)) !== null) {
    const a = Number(m[1])
    const b = Number(m[3])
    const push = (mo: number, d: number) => {
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        hits.push({ kind: 'date', match: m![0], value: `${pad2(mo)}-${pad2(d)}` })
      }
    }
    if (a > 12 && b <= 12) push(b, a)
    else if (a <= 12 && b > 12) push(a, b)
    else if (a <= 12 && b <= 12) {
      push(a, b)
      push(b, a)
    }
  }

  // Month word followed by 初/底/中/份
  const monthPart = /(\d{1,2}|[一二三四五六七八九十]{1,12})\s{0,3}月\s{0,3}(?:初|底|中|份)/g
  while ((m = monthPart.exec(text)) !== null) {
    hits.push({ kind: 'date', match: m[0] })
  }

  // Day-only: 20号出发 / 二十号出发 / 15日截止, only near a marker.
  const dayOnly = /(?<![0-9])(\d{1,2}|[二三]?十[一二三四五六七八九]?|廿[一二三四五六七八九]?|卅[一]?)\s{0,1}[号日]/g
  while ((m = dayOnly.exec(text)) !== null) {
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 2)
    const before = text.slice(Math.max(0, m.index - 2), m.index)
    if (/^(?:楼|线|路|层|室|座|栋|排|号)/.test(after)) continue
    if (/月\s?$/.test(before)) continue // the day belongs to a month-day date handled above
    const markerAfter = /^(?:出发|截止|前|到期|报名|开团|起)/.test(after)
    const markerBefore = /(?:在|于|到|至|从|自|由)$/.test(before)
    if (markerAfter || markerBefore) hits.push({ kind: 'date', match: m[0] })
  }

  // Month-only: 11月出发 / 十二月出发 / 2026年11月
  const monthOnly = /(\d{1,2}|十[一二]?|[一二三四五六七八九])\s{0,3}月/g
  while ((m = monthOnly.exec(text)) !== null) {
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 3)
    const before = text.slice(Math.max(0, m.index - 5), m.index)
    const dayFollows = /^\s{0,3}(?:\d{1,2}|[二三]?十[一二三四五六七八九]?|廿[一二三四五六七八九]?|卅一?|[一二三四五六七八九])\s{0,1}[日号]/.test(text.slice(m.index + m[0].length, m.index + m[0].length + 6))
    if (dayFollows) continue
    if (/^(?:出发|截止|前|报名|开团|份)/.test(after) || after === '' || /年$/.test(before)) {
      hits.push({ kind: 'date', match: m[0] })
    }
  }

  // English: 'the 20th', 'on friday'
  const enTheDay = /\bthe\s{1,3}(\d{1,2})(?:st|nd|rd|th)\b/gi
  while ((m = enTheDay.exec(text)) !== null) {
    hits.push({ kind: 'date', match: m[0] })
  }
  const enOnDay = /\bon\s{1,3}(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi
  while ((m = enOnDay.exec(text)) !== null) {
    hits.push({ kind: 'date', match: m[0] })
  }

  // Relative dates
  const relative = /(下周|下星期|下个月|下个周|这周末|这个周末|下周末|本周|这周|月底|月初|月中|年底|年初|上旬|中旬|下旬|明年|本月|下月|国庆|春节|圣诞|元旦|中秋|后天|大后天)/g
  while ((m = relative.exec(text)) !== null) {
    hits.push({ kind: 'date', match: m[0] })
  }

  // 明天 only when it is a departure/deadline
  const tomorrow = /明天(?=\s*(?:出发|出行|开团|截止|报名|起))/g
  while ((m = tomorrow.exec(text)) !== null) {
    hits.push({ kind: 'date', match: m[0] })
  }

  // (周|星期)X出发
  const weekday = /(?:周|星期)[一二三四五六日天]\s*(?:出发|报名|截止)/g
  while ((m = weekday.exec(text)) !== null) {
    hits.push({ kind: 'date', match: m[0] })
  }
}

/* ------------------------------------------------------------------ */
/* Duration detection                                                  */
/* ------------------------------------------------------------------ */

export function detectDuration(text: string, hits: ClaimHit[]): void {
  // Cheap guard: if none of the duration trigger characters appear, skip the
  // (bounded but still non-trivial) patterns entirely.
  if (!/[天日晚夜周星期礼拜小时个月工作日dn]/.test(text)) return

  const num = `(?:\\d{1,6}|[${CN_NUM_CHARS}]{1,12})`
  const patterns = [
    `${num}\\s{0,3}天\\s{0,3}${num}\\s{0,3}[晚夜]`,
    `${num}\\s{0,3}日\\s{0,3}${num}\\s{0,3}[夜晚]`,
    `${num}\\s{0,3}日游`,
    `${num}\\s{0,3}天\\s{0,3}[内后]`,
    `${num}\\s{0,3}个工作日`,
    `${num}\\s{0,3}小时\\s{0,3}[内后]`,
    `${num}\\s{0,3}周(?:行程)?`,
    `${num}\\s{0,3}个?\\s{0,3}(?:星期|礼拜)`,
    `${num}\\s{0,3}个月`,
    `${num}\\s{0,3}个半月`,
    `${num}\\s{0,3}小时`,
    `半\\s{0,3}个月`,
    `半\\s{0,3}个半月`,
  ]
  for (const p of patterns) {
    const re = new RegExp(p, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      hits.push({ kind: 'duration', match: m[0] })
    }
  }

  // Bare N天, but not 第N天 (ordinal day-of-trip, not a duration)
  const bareDay = new RegExp(`(?<!第)\\s{0,3}${num}\\s{0,3}天`, 'g')
  let m: RegExpExecArray | null
  while ((m = bareDay.exec(text)) !== null) {
    hits.push({ kind: 'duration', match: m[0] })
  }

  // 7D6N style
  const dN = /\d+\s*d\s*\d+\s*n/gi
  while ((m = dN.exec(text)) !== null) {
    hits.push({ kind: 'duration', match: m[0] })
  }

  // English
  const en = /\b(?:\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty)\s+(?:day|night|hour|week|month)s?\b/gi
  while ((m = en.exec(text)) !== null) {
    hits.push({ kind: 'duration', match: m[0] })
  }
}

