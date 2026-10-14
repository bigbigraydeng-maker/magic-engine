/**
 * Shared claim scanner for outbound customer text.
 *
 * Before an AI or a staff member sends a message to a customer, we scan it for
 * "claim shapes": prices, dates, durations, promises, visa statements,
 * availability statements and discounts. A hit means the text states something
 * that must be backed by a confirmed fact or a human.
 *
 * It fails closed: if the input is not a string, or anything throws, we return a
 * single `scan_error` hit rather than an empty (i.e. "clean") result. Never
 * return [] on error.
 *
 * Pure and dependency-free: no imports, no network, no `any`.
 */

export type ClaimKind =
  | 'price'
  | 'date'
  | 'duration'
  | 'promise'
  | 'visa'
  | 'availability'
  | 'discount'
  | 'scan_error'

export interface ClaimHit {
  kind: ClaimKind
  match: string
  value?: string
}

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

const INVISIBLE = /[\u200b\u200c\u200d\u2060\ufeff\u00ad\uFE0F\u20E3]/g
const URL_RE = /(https?:\/\/\S+|www\.\S+)/gi

export function normalise(text: string): string {
  let s = text.normalize('NFKC')
  s = s.replace(URL_RE, ' ')
  s = s.replace(INVISIBLE, '')
  s = s.toLowerCase()
  // remove thousands separators inside numbers: 3,880 -> 3880
  s = s.replace(/(\d),(\d)/g, '$1$2')
  // collapse spaces between digits: '3 8 8 0' -> '3880'
  s = s.replace(/(\d)\s+(?=\d)/g, '$1')
  return s
}

/* ------------------------------------------------------------------ */
/* Chinese numeral parsing                                             */
/* ------------------------------------------------------------------ */

const CAPITAL_MAP: Record<string, string> = {
  壹: '一',
  贰: '二',
  叁: '三',
  肆: '四',
  伍: '五',
  陆: '六',
  柒: '七',
  捌: '八',
  玖: '九',
  拾: '十',
  佰: '百',
  仟: '千',
}

const DIGIT_MAP: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
}

const UNIT_MAP: Record<string, number> = {
  十: 10,
  百: 100,
  千: 1000,
  万: 10000,
}

const CN_NUM_CHARS = '零〇一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟'

function mapCapitals(s: string): string {
  let out = ''
  for (const ch of s) out += CAPITAL_MAP[ch] ?? ch
  return out
}

/**
 * Parse a run of Chinese numeral characters into a number.
 * Supports positional ('三千八百八十' = 3880), digit-by-digit ('三八八零' = 3880),
 * colloquial trailing digit ('三千八' = 3800, '一万二' = 12000).
 * Returns null if the run is not a valid numeral.
 */
export function parseChineseNumber(raw: string): number | null {
  const s = mapCapitals(raw)
  if (!s) return null

  // digit-by-digit: all chars are plain digits, no units
  let allDigits = true
  for (const ch of s) {
    if (!(ch in DIGIT_MAP)) {
      allDigits = false
      break
    }
  }
  if (allDigits) {
    let n = 0
    for (const ch of s) n = n * 10 + DIGIT_MAP[ch]
    return n
  }

  // positional
  let total = 0
  let section = 0
  let current = 0
  let sawAny = false
  let lastUnit = 0
  let trailingDigit = -1

  for (const ch of s) {
    if (ch in DIGIT_MAP) {
      current = DIGIT_MAP[ch]
      sawAny = true
      trailingDigit = current
    } else if (ch in UNIT_MAP) {
      const unit = UNIT_MAP[ch]
      sawAny = true
      if (unit === 10000) {
        section = (section + (current || 1)) * unit
        total += section
        section = 0
        current = 0
        lastUnit = unit
        trailingDigit = -1
      } else {
        section += (current || 1) * unit
        current = 0
        lastUnit = unit
        trailingDigit = -1
      }
    } else {
      return null
    }
  }

  if (!sawAny) return null

  // colloquial trailing digit: '三千八' -> 3800, '一万二' -> 12000
  if (trailingDigit >= 0 && lastUnit > 0) {
    const nextUnit = lastUnit / 10
    if (nextUnit >= 1) {
      section += trailingDigit * nextUnit
      trailingDigit = -1
    }
  }

  total += section + (trailingDigit >= 0 ? trailingDigit : 0)
  return total
}

/* ------------------------------------------------------------------ */
/* Number extraction helpers                                           */
/* ------------------------------------------------------------------ */

const CN_RUN = `[${CN_NUM_CHARS}]+`

/** Parse an arabic number possibly with k/万 suffix. */
function parseArabicWithSuffix(numStr: string, suffix: string): number | null {
  const n = Number(numStr)
  if (!Number.isFinite(n)) return null
  if (suffix === 'k') return n * 1000
  if (suffix === '万') return n * 10000
  return n
}

function formatAmount(n: number): string {
  if (Number.isInteger(n)) return String(n)
  return String(n)
}

/* ------------------------------------------------------------------ */
/* Price detection                                                     */
/* ------------------------------------------------------------------ */

const CURRENCY_WORDS = [
  '纽币',
  '纽元',
  '新西兰元',
  '新币',
  '新元',
  'nzd',
  'nz\\$',
  'nz',
  '刀',
  '块钱',
  '块',
  '蚊',
  '元整',
  '元',
  '澳币',
  '澳元',
  'aud',
  '美金',
  '美元',
  'usd',
  '镑',
  '人民币',
  'rmb',
  '¥',
  '￥',
  '\\$',
]

const CURRENCY_RE = new RegExp(`(?:${CURRENCY_WORDS.join('|')})`, 'i')

const PRICE_WORDS = [
  '价格',
  '价钱',
  '团费',
  '费用',
  '售价',
  '报价',
  '起价',
  '每人',
  '人均',
  '单人',
  '双人',
  '单房差',
  '定金',
  '订金',
  '押金',
  '总价',
  '优惠价',
  '特价',
  '立减',
  '减',
  '另加',
  '加收',
  '起',
]

const PRICE_WORD_RE = new RegExp(`(?:${PRICE_WORDS.join('|')})`)

const ENGLISH_NUM_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
  thousand: 1000,
}

const ENGLISH_CURRENCY = '(?:dollars|nzd|aud|usd|bucks)'

function parseEnglishNumberWords(words: string): number | null {
  const parts = words.trim().split(/\s+/)
  let total = 0
  let current = 0
  let saw = false
  for (const p of parts) {
    const v = ENGLISH_NUM_WORDS[p]
    if (v === undefined) return null
    saw = true
    if (v === 100) {
      current = (current || 1) * 100
    } else if (v === 1000) {
      total += (current || 1) * 1000
      current = 0
    } else {
      current += v
    }
  }
  if (!saw) return null
  return total + current
}

function detectPrice(text: string, hits: ClaimHit[]): void {
  // Arabic number with optional k/万 suffix, adjacent to currency word
  const arabicNum = '(\\d+(?:\\.\\d+)?)\\s*(k|万)?'
  const currencyBefore = new RegExp(
    `(?<![0-9零〇一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟])${CURRENCY_RE.source}\\s*${arabicNum}`,
    'gi',
  )
  const currencyAfter = new RegExp(`${arabicNum}\\s*${CURRENCY_RE.source}`, 'gi')

  let m: RegExpExecArray | null
  while ((m = currencyBefore.exec(text)) !== null) {
    const n = parseArabicWithSuffix(m[1], m[2] ?? '')
    if (n !== null) hits.push({ kind: 'price', match: m[0], value: formatAmount(n) })
  }
  while ((m = currencyAfter.exec(text)) !== null) {
    const n = parseArabicWithSuffix(m[1], m[2] ?? '')
    if (n !== null) hits.push({ kind: 'price', match: m[0], value: formatAmount(n) })
  }

  // Chinese numeral adjacent to currency word
  const cnCurrencyBefore = new RegExp(
    `(?<![0-9零〇一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟])${CURRENCY_RE.source}\\s*(${CN_RUN})(?![位个人张间次])`,
    'g',
  )
  const cnCurrencyAfter = new RegExp(`(${CN_RUN})\\s*${CURRENCY_RE.source}`, 'g')
  while ((m = cnCurrencyBefore.exec(text)) !== null) {
    const n = parseChineseNumber(m[1])
    if (n !== null) hits.push({ kind: 'price', match: m[0], value: formatAmount(n) })
  }
  while ((m = cnCurrencyAfter.exec(text)) !== null) {
    const n = parseChineseNumber(m[1])
    if (n !== null) hits.push({ kind: 'price', match: m[0], value: formatAmount(n) })
  }

  // Number within 6 chars after a price word
  const priceWordRe = new RegExp(`(?:${PRICE_WORD_RE.source})(.{0,6})`, 'g')
  while ((m = priceWordRe.exec(text)) !== null) {
    const tail = m[1]
    const arabic = tail.match(/(\d+(?:\.\d+)?)\s*(k|万)?/)
    if (arabic) {
      const n = parseArabicWithSuffix(arabic[1], arabic[2] ?? '')
      if (n !== null) hits.push({ kind: 'price', match: m[0], value: formatAmount(n) })
      continue
    }
    const cn = tail.match(new RegExp(CN_RUN))
    if (cn) {
      const n = parseChineseNumber(cn[0])
      if (n !== null) hits.push({ kind: 'price', match: m[0], value: formatAmount(n) })
    }
  }

  // English spelled-out amounts
  const wordNum = '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)'
  const spelledRe = new RegExp(`(${wordNum}(?:\\s+${wordNum})*)\\s+${ENGLISH_CURRENCY}`, 'gi')
  while ((m = spelledRe.exec(text)) !== null) {
    const n = parseEnglishNumberWords(m[1])
    if (n !== null) hits.push({ kind: 'price', match: m[0], value: formatAmount(n) })
  }
  const spelledRe2 = new RegExp(`${ENGLISH_CURRENCY}\\s+(${wordNum}(?:\\s+${wordNum})*)`, 'gi')
  while ((m = spelledRe2.exec(text)) !== null) {
    const n = parseEnglishNumberWords(m[1])
    if (n !== null) hits.push({ kind: 'price', match: m[0], value: formatAmount(n) })
  }

  // Standalone colloquial amounts (no currency / price word required)
  detectColloquialAmount(text, hits)
}

/**
 * Detect standalone colloquial amounts that carry no currency or price word:
 *   - '三千八' / '3千8'  -> 3800   (X千Y, Y is a single digit)
 *   - '一万二'           -> 12000  (X万Y, Y is a single digit)
 *   - '3.88k'            -> 3880   (arabic number with k suffix)
 * The trailing digit must not be followed by 百/十/千/万 or another numeral
 * digit, so full positional forms like '三千八百八十' are left to the
 * currency/price-word paths.
 */
function detectColloquialAmount(text: string, hits: ClaimHit[]): void {
  const cnDigit = '[一二两三四五六七八九]'
  const cnFirst = '[一二两三四五六七八九]'
  const followNot = `(?![0-9${CN_NUM_CHARS}])`

  // X千Y  (X arabic integer or Chinese numeral run, Y single digit)
  const qianRe = new RegExp(
    `((?:\\d+|${cnFirst})千)(${cnDigit}|\\d)${followNot}`,
    'g',
  )
  let m: RegExpExecArray | null
  while ((m = qianRe.exec(text)) !== null) {
    const xStr = m[1].slice(0, -1) // drop the 千
    const x = /^\d+$/.test(xStr) ? Number(xStr) : parseChineseNumber(xStr)
    const y = /^\d$/.test(m[2]) ? Number(m[2]) : DIGIT_MAP[m[2]]
    if (x !== null && y !== undefined && y !== null) {
      hits.push({ kind: 'price', match: m[0], value: formatAmount(x * 1000 + y * 100) })
    }
  }

  // X万Y  (X arabic integer or Chinese numeral run, Y single digit)
  const wanRe = new RegExp(
    `((?:\\d+|${cnFirst})万)(${cnDigit}|\\d)${followNot}`,
    'g',
  )
  while ((m = wanRe.exec(text)) !== null) {
    const xStr = m[1].slice(0, -1) // drop the 万
    const x = /^\d+$/.test(xStr) ? Number(xStr) : parseChineseNumber(xStr)
    const y = /^\d$/.test(m[2]) ? Number(m[2]) : DIGIT_MAP[m[2]]
    if (x !== null && y !== undefined && y !== null) {
      hits.push({ kind: 'price', match: m[0], value: formatAmount(x * 10000 + y * 1000) })
    }
  }

  // arabic number with k suffix: '3.88k' -> 3880
  const kRe = /(\d+(?:\.\d+)?)\s*k(?![a-z])/g
  while ((m = kRe.exec(text)) !== null) {
    const n = Number(m[1])
    if (Number.isFinite(n)) {
      hits.push({ kind: 'price', match: m[0], value: formatAmount(Math.round(n * 1000)) })
    }
  }
}

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

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function parseCnMonthDay(mStr: string, dStr: string): { m: number; d: number } | null {
  const m = /^\d+$/.test(mStr) ? Number(mStr) : parseChineseNumber(mStr)
  const d = /^\d+$/.test(dStr) ? Number(dStr) : parseChineseNumber(dStr)
  if (m === null || d === null) return null
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return { m, d }
}

function detectDate(text: string, hits: ClaimHit[]): void {
  let m: RegExpExecArray | null

  // YYYY年M月D日/号
  const cnFull = /(\d{4})\s*年\s*(\d{1,2}|[一二三四五六七八九十]+)\s*月\s*(\d{1,2}|[一二三四五六七八九十]+)\s*[日号]/g
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
  const cnShort = /(\d{1,2}|[一二三四五六七八九十]+)\s*月\s*(\d{1,2}|[一二三四五六七八九十]+)\s*[日号]/g
  while ((m = cnShort.exec(text)) !== null) {
    const md = parseCnMonthDay(m[1], m[2])
    if (md) hits.push({ kind: 'date', match: m[0], value: `${pad2(md.m)}-${pad2(md.d)}` })
  }

  // English: 'dec 31', '16 november 2026', '31 dec'
  const monthNames = Object.keys(MONTHS).join('|')
  const enMonthDay = new RegExp(`\\b(${monthNames})\\s+(\\d{1,2})(?:\\s*,?\\s*(\\d{4}))?\\b`, 'gi')
  while ((m = enMonthDay.exec(text)) !== null) {
    const mo = MONTHS[m[1].toLowerCase()]
    const d = Number(m[2])
    if (mo && d >= 1 && d <= 31) {
      const value = m[3] ? `${m[3]}-${pad2(mo)}-${pad2(d)}` : `${pad2(mo)}-${pad2(d)}`
      hits.push({ kind: 'date', match: m[0], value })
    }
  }
  const enDayMonth = new RegExp(`\\b(\\d{1,2})\\s+(${monthNames})(?:\\s*,?\\s*(\\d{4}))?\\b`, 'gi')
  while ((m = enDayMonth.exec(text)) !== null) {
    const mo = MONTHS[m[2].toLowerCase()]
    const d = Number(m[1])
    if (mo && d >= 1 && d <= 31) {
      const value = m[3] ? `${m[3]}-${pad2(mo)}-${pad2(d)}` : `${pad2(mo)}-${pad2(d)}`
      hits.push({ kind: 'date', match: m[0], value })
    }
  }

  // Relative dates
  const relative = /(下周|下星期|下个月|这周末|这个周末|下周末|本周|这周|国庆|春节|圣诞|元旦|中秋)/g
  while ((m = relative.exec(text)) !== null) {
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

function detectDuration(text: string, hits: ClaimHit[]): void {
  const num = `(?:\\d+|[${CN_NUM_CHARS}]+)`
  const patterns = [
    `${num}\\s*天\\s*${num}\\s*[晚夜]`,
    `${num}\\s*日游`,
    `${num}\\s*天\\s*[内后]`,
    `${num}\\s*个工作日`,
    `${num}\\s*小时\\s*[内后]`,
    `${num}\\s*周(?:行程)?`,
    `${num}\\s*个月`,
    `${num}\\s*小时`,
    `半\\s*个月`,
  ]
  for (const p of patterns) {
    const re = new RegExp(p, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      hits.push({ kind: 'duration', match: m[0] })
    }
  }

  // English
  const en = /\b(?:\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty)\s+(?:day|night|hour|week|month)s?\b/gi
  let m: RegExpExecArray | null
  while ((m = en.exec(text)) !== null) {
    hits.push({ kind: 'duration', match: m[0] })
  }
}

/* ------------------------------------------------------------------ */
/* Word-based detection                                                */
/* ------------------------------------------------------------------ */

const PROMISE_WORDS = [
  '保证', '包过', '包签', '包出签', '包成功', '一定能', '一定可以',
  '百分百', '100%', '确保', '绝对能', '稳过', '无条件', '全额退款',
  '全额退', '必定', '承诺',
]
const PROMISE_EN = /\b(guarantee|guaranteed|definitely will|money back)\b/gi

const VISA_WORDS = ['免签', '落地签', '拒签', '出签', '过签']
const VISA_CTX = ['免', '无需', '不需要', '不用', '通过', '费用', '办理', '一般']
const VISA_EN = /\bvisa\b[^.!?]*\b(free|waiver|approved|guarantee|fee)\b/gi

const AVAILABILITY_WORDS = [
  '仅剩', '只剩', '余位', '余票', '名额', '满团', '还有位置',
  '还有位子', '位置不多', '席位',
]
const AVAILABILITY_EN = /\b(seats? left|spots? left|sold out|fully booked|limited availability)\b/gi

const DISCOUNT_WORDS = [
  '最低价', '最便宜', '全网最低', '免费升级', '免费赠送', '免费送',
  '赠送', '优惠', '折扣', '立减', '打折', '特价', '限时',
]
const DISCOUNT_EN = /\b(discount|half price|free upgrade|best price|lowest price)\b/gi

function detectWords(text: string, hits: ClaimHit[]): void {
  let m: RegExpExecArray | null

  for (const w of PROMISE_WORDS) {
    const re = new RegExp(escapeRe(w), 'g')
    while ((m = re.exec(text)) !== null) hits.push({ kind: 'promise', match: m[0] })
  }
  while ((m = PROMISE_EN.exec(text)) !== null) hits.push({ kind: 'promise', match: m[0] })

  for (const w of VISA_WORDS) {
    const re = new RegExp(escapeRe(w), 'g')
    while ((m = re.exec(text)) !== null) hits.push({ kind: 'visa', match: m[0] })
  }
  // 签证 in same sentence as context word
  const sentences = text.split(/[。！？.!?\n]/)
  for (const s of sentences) {
    if (s.includes('签证') && VISA_CTX.some((c) => s.includes(c))) {
      hits.push({ kind: 'visa', match: '签证' })
    }
  }
  while ((m = VISA_EN.exec(text)) !== null) hits.push({ kind: 'visa', match: m[0] })

  for (const w of AVAILABILITY_WORDS) {
    const re = new RegExp(escapeRe(w), 'g')
    while ((m = re.exec(text)) !== null) hits.push({ kind: 'availability', match: m[0] })
  }
  // 剩N位
  const remaining = /剩\s*(?:\d+|[一二三四五六七八九十]+)\s*位/g
  while ((m = remaining.exec(text)) !== null) hits.push({ kind: 'availability', match: m[0] })
  while ((m = AVAILABILITY_EN.exec(text)) !== null) hits.push({ kind: 'availability', match: m[0] })

  for (const w of DISCOUNT_WORDS) {
    const re = new RegExp(escapeRe(w), 'g')
    while ((m = re.exec(text)) !== null) hits.push({ kind: 'discount', match: m[0] })
  }
  // N折
  const zhe = /(?:\d+|[一二三四五六七八九十]+)\s*折/g
  while ((m = zhe.exec(text)) !== null) hits.push({ kind: 'discount', match: m[0] })
  // N% off / N%
  const pct = /\d+\s*%/g
  while ((m = pct.exec(text)) !== null) hits.push({ kind: 'discount', match: m[0] })
  while ((m = DISCOUNT_EN.exec(text)) !== null) hits.push({ kind: 'discount', match: m[0] })
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export function scanOutboundClaims(text: string): ClaimHit[] {
  try {
    if (typeof text !== 'string') {
      return [{ kind: 'scan_error', match: '' }]
    }
    const normalised = normalise(text)
    const hits: ClaimHit[] = []
    detectPrice(normalised, hits)
    detectDate(normalised, hits)
    detectDuration(normalised, hits)
    detectWords(normalised, hits)
    return dedupe(hits)
  } catch {
    return [{ kind: 'scan_error', match: '' }]
  }
}

function dedupe(hits: ClaimHit[]): ClaimHit[] {
  const seen = new Set<string>()
  const out: ClaimHit[] = []
  for (const h of hits) {
    const key = `${h.kind}|${h.match}|${h.value ?? ''}`
    if (!seen.has(key)) {
      seen.add(key)
      out.push(h)
    }
  }
  return out
}
