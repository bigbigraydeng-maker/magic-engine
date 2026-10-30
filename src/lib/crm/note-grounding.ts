/**
 * 员工笔记的「不许编」闸（2026-10-30）。
 *
 * 事故：员工记「测试数据」，AI 整理出 「客户下周一要求报价。」存进客人档案 ——
 * 笔记里根本没有这件事。客人档案里的每一句话都会被下一个同事当事实读，
 * 凭空多出一条「客户要报价」比什么都不写糟得多（CLAUDE.md 铁律 8：绝不凭空注入客户业务数据）。
 *
 * 原则：**员工原话（`raw`）是真相源，AI 整理只能是它的改写，不能比它多。**
 * 做法是确定性的后验，不再信模型自觉：
 *   1. 笔记短到/空到没有内容（「测试数据」「ok」「.」）→ 摘要直接用原话，不送 AI。
 *   2. 摘要里出现的每一个具体事实词（数字、日期/星期、报价/预订/取消这类动作、英文专名）
 *      都必须能在原话里找到依据，否则整条摘要作废、退回原话。
 *   3. 出行时间 / 团名 / 竞品 / 回电时间 / 「有下一步」同样要在原话里有依据，否则置空。
 *   4. 摘要漏掉了原话里的具体词（团名、「14 days」、金额）→ 补在摘要后面，不丢。
 *
 * 这里只依赖纯字符串，不碰网络，测试可以直接钉住。
 */

import type { NoteParse } from './note-parser'

const STRIP_RE = /[\s\p{P}\p{S}]/gu

/** 明显的占位 / 测试输入。 */
const PLACEHOLDER_RE = /^(测试|试试|test|testing|asdf+|x+|ok|okay|k|n\/?a|na|none|nil|无|没有|没事|暂无)(数据|一下|data|note)?$/i

/** 去掉空白和标点后剩下的「有意义字符」。 */
function meaningful(raw: string): string {
  return raw.replace(STRIP_RE, '')
}

/**
 * 这条笔记有没有内容可整理。
 *
 * 判据偏保守 —— 「判成没内容」的代价只是摘要退回原话（永远安全），
 * 「判成有内容」的代价才是让模型有机会编。
 */
export function noteIsContentFree(raw: string): boolean {
  const m = meaningful(raw ?? '')
  if (!m) return true
  if (PLACEHOLDER_RE.test(m)) return true
  const cjk = (m.match(/[一-鿿]/g) ?? []).length
  const words = (raw.match(/[A-Za-z]{2,}/g) ?? []).length
  const digits = (raw.match(/\d/g) ?? []).length
  // 不是占位词，且连 2 个汉字 / 2 个英文词 / 一个数字都没有（单个字、单个词、「好」「.」）。
  // 🔴 之前的门槛是「汉字 < 6」，把「周五回电」「明天再打」「发了报价」「客户说贵」这类短而真的笔记
  // 当成没内容、不送模型，回电时间丢了（魏征复审 PR #3417 P1-1）。只要不是占位词、有 ≥2 个汉字就算有内容；
  // 编造的风险由下面的后验拦，不靠「短」来防。
  return cjk < 2 && words < 2 && digits === 0
}

// ── 摘要里的「具体事实词」必须在原话里有依据 ────────────────────────────

interface ClaimRule {
  /** 摘要里出现这个词 …… */
  inSummary: RegExp
  /** …… 原话里就必须出现其中之一（中文原词或英文对应说法）。 */
  inNote: RegExp
}

const CLAIM_RULES: ClaimRule[] = [
  { inSummary: /报价|报个价/, inNote: /报价|quote|quotation|price|pricing|多少钱|价格|费用|cost/i },
  { inSummary: /要求|请求|索要/, inNote: /要求|想要|需要|(?<![不没别无未])要|请|求|问|request|ask|(?<!(?:do not |don'?t |not ))need|(?<!(?:do not |don'?t |not ))want|require/i },
  { inSummary: /预订|订团|报名/, inNote: /订|报名|book|reserv|sign(ed)?\s*up/i },
  { inSummary: /付款|支付|已付|定金/, inNote: /付|定金|pay|paid|deposit/i },
  { inSummary: /取消/, inNote: /取消|cancel/i },
  { inSummary: /拒绝|婉拒|放弃/, inNote: /不|没|拒|别|无|未|算了|放弃|\bno\b|\bnot\b|n't|decline|refus|never|cancel/i },
  { inSummary: /不再联系|别再联系|不要再联系|停止联系/, inNote: /别再|不再|不要.{0,6}联系|不用.{0,6}联系|不需要联系|do\s*not|don'?t|stop|no\s*more|unsubscribe|no\s*need/i },
  { inSummary: /退款|退钱/, inNote: /退|refund/i },
  { inSummary: /投诉|不满/, inNote: /投诉|不满|complain|unhappy|upset/i },
  { inSummary: /预算/, inNote: /预算|budget/i },
  { inSummary: /邮件|邮箱|email/i, inNote: /邮件|邮箱|email|e-mail|mail/i },
  { inSummary: /发送|发了|已发|寄/, inNote: /发|寄|send|sent|mail|email/i },
  { inSummary: /回电|回拨|再打|致电/, inNote: /回电|回拨|再打|打给|打电话|call|ring|phone|callback|致电/i },
  { inSummary: /同行|竞争|其他公司|别家/, inNote: /同行|竞|别家|另一家|其他|another|other|compet|with\s+\w+/i },
  { inSummary: /感兴趣|有兴趣|兴趣/, inNote: /兴趣|感兴趣|想去|想|interest|keen|curious|考虑|可能|maybe|might|consider/i },
  // 日期 / 星期 / 相对时间
  { inSummary: /周一|星期一/, inNote: /周一|星期一|礼拜一|\bmon(day)?\b/i },
  { inSummary: /周二|星期二/, inNote: /周二|星期二|礼拜二|\btue(s|sday)?\b/i },
  { inSummary: /周三|星期三/, inNote: /周三|星期三|礼拜三|\bwed(nesday)?\b/i },
  { inSummary: /周四|星期四/, inNote: /周四|星期四|礼拜四|\bthu(r|rs|rsday)?\b/i },
  { inSummary: /周五|星期五/, inNote: /周五|星期五|礼拜五|\bfri(day)?\b/i },
  { inSummary: /周六|星期六/, inNote: /周六|星期六|礼拜六|\bsat(urday)?\b/i },
  { inSummary: /周日|周天|星期日|星期天/, inNote: /周日|周天|星期日|星期天|礼拜天|\bsun(day)?\b/i },
  { inSummary: /下周|下星期|下礼拜/, inNote: /下周|下星期|下礼拜|next\s*week/i },
  { inSummary: /明天/, inNote: /明天|tomorrow/i },
  { inSummary: /后天/, inNote: /后天|day after tomorrow/i },
  { inSummary: /今天|今晚/, inNote: /今天|今晚|today|tonight/i },
  { inSummary: /下个月|下月/, inNote: /下个月|下月|next\s*month/i },
  { inSummary: /明年/, inNote: /明年|next\s*year/i },
  { inSummary: /月底/, inNote: /月底|end of (the )?month/i },
  { inSummary: /年底/, inNote: /年底|end of (the |next )?year/i },
  { inSummary: /上午|早上/, inNote: /上午|早上|morning|\bam\b/i },
  { inSummary: /下午/, inNote: /下午|afternoon|\bpm\b/i },
  { inSummary: /晚上/, inNote: /晚上|evening|night/i },
]

/** 摘要说「已经发生」的事（已预订 / 已付款 / 已成交…），原话里必须有「已完成」的说法，光是想订不行。 */
const COMPLETED_IN_SUMMARY_RE = /已预订|已订|订了|已付款|已支付|已付|已成交|已确认|已报名|已购买|已缴/
const COMPLETED_IN_NOTE_RE = /已|订了|付了|定了|买了|成交|搞定|\b(booked|paid|confirmed|bought|signed|purchased|sorted|deposit\s*paid|paid\s*deposit)\b/i

/** 否定 / 拒绝：原话里的写法。 */
const NEG_NOTE_RE = /不|没|别|无|未|拒|算了|放弃|\bno\b|\bnot\b|n't|\bnever\b|without|cannot|decline|refus|unsubscribe/i
/** 否定 / 拒绝：摘要里的写法（拒绝 / 放弃 里没有「不」字，要单列）。 */
const NEG_SUMMARY_RE = /不|没|别|无|未|拒绝|婉拒|放弃/

/** 摘要里的英文词（≥3 字母）：专名、团名，必须原样出现在原话里。 */
function latinTokens(s: string): string[] {
  return s.match(/[A-Za-z][A-Za-z&'-]{2,}/g) ?? []
}

/** 摘要里的数字串，原话里必须有同样的数字。 */
function digitRuns(s: string): string[] {
  return s.match(/\d+/g) ?? []
}

/**
 * 摘要里有没有哪句话是原话撑不住的。返回第一个无依据的词；全有依据返回 null。
 */
export function firstUngroundedClaim(summary: string, raw: string): string | null {
  for (const d of digitRuns(summary)) {
    if (!raw.includes(d)) return d
  }
  const lowRaw = raw.toLowerCase()
  for (const w of latinTokens(summary)) {
    if (!lowRaw.includes(w.toLowerCase())) return w
  }
  for (const rule of CLAIM_RULES) {
    const hit = summary.match(rule.inSummary)
    if (hit && !rule.inNote.test(raw)) return hit[0]
  }
  // 「已完成」的事实需要原话里有「已完成」的说法。
  const done = summary.match(COMPLETED_IN_SUMMARY_RE)
  if (done && !COMPLETED_IN_NOTE_RE.test(raw)) return done[0]
  // 意思翻转：原话有否定、摘要没有（「不要报价」→「要求报价」「没兴趣」→「感兴趣」），
  // 或摘要有否定 / 拒绝、原话一点否定都没有（「可能感兴趣」→「明确拒绝」）。宁可退回原话。
  const noteNeg = NEG_NOTE_RE.test(raw)
  const sumNeg = NEG_SUMMARY_RE.test(summary)
  if (noteNeg && !sumNeg) return '否定被丢了'
  if (sumNeg && !noteNeg) return '凭空出现否定'
  return null
}

// ── 原话里的「具体词」：摘要不许丢 ───────────────────────────────────────

/** 数量 + 单位（14 days / 3 nights / 两人 / 14天）与金额。 */
const CONCRETE_RE = /\$\s?\d[\d,]*(?:\.\d+)?|\d+\s*(?:days?|nights?|pax|people|persons?|adults?|天|晚|人|位|岁)/gi

function concreteTermsOf(raw: string, tourInterest: string | null): string[] {
  const out: string[] = []
  for (const m of raw.match(CONCRETE_RE) ?? []) out.push(m.trim())
  if (tourInterest) out.push(tourInterest)
  return out
}

function includesLoose(hay: string, needle: string): boolean {
  const norm = (x: string) => x.toLowerCase().replace(/\s+/g, '')
  return norm(hay).includes(norm(needle))
}

// ── 下一步 / 回电：原话里得真有这类说法 ──────────────────────────────────

const NEXT_STEP_CUE_RE =
  /下周|明天|后天|今天|今晚|周[一二三四五六日天]|星期[一二三四五六日天]|礼拜|\d+\s*[月号日点]|[点:：]\d|再打|再联系|回电|回拨|跟进|稍后|过几天|call\s*(him|her|them|back)|callback|follow\s*up|tomorrow|tonight|next\s*week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\b\d{1,2}\s*(am|pm)\b|\d{1,2}[:.]\d{2}/i

/** 出行时间：原话里要有时间性的词或数字。 */
const TIME_CUE_RE =
  /\d|明年|今年|后年|下个?月|月|年|季|春|夏|秋|冬|周|next|year|month|spring|summer|autumn|winter|fall|christmas|easter|early|late|end of|later|soon/i

/**
 * 把 AI 的解析结果按原话「落地」：没有依据的事实一律拿掉。
 * `parsed` 的 outcome / do_not_contact 由调用方（规则层）另行覆盖，这里不动。
 */
export function groundNoteParse(raw: string, parsed: NoteParse): NoteParse {
  const note = (raw ?? '').trim()
  const verbatim = note.slice(0, 120)

  // 字段级：在原话里找不到依据就置空。
  const tour =
    parsed.tour_interest && includesLoose(note, parsed.tour_interest) ? parsed.tour_interest : null
  const competitor =
    parsed.competitor && includesLoose(note, parsed.competitor) ? parsed.competitor : null
  const travel =
    parsed.travel_window && TIME_CUE_RE.test(note) && firstUngroundedClaim(parsed.travel_window, note) === null
      ? parsed.travel_window
      : null
  const hasCue = NEXT_STEP_CUE_RE.test(note)
  const callback = hasCue ? parsed.callback_at : null
  const nextStep = hasCue ? parsed.mentioned_next_step : false

  // 摘要：空 / 有一句话原话撑不住 → 整条退回原话。
  const ai = (parsed.summary ?? '').trim()
  let summary = ai
  if (!ai || firstUngroundedClaim(ai, note) !== null) {
    summary = verbatim
  } else {
    // AI 改写没编造，但可能丢了团名 / 天数 / 金额 —— 补在后面，不丢。
    const missing = concreteTermsOf(note, tour).filter((t) => !includesLoose(ai, t))
    if (missing.length > 0) summary = `${ai.replace(/[。.]+$/, '')}（${Array.from(new Set(missing)).join('、')}）`
  }

  return {
    ...parsed,
    tour_interest: tour,
    competitor,
    travel_window: travel,
    callback_at: callback,
    mentioned_next_step: nextStep,
    summary,
  }
}
