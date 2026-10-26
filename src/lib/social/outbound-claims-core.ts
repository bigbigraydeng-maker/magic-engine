/**
 * Core helpers for the outbound claim scanner: types, text normalisation and
 * Chinese numeral parsing. Pure and dependency-free (no imports, no network).
 * See outbound-claims.ts for the public entry point.
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
// ASCII-only: a URL ends at the first non-ASCII or whitespace char, so Chinese
// text immediately after a URL is not swallowed.
const URL_RE = /(?:https?:\/\/|www\.)[\x21-\x7e]+/gi

// Traditional -> simplified. Single const so it can be extended.
const TRAD_TO_SIMP: Record<string, string> = {
  紐: '纽', 幣: '币', 圓: '圆', 塊: '块', 價: '价', 團: '团', 費: '费',
  簽: '签', 證: '证', 號: '号', 週: '周', 發: '发', 點: '点', 餘: '余',
  額: '额', 滿: '满', 優: '优', 賠: '赔', 補: '补', 貳: '贰', 參: '叁',
  陸: '陆', 兩: '两', 萬: '万', 實: '实', 時: '时', 間: '间', 後: '后',
  開: '开', 預: '预', 訂: '订', 無: '无', 備: '备', 為: '为', 會: '会',
  過: '过', 對: '对', 這: '这', 還: '还', 機: '机', 離: '离', 達: '达',
  帶: '带', 長: '长', 買: '买', 賣: '卖', 銷: '销', 錢: '钱', 臺: '台',
  灣: '湾', 國: '国', 際: '际', 華: '华', 條: '条', 項: '项', 範: '范',
  確: '确', 認: '认', 說: '说', 話: '话', 讓: '让', 請: '请', 謝: '谢',
  歡: '欢', 迎: '迎', 驗: '验', 規: '规', 劃: '划', 計: '计', 護: '护',
  辦: '办', 拒: '拒', 剩: '剩', 贈: '赠', 禮: '礼', 折: '折', 減: '减',
  賬: '账', 財: '财',
  絕: '绝', 沒: '没', 問: '问', 題: '题', 幫: '帮', 順: '顺', 鐘: '钟',
}

function toSimplified(s: string): string {
  let out = ''
  for (const ch of s) out += TRAD_TO_SIMP[ch] ?? ch
  return out
}

export function normalise(text: string): string {
  // Thousands-comma removal must run on the ORIGINAL text, before NFKC turns
  // the Chinese comma '，' into ',' (which would wrongly glue '3,880，12月').
  // Handle both ASCII ',' and fullwidth '，' here, but only when the comma sits
  // between digit groups of exactly 3 digits (so '3880，订金' is left alone).
  let s = text.replace(
    /(?<![0-9０-９])([0-9０-９]{1,3}(?:[,，][0-9０-９]{3})+)(?![0-9０-９])/g,
    (m) => m.replace(/[,，]/g, ''),
  )
  s = s.normalize('NFKC')
  s = s.replace(URL_RE, ' ')
  s = s.replace(INVISIBLE, '')
  s = toSimplified(s)
  s = s.toLowerCase()
  // collapse runs of single digits separated by single spaces: '3 8 8 0' -> '3880'
  s = s.replace(/(?<!\d)\d(?: \d){2,}(?!\d)/g, (m) => m.replace(/ /g, ''))
  // collapse thousands-style groups: '3 880' / '1 234 567' -> '3880' / '1234567'
  s = s.replace(/(?<!\d)\d{1,3}(?: \d{3})+(?!\d)/g, (m) => m.replace(/ /g, ''))
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

export const DIGIT_MAP: Record<string, number> = {
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

export const CN_NUM_CHARS = '零〇一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟'

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
  // A 零 after a unit means the following digit is a plain ones digit, so the
  // colloquial 'trailing digit = next lower unit' rule must be switched off.
  let zeroAfterUnit = false

  for (const ch of s) {
    if (ch in DIGIT_MAP) {
      current = DIGIT_MAP[ch]
      sawAny = true
      if (current === 0 && lastUnit > 0) zeroAfterUnit = true
      trailingDigit = current
    } else if (ch in UNIT_MAP) {
      const unit = UNIT_MAP[ch]
      sawAny = true
      if (unit === 10000) {
        section = ((section + current) || 1) * unit
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
      zeroAfterUnit = false
    } else {
      return null
    }
  }

  if (!sawAny) return null

  // colloquial trailing digit: '三千八' -> 3800, '一万二' -> 12000
  if (trailingDigit >= 0 && lastUnit > 0 && !zeroAfterUnit) {
    const nextUnit = lastUnit / 10
    if (nextUnit >= 1) {
      section += trailingDigit * nextUnit
      trailingDigit = -1
    }
  }

  total += section + (trailingDigit >= 0 ? trailingDigit : 0)
  return total
}


export function formatAmount(n: number): string {
  if (!Number.isFinite(n)) {
    throw new Error('non-finite amount')
  }
  return String(n)
}

export function isCnNumChar(ch: string): boolean {
  return CN_NUM_CHARS.includes(ch)
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
