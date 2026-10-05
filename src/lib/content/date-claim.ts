/**
 * 日期声明识别 —— 共享的「精确」日期识别器。
 *
 * 这里只回答「这段文字里有没有日期声明」,**不**回答「这个日期是不是真的」。
 *
 * 三点必须说清楚:
 *
 * 1. 本 PR **没有**把它接进任何渠道。factory/copy-generator.ts 里私有的 DATE_RE
 *    有意保持原样 —— 换掉它会改变 AI 广告文案落模板兜底的行为,那次替换属于第 4 步
 *    的结构化比对,不在这里做。
 *
 * 2. 有意**排除**三类:裸年份("2027 tour")、时长("3 days")、以及旧的粗糙
 *    月份前缀匹配(那种写法会命中 "Market 50")。
 *
 * 3. 为什么**不导出** RegExp:带 /g 的正则跨模块共用会因 lastIndex 出现幽灵 bug,
 *    所以只导出函数。
 *
 * 已知没覆盖(有意为之,别当 bug):
 *   · 周几("this Saturday")、"next month"、"Boxing Day" 等相对 / 节日说法
 *   · 中文数字日期
 *   · "租期12月"(当时长用的 N月)分不出来
 *   · **小写月份缩写(除 may 外)仍会命中**,如 "3 mar"、"this will mar 5 of them",
 *     第 4 步接线前必须再收紧
 *   · 31st May 与 May 31 互不归一(第 4 步做结构化比对时处理)
 *   · 日期区间只抓到一端("15–20 March" 只得 "20 March","12月15-20日" 只得 "12月")
 *   · 含数字的版本号 "3.4.2026" 与 dd.mm.yyyy 日期分不开
 */

const MONTH = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?`
const YEAR = String.raw`(?:19|20)\d{2}`
const ORD = String.raw`(?:st|nd|rd|th)?`
// street names that look like months: "88 May Road", "12 August Street", "15 May Court"
const STREET_SUFFIX = String.raw`(?:st|street|rd|road|ave|avenue|dr|drive|ln|lane|pl|place|way|cres|crescent|tce|terrace|blvd|boulevard|hwy|highway|court|ct|close|cl|grove|parade|pde|square|sq|walk|hill|park|mews|rise|esplanade|row|heights|view|circuit|promenade|gardens)`
// "March 7 day tour", "May 5 star lodge", "Jan 5 km run", "Dec 12 rooms", "Nov 9 am" are not dates
const UNIT_AFTER_DAY = String.raw`(?![^\S\r\n]*(?:(?:days?|nights?|stars?|kms?|bedrooms?|hours?|people|rooms?|guests?|pax|am|pm)\b|%))`
const DATE_CLAIM_SOURCES = [
  String.raw`\b\d{1,2}${ORD}(?:\s+of)?\s+${MONTH}(?![a-z])(?!\s+${STREET_SUFFIX}\b)(?:,?\s+${YEAR}\b)?`, // 15 March · 15th of March · 1st September 2027
  String.raw`\b${MONTH}\s+\d{1,2}${ORD}\b${UNIT_AFTER_DAY}(?:,?\s+${YEAR}\b)?`, // March 15 · Mar. 15th · March 15, 2027
  String.raw`\b${MONTH}\s+${YEAR}\b`, // March 2027
  String.raw`\b\d{1,2}[/.-]\d{1,2}[/.-]${YEAR}\b`, // 15/03/2027
  String.raw`\b${YEAR}[-/.]\d{1,2}[-/.]\d{1,2}\b`, // 2027-03-15 · 2027/03/15 · 2027.03.15
  String.raw`(?:${YEAR}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*[日号]`, // 3月15日 · 2027年3月15日
  String.raw`${YEAR}\s*年\s*\d{1,2}\s*月`, // 2027年3月
  String.raw`\b(?:1[0-2]|0?[1-9])\s*月(?!龄)`, // 3月 · 12月 (not 13月, not 6月龄)
]
// 只导出**源字符串**,不导出 RegExp 对象 —— 带 /g 的实例跨模块共用会因 lastIndex 出现幽灵 bug。
const DATE_CLAIM_SOURCE = DATE_CLAIM_SOURCES.join('|') // NOT exported

const isDay = (n: number): boolean => n >= 1 && n <= 31
const isMonth = (n: number): boolean => n >= 1 && n <= 12

/**
 * 数字范围合理性检查。按顺序试,第一个匹配上的形状说了算;都不匹配则放行(true)。
 */
function inRange(m: string): boolean {
  const iso = m.match(/^((?:19|20)\d{2})[-/.](\d{1,2})[-/.](\d{1,2})$/)
  if (iso !== null) return isMonth(+iso[2]) && isDay(+iso[3])

  const dmy = m.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](?:19|20)\d{2}$/)
  if (dmy !== null) {
    return (isDay(+dmy[1]) && isMonth(+dmy[2])) || (isMonth(+dmy[1]) && isDay(+dmy[2]))
  }

  const cjkFull = m.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/)
  if (cjkFull !== null) return isMonth(+cjkFull[1]) && isDay(+cjkFull[2])

  const cjkYm = m.match(/^(?:19|20)\d{2}\s*年\s*(\d{1,2})\s*月$/)
  if (cjkYm !== null) return isMonth(+cjkYm[1])

  // "March 2027" 会落到这里:\d{1,2}\b 无法在 2027 内部匹配,所以直接放行(true)。
  const dayFirst = m.match(/^(\d{1,2})(?:st|nd|rd|th)?\b/i)
  if (dayFirst !== null) return isDay(+dayFirst[1])

  const monthFirst = m.match(/^[a-z]+\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i)
  if (monthFirst !== null) return isDay(+monthFirst[1])

  return true
}

/**
 * 正则带 `i` 标志,所以小写的 "may"(情态动词)也会命中("you may 5 times"、
 * "Kids aged 5 may enter free")。规则:命中串里出现单词 "may"(不分大小写)时,
 * 只有当它写成 "May" 或 "MAY" 才算日期;小写 "may" 一律 false。其余一律 true。
 * 不用内联修饰符(如 (?-i:...))。
 */
function isRealDate(m: string, text: string, index: number): boolean {
  const mayMatch = m.match(/\bmay\b/i)
  if (mayMatch !== null && mayMatch[0] !== 'May' && mayMatch[0] !== 'MAY') return false

  if (!inRange(m)) return false

  // 中文「月」误用:不含「年」时,前面是 第/满/. 的「N月」多半不是日期;
  // 结尾是 日/号 且后面紧跟「线」的,是地铁线名("1月5号线")。
  if (m.includes('月') && !m.includes('年')) {
    const prev = text[index - 1]
    if (prev === '第' || prev === '满' || prev === '.') return false
    if ((m.endsWith('日') || m.endsWith('号')) && text[index + m.length] === '线') return false
  }

  return true
}

/**
 * 找出这段文字里所有日期声明。非字符串或空串返回 []。
 *
 * 每次调用**新建** RegExp 实例:带 /g 的正则对象有 lastIndex 状态,跨调用/跨模块共用
 * 会出现「隔次返回 false」的幽灵 bug,所以这里不复用模块级实例。
 */
export function findDateClaims(text: string | null | undefined): string[] {
  if (typeof text !== 'string' || text.length === 0) return []
  const re = new RegExp(DATE_CLAIM_SOURCE, 'gi') // fresh object per call, so there is no shared lastIndex state
  const found: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (isRealDate(m[0], text, m.index)) {
      found.push(m[0].replace(/\.$/, '')) // sentence-ending dot: "Closes 5 May." -> "5 May"
    } else {
      // 被否掉的命中(如 "may 1 July")不能吞掉它后面的真日期,把游标往前挪一格重试。
      re.lastIndex = m.index + 1
    }
  }
  return found
}

/**
 * 这段文字里有没有日期声明。
 */
export function containsDateClaim(text: string | null | undefined): boolean {
  return findDateClaims(text).length > 0
}
