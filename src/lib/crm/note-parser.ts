/**
 * 把销售手打的一句跟进记录，变成系统能用的字段。
 *
 * 这些记录是 CTS 六周里 294 条真实原话，长这样：
 *   "voice mail"
 *   "86 years old has been to china do not want to go again great memory though"
 *   "7.14大瑞更新， 客户明确说了不要电话，只邮件联系"
 *   "good conversation just back from China with Inspiring Vacations at $1650 per person with forced shopping"
 *   "very interested but not plan to go until end of next year"
 *
 * 全是决定性信息，全躺在一个 Excel 单元格里，系统一条都用不上。
 *
 * 分工（有意为之）：
 *   规则   负责「不能打了」「没联系上」「号码是坏的」—— 这三件事不能交给 AI。
 *          打给明确说过别打的人是骚扰，不是准确率问题。
 *   AI     负责细微的：什么时候走、想去哪、被谁抢了、下一步说什么。
 *
 * do_not_contact 上规则和 AI 取并集，且规则宁可多报：漏判的代价是骚扰客户，
 * 误判的代价只是少打一个电话。
 */

import { z } from 'zod'

export const CONTACT_OUTCOMES = [
  'no_answer',      // 打了没人接 / 语音信箱 / 打不通
  'bad_number',     // 号码本身是错的
  'do_not_contact', // 客户明确说别再联系
  'not_interested', // 聊过了，没兴趣
  'spoke',          // 真的聊上了
  'callback_set',   // 约了下次
  'unknown',
] as const

export type ContactOutcome = (typeof CONTACT_OUTCOMES)[number]

export const NoteParseSchema = z.object({
  outcome: z.enum(CONTACT_OUTCOMES),
  /** 客户明确说过别再联系 —— 任何渠道都不许再发。 */
  do_not_contact: z.boolean(),
  /** 客户说的出行时间，原话意思，例如「明年三月」「2027 年底」。没说就 null。 */
  travel_window: z.string().nullable(),
  /** 客户提到的团名，英文原样。没说就 null。 */
  tour_interest: z.string().nullable(),
  /** 提到的竞争对手，例如 "Inspiring Vacations"。没提就 null。 */
  competitor: z.string().nullable(),
  /** 约定的下次联系时间，ISO；说不清就 null。 */
  callback_at: z.string().nullable(),
  /** 一句中文人话，给销售看。 */
  summary: z.string(),
})

export type NoteParse = z.infer<typeof NoteParseSchema>

// ── 规则层：三件不能交给 AI 的事 ──────────────────────────────────────────

/** 客户明确划清界限的说法。宁可多报 —— 漏判是骚扰，误判只是少打一通。 */
const DNC_PATTERNS: RegExp[] = [
  /do\s*not\s*follow\s*up/i,
  /no\s*need\s*(to\s*)?follow\s*up/i,
  /do\s*not\s*want\s*to\s*talk/i,
  /does\s*not\s*want\s*to\s*talk/i,
  /do\s*not\s*(like|want)\s*(phone|call)/i,
  /not\s*intending\s*to\s*go/i,
  /不要(打)?电话/,
  /不需要联系/,
  /别再(联系|打)/,
  /只邮件联系/,
]

const NO_ANSWER_PATTERNS: RegExp[] = [
  // 真实数据里主流写法是 "voice message"(82 次) 而不是 "voice mail"(16 次)，
  // 还有 "messsage" / "messge" / "mesage" 各种手误。宽松匹配 voice + m 开头的词。
  /voice\s*m\w*/i,
  /\bvm\b/i,
  /can\s*not\s*(get\s*through|go\s*through|reach)/i,
  /cannot\s*(get\s*through|reach)/i,
  /no\s*answer/i,
  /does\s*not\s*answer/i,
  /\bdropped\b/i,
  /\bcut\s*off\b/i,
]

const BAD_NUMBER_PATTERNS: RegExp[] = [
  /invalid\s*(mumber|number)/i,   // "mumber" 是原始数据里的真实拼写
  /wrong\s*number/i,
]

const NOT_INTERESTED_PATTERNS: RegExp[] = [
  /not\s*interested/i,
  /no\s*interest/i,
  /already\s*(booked|sorted)/i,
  /all\s*sorted/i,
]

const CALLBACK_PATTERNS: RegExp[] = [
  /call\s*(back|me|tomorrow|after|at|next)/i,
  /ring\s*me/i,
  // "call in two weeks after back to NZ" —— 真实数据里写的是英文单词不是数字
  /call\s+in\s+\S+\s*(week|day|month|hour)/i,
  /call\s+after\s+\d+\s*hours?/i,
  /\bcallback\b/i,
]

function anyMatch(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text))
}

/**
 * 只靠规则能确定的部分。AI 不可用时这就是全部结果，
 * AI 可用时这几项仍然覆盖 AI —— 它们比 AI 更该被信任。
 */
export function classifyNote(raw: string): {
  outcome: ContactOutcome
  do_not_contact: boolean
} {
  const t = (raw ?? '').trim()
  if (!t) return { outcome: 'unknown', do_not_contact: false }

  const dnc = anyMatch(t, DNC_PATTERNS)

  // 顺序即优先级：号码是坏的 > 明确拒绝 > 没接通 > 没兴趣 > 约了回电 > 聊过了
  if (anyMatch(t, BAD_NUMBER_PATTERNS)) return { outcome: 'bad_number', do_not_contact: dnc }
  if (dnc) return { outcome: 'do_not_contact', do_not_contact: true }
  if (anyMatch(t, NO_ANSWER_PATTERNS)) return { outcome: 'no_answer', do_not_contact: false }
  if (anyMatch(t, NOT_INTERESTED_PATTERNS)) return { outcome: 'not_interested', do_not_contact: false }
  if (anyMatch(t, CALLBACK_PATTERNS)) return { outcome: 'callback_set', do_not_contact: false }
  return { outcome: 'spoke', do_not_contact: false }
}

// ── AI 层：细微的部分 ────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You turn one line of a New Zealand travel agent's own follow-up note into structured fields.

These notes are terse shorthand typed by a salesperson right after a phone call about China tours. Some are two words ("voice mail"), some carry the whole deal.

Rules:
- summary: ONE short sentence in SIMPLIFIED CHINESE, plain language, for another salesperson to read.
- travel_window: what the CUSTOMER said about when they travel, in their own terms ("明年三月" / "2027 年底"). Null if they never said.
- tour_interest: tour name in ENGLISH exactly as written ("Best of China", "Tale of Two Cities", "Silk Road"). Null if none named.
- competitor: another travel company the customer mentioned using or quoting. Null if none.
- callback_at: only when a specific time was agreed AND you can express it as an ISO 8601 instant. A vague "call next week" is null.
- Never invent. If the note does not say it, the field is null.
- outcome / do_not_contact are decided by rules elsewhere; fill your best guess, it will be overridden.

TWO MISTAKES THAT KEEP HAPPENING — read these twice:

1. A DATE AT THE END OF THE NOTE IS WHEN THE SALESPERSON MADE THE CALL, NOT WHEN THE
   CUSTOMER TRAVELS. "voice message 9 July", "brochure sent 13 July", "nice talk 17 July"
   all mean the agent logged that call on that day. travel_window is null for all of them.
   Only fill travel_window when the note says the CUSTOMER goes then — "wants to travel
   next March", "not until end of next year", "March 2027 departure".

2. THE TOUR NAMES BELOW BELONG TO THE AGENCY ITSELF, NOT TO A COMPETITOR. Seeing one of
   them means the customer is interested in OUR product. competitor is null.
   Nor is a nationality, ethnicity or a person's name a competitor.
   competitor is ONLY a rival travel company the customer says they used, booked with, or
   got a quote from — e.g. "just back from China with Inspiring Vacations".`

const NOTE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    outcome: { type: 'string', enum: [...CONTACT_OUTCOMES] },
    do_not_contact: { type: 'boolean' },
    travel_window: { type: ['string', 'null'] },
    tour_interest: { type: ['string', 'null'] },
    competitor: { type: ['string', 'null'] },
    callback_at: { type: ['string', 'null'] },
    summary: { type: 'string' },
  },
  required: [
    'outcome',
    'do_not_contact',
    'travel_window',
    'tour_interest',
    'competitor',
    'callback_at',
    'summary',
  ],
} as const

/** 解析不出来的时间一律丢掉 —— 存进 timestamptz 列会炸整条记录。 */
function safeInstant(raw: string | null): string | null {
  if (!raw) return null
  const d = new Date(raw.trim())
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * 模型有时把「没有」写成字符串 "null"/"none"/"N/A"。原样存进去，
 * 后面所有「有没有值」的判断都会把它当成有值。
 */
function cleanNullish(v: string | null): string | null {
  if (v == null) return null
  const s = v.trim()
  if (!s) return null
  if (/^(null|none|n\/?a|unknown|not\s*(specified|stated|mentioned))$/i.test(s)) return null
  return s
}

/**
 * 只有真的是别家旅行社才算竞品。
 *
 * 实测被误判成竞品的：客户自己的品牌 "CTS"、客户自己的团名 "Legacy" /
 * "Panorama"、以及销售随手写的族裔 "indian"。这些混进去会让「被谁抢了」
 * 这张表彻底没法看。
 */
function cleanCompetitor(v: string | null, brandTerms: string[]): string | null {
  const s = cleanNullish(v)
  if (!s) return null
  const low = s.toLowerCase()
  if (brandTerms.some((b) => low === b || low.includes(b) || b.includes(low))) return null
  // "another company" 这类没名字的说法留不下情报价值
  if (/^(another|other)\s+(company|agency|operator)$/i.test(s)) return null
  // 单个族裔/国籍词不是公司
  if (/^(indian|chinese|kiwi|maori|asian|european)$/i.test(s)) return null
  return s
}

/**
 * 出行时间里最常见的假阳性：备注末尾的「9 July」其实是销售打电话那天。
 * 提示词已经强调过，这里再兜一道 —— 早于当前年份的年份一律丢掉。
 */
function cleanTravelWindow(v: string | null, now: Date): string | null {
  const s = cleanNullish(v)
  if (!s) return null
  const year = s.match(/(19|20)\d{2}/)
  if (year && Number(year[0]) < now.getFullYear()) return null
  return s
}

/** 客户自己的品牌和团名 —— 出现这些不是竞品，是对我们的产品有兴趣。 */
export const CTS_BRAND_TERMS = [
  'cts',
  'cts tours',
  'china travel service',
  'best of china',
  'tale of two cities',
  'silk road',
  'silk road discovery',
  'shanghai & surroundings',
  'china panorama',
  'panorama',
  'legacy',
  'china legacy',
  'china discovery',
  'china signature',
]

/**
 * 解析一条记录。没有 API key 时退回纯规则版本，
 * 这样导入脚本和测试永远不依赖网络。
 */
export async function parseNote(
  raw: string,
  opts: { brandTerms?: string[]; now?: Date } = {},
): Promise<NoteParse> {
  const brandTerms = (opts.brandTerms ?? CTS_BRAND_TERMS).map((b) => b.toLowerCase())
  const now = opts.now ?? new Date()
  const rules = classifyNote(raw)
  const base: NoteParse = {
    outcome: rules.outcome,
    do_not_contact: rules.do_not_contact,
    travel_window: null,
    tour_interest: null,
    competitor: null,
    callback_at: null,
    summary: raw.trim().slice(0, 120),
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey || !raw.trim()) return base

  try {
    const { default: OpenAI } = await import('openai')
    const client = new OpenAI({ apiKey })
    const res = await client.responses.create({
      model: process.env.CRM_NOTE_MODEL ?? 'gpt-4o-mini',
      input: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: raw },
      ],
      text: { format: { type: 'json_schema', name: 'crm_note', schema: NOTE_JSON_SCHEMA } },
    } as Parameters<typeof client.responses.create>[0])

    const parsed = NoteParseSchema.parse(
      JSON.parse((res as { output_text?: string }).output_text ?? '{}'),
    )

    return {
      ...parsed,
      // 规则赢。「别再联系」不交给 AI 判断，而且两边取并集。
      outcome: rules.outcome,
      do_not_contact: rules.do_not_contact || parsed.do_not_contact,
      // 模型的自由文本字段全部过一遍清洗 —— 实测它会返回字符串 "null"、
      // 把客户自己的团名当竞品、把销售的通话日期当出行时间。
      travel_window: cleanTravelWindow(parsed.travel_window, now),
      tour_interest: cleanNullish(parsed.tour_interest),
      competitor: cleanCompetitor(parsed.competitor, brandTerms),
      callback_at: safeInstant(cleanNullish(parsed.callback_at)),
    }
  } catch {
    // AI 挂了不能让整批导入失败 —— 规则版本已经覆盖了最要紧的三件事。
    return base
  }
}

// 只为测试导出。清洗逻辑是这批数据里最容易回归的部分（提示词一改就漂），
// 必须能被单测直接钉住。
export const cleanNullishForTest = cleanNullish
export const cleanCompetitorForTest = (v: string | null) =>
  cleanCompetitor(v, CTS_BRAND_TERMS.map((b) => b.toLowerCase()))
export const cleanTravelWindowForTest = cleanTravelWindow
