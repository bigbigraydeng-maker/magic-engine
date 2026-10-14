/** Price detection for the outbound claim scanner (token based). */

import {
  type ClaimHit,
  DIGIT_MAP,
  formatAmount,
  isCnNumChar,
  parseChineseNumber,
} from './outbound-claims-core'

/* ------------------------------------------------------------------ */
/* Price detection — token based                                       */
/* ------------------------------------------------------------------ */

interface NumToken {
  start: number
  end: number
  value: number
  text: string
  /** true when the token's source is a Chinese-numeral run (not arabic). */
  chinese: boolean
  /** true when the token is a colloquial X千Y / X万Y / arabic-k form. */
  colloquial: boolean
}

const CURRENCY_WORDS = [
  'new zealand dollars',
  'kiwi dollars',
  'kiwis',
  'kiwi',
  'nz dollars',
  '新西兰元',
  '新西兰',
  '纽币',
  '纽元',
  '新币',
  '新元',
  'nzd',
  'nz\\$',
  'nz \\$',
  'nz',
  'dollars',
  'dollar',
  'bucks',
  '刀',
  '块钱',
  '块',
  '蚊',
  '元整',
  '元',
  '圆整',
  '圆',
  '纽',
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
  'pp',
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
  '每位',
  '人均',
  '单人',
  '双人',
  '单房差',
  '定金',
  '订金',
  '押金',
  '总价',
  '总共',
  '一共',
  '共计',
  '合计',
  '优惠价',
  '特价',
  '立减',
  '减',
  '另加',
  '加收',
  '加价',
  '只要',
  '仅需',
  '仅售',
  '只需',
  '只卖',
  '售',
  '总计',
  '共',
  '一共',
  '共计',
  '总共',
  '合计',
  '低至',
  '最低',
  '一人',
  '每对',
  '每间',
  '每晚',
  '仅',
  'price',
  'cost',
  'costs',
  'total',
  'only',
  'about',
  'from',
  'deposit',
  'low',
]

const PRICE_WORD_RE = new RegExp(`(?:${PRICE_WORDS.join('|')})`)

const SUFFIX_RE = /^\s?(?:起|\/人|\/位|每人|每位|一位|per person|per couple|per room|for 2|each|pp|左右|上下|以内|以上)/

const DATE_DURATION_FOLLOW = /^(?:月|日|号|年|天|晚|夜|周|小时|分钟|个工作日)/
const UNIT_FOLLOW = /^(?:位|个|人|张|间|次|天|晚)/
const STANDALONE_BLOCK = /^(?:公里|年|人|位|天|岁|个|米|号|日|月|星期|周|小时|分钟|次|间)/

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

/**
 * Tokenise the normalised text into number tokens.
 * Handles arabic numbers (with optional decimals and k/万/千/百 suffix),
 * Chinese numeral runs, and the colloquial X千Y / X万Y forms.
 */
function tokenise(text: string): NumToken[] {
  const tokens: NumToken[] = []
  const n = text.length
  let i = 0
  while (i < n) {
    const ch = text[i]
    if (ch >= '0' && ch <= '9') {
      let j = i
      while (j < n && text[j] >= '0' && text[j] <= '9') j++
      if (j < n && text[j] === '.') {
        let k = j + 1
        while (k < n && text[k] >= '0' && text[k] <= '9') k++
        if (k > j + 1) j = k
      }
      const numStr = text.slice(i, j)
      let value = Number(numStr)
      let end = j
      let colloquial = false
      // suffix k / 万 / 千 / 百
      if (end < n) {
        const suf = text[end]
        if (suf === 'k' && !(end + 1 < n && /[a-z]/.test(text[end + 1]))) {
          value = value * 1000
          end += 1
          colloquial = true
        } else if (suf === '万') {
          // X万Y colloquial: '3万8' -> 38000
          const next = end + 1 < n ? text[end + 1] : ''
          if (/[0-9]/.test(next) || isCnNumChar(next)) {
            const y = /[0-9]/.test(next) ? Number(next) : DIGIT_MAP[next]
            if (y !== undefined && y !== null) {
              value = value * 10000 + y * 1000
              end += 2
              colloquial = true
            } else {
              value = value * 10000
              end += 1
              colloquial = true
            }
          } else {
            value = value * 10000
            end += 1
            colloquial = true
          }
        } else if (suf === '千') {
          // X千Y colloquial: '3千8' -> 3800
          const next = end + 1 < n ? text[end + 1] : ''
          if (/[0-9]/.test(next) || isCnNumChar(next)) {
            const y = /[0-9]/.test(next) ? Number(next) : DIGIT_MAP[next]
            if (y !== undefined && y !== null) {
              value = value * 1000 + y * 100
              end += 2
              colloquial = true
            } else {
              value = value * 1000
              end += 1
              colloquial = true
            }
          } else {
            value = value * 1000
            end += 1
            colloquial = true
          }
        } else if (suf === '百') {
          value = value * 100
          end += 1
        }
      }
      if (!Number.isFinite(value)) throw new Error('non-finite number')
      tokens.push({ start: i, end, value, text: text.slice(i, end), chinese: false, colloquial })
      i = end
      continue
    }
    if (isCnNumChar(ch)) {
      // A leading 一 that is really part of a word (一共/一人/一起/一些/一下/
      // 一定/一般/一直/一切/一边/一路) is not a number token.
      if (ch === '一' && i + 1 < n && '共人起些下定般直切边路'.includes(text[i + 1])) {
        i++
        continue
      }
      let j = i
      while (j < n && isCnNumChar(text[j])) j++
      const run = text.slice(i, j)
      // A run that STARTS with a unit (百/千/万/亿) is not an amount: '万一',
      // '千万', '百' are ordinary words, not prices.
      if (/^[百千万亿佰仟]/.test(run)) {
        i = j
        continue
      }
      const value = parseChineseNumber(run)
      if (value !== null) {
        // colloquial X千Y / X万Y: parseChineseNumber already handles the
        // trailing-digit form, so mark it colloquial when the run ends in a
        // single digit after 千/万.
        const colloquial = /[千万][一二两三四五六七八九]$/.test(run)
        tokens.push({ start: i, end: j, value, text: run, chinese: true, colloquial })
      }
      i = j
      continue
    }
    i++
  }
  return tokens
}

/** Currency word ending at `start`, allowing up to 2 spaces before it. */
function findCurrencyBefore(text: string, start: number): string | null {
  let pos = start
  while (pos > 0 && /\s/.test(text[pos - 1]) && start - pos < 2) pos--
  const head = text.slice(Math.max(0, pos - 24), pos)
  const m = head.match(new RegExp(`(?:${CURRENCY_RE.source})$`, 'i'))
  if (!m) return null
  // A currency word that is the UNIT of an earlier number does not claim the
  // number that follows it.
  const before = pos - m[0].length > 0 ? text[pos - m[0].length - 1] : ''
  if (before && (/[0-9]/.test(before) || isCnNumChar(before))) return null
  return m[0]
}

/** Currency word starting at `end`, allowing up to 2 spaces after it. */
function findCurrencyAfter(text: string, end: number): string | null {
  let pos = end
  while (pos < text.length && /\s/.test(text[pos]) && pos - end < 2) pos++
  const m = text.slice(pos, pos + 24).match(new RegExp(`^(?:${CURRENCY_RE.source})`, 'i'))
  return m ? m[0] : null
}

/** Filler chars allowed between a price word and its number. */
const PRICE_FILLER_RE = /[\s：:是为约大概含税()（）【】\[\]¥$.]/

/**
 * Price word ending within 8 chars before `start`, with no number token between.
 * Up to 4 filler characters (whitespace, colons, 是/为/约/含税, brackets, …)
 * may sit between the end of the price word and the number.
 */
function findPriceWordBefore(text: string, start: number, tokens: NumToken[]): string | null {
  // skip backwards over up to 4 filler chars between the price word and the token
  let end = start
  let skipped = 0
  while (end > 0 && skipped < 4 && PRICE_FILLER_RE.test(text[end - 1])) {
    end--
    skipped++
  }
  // English copula between the price word and the number: 'price is 3880'
  const copula = /\s{0,2}\b(?:is|are|was|at)\s{0,2}$/.exec(text.slice(Math.max(0, end - 8), end))
  if (copula) end -= copula[0].length
  const lo = Math.max(0, end - 8)
  for (let s = lo; s <= end; s++) {
    const slice = text.slice(s, end)
    const m = slice.match(new RegExp(`(?:${PRICE_WORD_RE.source})$`))
    if (m) {
      // no other number token between the price word and this token
      const wordStart = s
      const blocked = tokens.some((t) => t.start >= wordStart && t.end <= end && t.start !== end)
      if (!blocked) return m[0]
    }
  }
  return null
}

/** Suffix directly after the token (0-1 space). */
function hasSuffix(text: string, end: number, tok: NumToken): string | null {
  // Only arabic tokens, or Chinese tokens worth >= 100, may take a suffix.
  // This stops '三位同行' (the '一' before '起') from being read as a price.
  if (tok.chinese && tok.value < 100) return null
  const slice = text.slice(end, end + 12)
  const m = slice.match(SUFFIX_RE)
  return m ? m[0] : null
}

/** Standalone Chinese amount: contains 百/千/万, value >= 100, not a unit. */
function isStandaloneChineseAmount(text: string, tok: NumToken): boolean {
  if (!tok.chinese) return false
  if (!/[百千万佰仟]/.test(tok.text)) return false
  if (tok.value < 100) return false
  const after = text.slice(tok.end)
  if (STANDALONE_BLOCK.test(after)) return false
  return true
}

export function detectPrice(text: string, hits: ClaimHit[]): void {
  const tokens = tokenise(text)

  for (const tok of tokens) {
    const after = text.slice(tok.end)
    const blockedByDateDuration = DATE_DURATION_FOLLOW.test(after)

    let match: string | null = null

    // (a) currency after
    const curAfter = findCurrencyAfter(text, tok.end)
    if (curAfter) match = tok.text + curAfter

    // (b) currency before
    if (!match) {
      const curBefore = findCurrencyBefore(text, tok.start)
      if (curBefore) {
        // do not claim a following token that is followed by a unit
        if (!UNIT_FOLLOW.test(after)) match = curBefore + tok.text
      }
    }

    // (c) price word before
    if (!match) {
      const pw = findPriceWordBefore(text, tok.start, tokens)
      if (pw) match = pw + text.slice(tok.start, tok.end)
    }

    // (d) suffix
    if (!match) {
      const suf = hasSuffix(text, tok.end, tok)
      if (suf) match = tok.text + suf
    }

    // (e) standalone Chinese amount
    if (!match && isStandaloneChineseAmount(text, tok)) {
      match = tok.text
    }

    // (f) colloquial forms are always prices
    if (!match && tok.colloquial) {
      match = tok.text
    }

    if (!match) continue
    if (blockedByDateDuration && !curAfter && !findCurrencyBefore(text, tok.start)) continue

    hits.push({ kind: 'price', match, value: formatAmount(tok.value) })
  }

  // English spelled-out amounts
  const wordNum = '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)'
  const spelledRe = new RegExp(`(${wordNum}(?:\\s+${wordNum})*)\\s+${ENGLISH_CURRENCY}`, 'gi')
  let m: RegExpExecArray | null
  while ((m = spelledRe.exec(text)) !== null) {
    const n = parseEnglishNumberWords(m[1])
    if (n !== null) hits.push({ kind: 'price', match: m[0], value: formatAmount(n) })
  }
  const spelledRe2 = new RegExp(`${ENGLISH_CURRENCY}\\s+(${wordNum}(?:\\s+${wordNum})*)`, 'gi')
  while ((m = spelledRe2.exec(text)) !== null) {
    const n = parseEnglishNumberWords(m[1])
    if (n !== null) hits.push({ kind: 'price', match: m[0], value: formatAmount(n) })
  }
}

