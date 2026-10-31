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
import { groundNoteParse, noteIsContentFree } from './note-grounding'

export const CONTACT_OUTCOMES = [
  'no_answer',      // 打了没人接 / 语音信箱 / 打不通
  'bad_number',     // 号码本身是错的
  'do_not_contact', // 客户明确说别再联系
  'not_interested', // 聊过了，明确不要了
  /**
   * **暂时**不考虑 —— 「现在不打算」「明年再说」「过段时间再看」。
   *
   * 🔴 跟 `not_interested` 分开是 PM 2026-08-16 定的实际业务事实：
   * 「leads 沟通后会变成暂时不感兴趣、还需要继续营销的，或者明确表达不感兴趣的。」
   * 这两种在系统里的下场必须不一样 —— 前者继续跟，后者才停。
   *
   * 分不开的代价是真实的：线上 17 个人被标成 `not_interested`（终结性、
   * 从此不出现在任何名单上），而按 PM 的说法，其中「明年再说」那类才是多数。
   */
  'not_interested_now',
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
  /**
   * 这句话里**有没有承诺一个还没做的下一步**（不管时间说得清不清）。
   *
   * 跟 `callback_at` 分开的理由：那个是「算不算得出具体时刻」，这个是
   * 「他到底有没有约」。两件事都要知道，才分得清三种结局 ——
   * 约了且算得出（排上了）/ 约了但算不出（要告诉他没排上）/ 压根没约（别啰嗦）。
   * 见 lib/crm/next-step。
   */
  mentioned_next_step: z.boolean().optional(),
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
  // 🔴 `not intending to go` **从这一组移走了**（Codex 复审 2026-08-16）。
  //
  // 它说的是「我不打算去」，不是「别再联系我」。而这一组会把
  // `do_not_contact` **永久写进联系人**（任何渠道都不许再发），是全系统最重的
  // 一个标记。「not intending to go **right now**」这种带时间限定的说法落在
  // 这里，等于一句「今年先不去了」把人永久封死 —— 而它本该是「暂时不考虑」。
  //
  // 现在它落到 NO_INTEREST_PATTERNS（停止营销，可逆），带时间限定时更会
  // 先被 SOFT_NO_PATTERNS 接住。这一组只留**客户真的在划界限**的说法。
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

/**
 * **已经在别家订了** —— 这是一件**已经发生的事实**，不是一种心情。
 *
 * 🔴 单独成组，而且**压过软拒绝**（Codex 复审 2026-08-16）：
 * 「I was thinking about it but already booked with another company」
 * 两边都命中，但前半句是犹豫、后半句是**这单已经没了**。软的赢会让一个
 * 已经在别家下单的人继续收我们的跟进邮件。
 *
 * 事实压过心情 —— 反过来不成立。
 */
const BOOKED_ELSEWHERE_PATTERNS: RegExp[] = [
  // ⚠️ **不能是跟我们订的**（Codex 复审 2026-08-16）：「already booked Best of
  // China **with us**」是一单成交，判成「明确不要了」会把刚成交的客人踢出名单。
  /already\s*(booked|sorted)\b(?!.{0,30}\bwith\s+(us|you|cts)\b)/i,
  /\bbooked\s+(with|through)\s+(another|someone|somebody)/i,
  /all\s*sorted/i,
  // 「已经在别家订了」「找了另一家」——「已经…订」中间常隔着地点词，
  // 「另一家」也和「别家」一样常见，所以这里放宽而不是逐字枚举。
  // ⚠️ 中文这几条同样**不能命中跟我们订的**（Codex 复审 2026-08-16）——
  // 「客户已经跟我们订了 Best of China」「已经订了我们的团」是成交，
  // 判成「明确不要了」会把刚下单的客人踢出跟进名单。CTS 的备注绝大多数是中文，
  // 只给英文加例外等于这个保护对真实数据不生效。
  /已经?(?!.{0,10}(跟|和|在)?我们)(?!.{0,10}我们的).{0,6}(订|预订|报名|买)了/,
  /(找|换)了(别|另|其他).{0,3}家/,
  /(别|另|其他).{0,3}家(订|预订|报名)了/,
]

/** 明确说了没兴趣 —— 一种态度，可以被「暂时」这类时间限定词修饰。 */
const NO_INTEREST_PATTERNS: RegExp[] = [
  /not\s*interested/i,
  /no\s*interest/i,
  // 「我不打算去」不是「别再联系我」—— 原先它在 DNC 组里，一句带时间限定的
  // 「not intending to go right now」会把人**永久封死**。挪到这里（可逆）。
  /not\s*intending\s*to\s*go/i,
  // 中文。原先整组只有英文，而 CTS 员工的通话备注绝大多数是中文写的 ——
  //「客户对旅游不感兴趣」一条都匹配不上，人照旧留在今天的名单里被反复打。
  /不感兴趣/,
  /没有?兴趣/,
  /不想去/,
  /不打算去/,
]

/**
 * **暂时**不考虑 —— 人还在，只是现在不是时候。
 *
 * 🔴 **必须排在 `NOT_INTERESTED_PATTERNS` 前面判**：「暂时不感兴趣」里就含着
 * 「不感兴趣」，先判硬拒绝的话，一句「暂时」当场被吞掉，这个人被永久停掉。
 *
 * 判不准时的偏向：**宁可判成「暂时」**。判错成暂时 = 多发几封跟进邮件（噪音）；
 * 判错成明确不要 = 一个还在考虑的客人从此消失（丢单）。
 */
/**
 * ⚠️ **时间限定词必须贴着「买不买」那件事**（Codex 复审 2026-08-16）。
 *
 * 第一版写成「只要出现『现在不』就算」，于是这些**跟买不买毫无关系**的
 * 日常备注全被判成「暂时不考虑」：
 *
 *   · 「客户**现在不**方便接电话」  → 只是这一刻没空
 *   · 「客户**现在不**在新西兰」    → 只是人在外地
 *
 * 后果不是少发几封邮件那么轻：这个人会被移出真人通话名单（交给系统跟），
 * 还会收到一个「改成短期内不考虑」的阶段提议 —— 一个只是此刻不方便接电话的
 * 客人，被系统judged 成「这阵子别碰他」。
 *
 * 所以时间词只有**修饰购买意向**时才算数：不考虑 / 不感兴趣 / 不打算 / 不想 /
 * 不定 / 不订 / 不去。而 `parseNote` 最终**无条件采用规则结果**（AI 覆盖不了它），
 * 所以宁可这里收窄，也不能靠模型去纠正。
 */
const BUY_INTENT = '(考虑|感兴趣|兴趣|打算|想去|想走|定|订|走|去|出发|报名|买)'
/**
 * 只表示时间的限定词 —— 后面还要再跟一个「不」。
 *
 * ⚠️ **「暂不」不在这里**（Codex 复审 2026-08-16）：它自己**已经含着那个「不」**。
 * 放进来的话，「暂不考虑」会被要求出现第二个「不」而整条漏掉 ——
 * 而它恰恰是销售最常写的那种写法。漏掉的后果分两种，都很糟：
 *   · 「暂不考虑」→ 退化成「聊过了」，这个人白白留在名单上被反复打
 *   · 「暂不感兴趣」→ 命中硬拒绝，**人被永久停掉**，正是本 PR 要修的那件事
 */
const TIME_QUALIFIER = '(暂时|现在|目前|这(段时间|阵子)|近期|最近|眼下)'
/** 自带否定的时间词 —— 后面直接接购买意向，不再要第二个「不」。 */
const TIME_QUALIFIER_WITH_NO = '(暂不|暂时不|暂时没有?|近期不|近期没有?|目前不|目前没有?|现在不|现在没有?|最近不|最近没有?)'

/**
 * 中文的否定不止一个「不」（Codex 复审 2026-08-16）。
 *
 * 🔴 只认「不」的话，**「暂时没兴趣」「现在没有兴趣」整条漏掉** —— 而它们跟
 * 「暂时不感兴趣」一样常见。漏掉之后会落到硬拒绝的 `/没有?兴趣/`，
 * 这个人被**永久停掉**，正是本 PR 要修的那件事；「目前没打算去」更惨，
 * 连硬拒绝都不命中，退化成「聊过了」。
 */
const NEGATION = '(不|没有|没)'
/**
 * 否定和购买意向之间允许隔的东西 —— **不许跨过标点或转折词**
 * （Codex 复审 2026-08-16）。
 *
 * 原先写 `.{0,4}`，于是「客户**目前不**方便，**但想去**」命中了软拒绝：
 * 一个明确说想去、只是此刻不方便的客人，被移出真人名单还收到 defer 提议。
 * 否定词管不到转折后面那半句。
 */
const NEAR = '[^，,。；;、!?！？　 但可是不过然而]{0,3}'

const SOFT_NO_PATTERNS: RegExp[] = [
  // 「暂时/现在/目前」+ 否定 + **跟买卖有关的动词**（中间最多隔 4 个字）
  new RegExp(`${TIME_QUALIFIER}${NEAR}${NEGATION}${NEAR}${BUY_INTENT}`),
  // 「暂不考虑」「暂不感兴趣」—— 否定已经含在时间词里
  new RegExp(`${TIME_QUALIFIER_WITH_NO}${NEAR}${BUY_INTENT}`),
  // 否定在前、时间词在后：「不考虑了，明年再说」这种语序
  new RegExp(`${NEGATION}${BUY_INTENT}${NEAR}${NEAR}${TIME_QUALIFIER}`),
  // 明确把事情推到以后
  /(明年|以后|过段时间|过阵子|晚点|迟些|再过|下半年|年底|开年)再(说|看|联系|考虑|定|议)/,
  /(再看看|再想想|还没(决定|定下来|想好)|考虑一下|考虑考虑|容我考虑)/,
  /(等|要等).{0,8}(再|才)(说|定|联系|考虑)/,
  // 英文。「not interested right now」中间隔着词，所以 not…now 之间放宽 ——
  // 但只放 20 个字符，免得跨过整句去误配（「not going, call me now」）。
  // ⚠️ `ready` 不在这一条里（Codex 复审 2026-08-16）：留着的话
  // 「not ready to talk **yet**, call back tomorrow」还是会被吃掉，
  // 约好的回电一并丢了。`ready` 一律走下面绑住买卖语义的那两条。
  /\bnot\s+(interested|going|intending|planning)\b.{0,20}\b(right now|at the moment|yet|this year)\b/i,
  /\bnot\s+(interested|going)\s+(right\s+)?now\b/i,
  /\bmaybe\s+(later|next\s+year)\b/i,
  // ⚠️ 「还在犹豫」只算**当下仍然犹豫**（Codex 复审 2026-08-16）。
  // 「was thinking about it, but now ready to book」里那半句是**过去时**，
  // 后半句才是结论。裸词会把一个正要成交的人判成「暂时不考虑」、
  // 移出销售名单 —— 而规则结果模型覆盖不了。
  /\b(?:still\s+)?(?:is|are|he's|she's|they're)?\s*think(?:s|ing)?\s+(about\s+it|it\s+over)\b(?!.*\b(now|but)\b.{0,30}\b(ready|book|booking|keen|confirm)\b)/i,
  /\bhave\s+a\s+think\b/i,
  // ⚠️ `ready` / `early` 必须绑住**买卖或出行**（Codex 复审 2026-08-16）：
  // 裸的 `not ready` 会吃掉「not ready to talk, call back tomorrow」——
  // 那明明是约了回电，却被判成「暂时不考虑」，回电时间也一并丢了。
  /\bnot\s+ready\s+(to\s+(book|travel|go|commit|decide|pay)|for\s+(a\s+)?(trip|tour|booking))/i,
  /\btoo\s+early\s+(to\s+(book|decide|plan)|for\s+(a\s+)?(trip|tour|booking))/i,
]

const CALLBACK_PATTERNS: RegExp[] = [
  /call\s*(back|me|tomorrow|after|at|next)/i,
  /ring\s*me/i,
  // "call in two weeks after back to NZ" —— 真实数据里写的是英文单词不是数字
  /call\s+in\s+\S+\s*(week|day|month|hour)/i,
  /call\s+after\s+\d+\s*hours?/i,
  /\bcallback\b/i,
]

/**
 * **他现在就想买** —— 出现这类说法时，前面那半句犹豫一概不算数。
 *
 * 🔴 这是对**一整族问题**的一次性修法（Codex 复审 2026-08-16 第七/八轮）。
 *
 * 前七轮里反复出现同一种形状：一句备注前半句是过去的犹豫、后半句是当下的
 * 结论，而软拒绝词命中了前半句 ——「was thinking about it, **but now ready to
 * book**」「之前不考虑，**但现在想去**」「客户之前说考虑一下，**但现在想报名**」。
 * 每次都给那一条正则单独加负向前瞻，是在按词打地鼠：换个说法就再冒一个。
 *
 * 所以改成**一条独立的判断**，在软拒绝之前先问一句「他现在是不是要买了」。
 * 一条规则覆盖全族，以后再冒新说法只需要往这一个词表里加。
 */
const POSITIVE_INTENT_NOW: RegExp[] = [
  // ⚠️ 中间**不许夹否定词**：「目前**没**打算去」是软拒绝，不是想买。
  /(现在|如今|这次|目前)[^不没未别无]{0,4}(想|要|打算|准备)(报名|订|定|买|走|去|出发|确认)/,
  /(决定|确定)了?[^不没未别无]{0,4}(要|想)?(报名|订|定|买|走|去|出发)/,
  /(now|finally).{0,20}(ready to (book|go|travel|pay)|wants? to (book|go|travel)|keen to (book|go))/i,
  /ready to (book|pay|confirm)/i,
  /(confirmed|going ahead|will book)/i,
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

  // 顺序即优先级：
  //   号码是坏的 > 明确拒绝 > 没接通 > **已经在别家订了** > **暂时**不考虑
  //   > 明确没兴趣 > 约了回电 > 聊过了
  if (anyMatch(t, BAD_NUMBER_PATTERNS)) return { outcome: 'bad_number', do_not_contact: dnc }
  if (dnc) return { outcome: 'do_not_contact', do_not_contact: true }
  if (anyMatch(t, NO_ANSWER_PATTERNS)) return { outcome: 'no_answer', do_not_contact: false }
  // 🔴 **事实压过心情**（Codex 复审 2026-08-16）：「想了想，但已经在别家订了」
  //    两边都命中，前半句是犹豫、后半句是这单已经没了。软的赢会让一个已经
  //    在别家下单的人继续收我们的跟进邮件。
  if (anyMatch(t, BOOKED_ELSEWHERE_PATTERNS)) return { outcome: 'not_interested', do_not_contact: false }
  // 🔴 **明确约好的回电压过软拒绝**（Codex 复审 2026-08-16，一次性解决一整族）。
  //
  //    前几轮反复出现同一种形状：「not ready **to talk**, call back tomorrow」
  //    「not going **to talk** right now, call back tomorrow」—— 软拒绝词吃掉了
  //    前半句，**约好的回电整个丢了**，人还被移去「交给系统跟」。
  //    每次给那一个词单独绑买卖语义，是在按词打地鼠。
  //
  //    真正的关系是：一个**说定了的下一次通话**比一句含糊的「现在还不…」更硬、
  //    更可执行。所以整体提到软拒绝前面，这一族一次性结清。
  if (anyMatch(t, CALLBACK_PATTERNS)) return { outcome: 'callback_set', do_not_contact: false }
  // 🔴 **他现在就想买的话，前面那半句犹豫不算数**（见 POSITIVE_INTENT_NOW）。
  if (anyMatch(t, POSITIVE_INTENT_NOW)) return { outcome: 'spoke', do_not_contact: false }
  // 🔴 软拒绝必须排在「明确没兴趣」前面：「暂时不感兴趣」里含着「不感兴趣」，
  //    反过来判的话那个「暂时」当场被吞掉，人被永久停掉。
  if (anyMatch(t, SOFT_NO_PATTERNS)) return { outcome: 'not_interested_now', do_not_contact: false }
  if (anyMatch(t, NO_INTEREST_PATTERNS)) return { outcome: 'not_interested', do_not_contact: false }
  if (anyMatch(t, CALLBACK_PATTERNS)) return { outcome: 'callback_set', do_not_contact: false }
  return { outcome: 'spoke', do_not_contact: false }
}

/**
 * 存量触点的结果值 —— **读的时候顺手重判一次**。
 *
 * 🔴 没有这一步，这次改动只对**以后**记的笔记生效（Codex 复审 2026-08-16）。
 *
 * 线上那 17 个被标成 `not_interested` 的人，`metadata.outcome` 里存的是旧值；
 * `segmentContact` 一看到它就把人排除，**永远走不到新加的「暂时不考虑」那一支**。
 * 也就是说 PM 明天打开页面，会看到「什么都没变」—— 而这个 PR 存在的全部意义
 * 就是把那批人放回来。
 *
 * 选择在**读的时候**重判、而不是回填数据库：
 *   · 不动客户数据（回填是不可逆操作，得 PM 显式点头）
 *   · 词表以后再改，存量记录跟着一起变，不需要再回填一次
 *   · `raw` 是当时的原话，是**事实**；`outcome` 只是我们对它的解读，解读可以更新
 *
 * 只做**这一个方向**的重判（明确不要 → 暂时不考虑），因为只有它是「旧词表分不出来
 * 的那一类」。绝不反过来把「暂时」升级成「明确不要」—— 那会凭空停掉客人。
 */
export function reclassifyStoredOutcome(
  outcome: string | null | undefined,
  raw: string | null | undefined,
): string | null | undefined {
  if (outcome !== 'not_interested' || !raw) return outcome
  return classifyNote(raw).outcome === 'not_interested_now' ? 'not_interested_now' : outcome
}

// ── AI 层：细微的部分 ────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You turn one line of a New Zealand travel agent's own follow-up note into structured fields.

These notes are terse shorthand typed by a salesperson right after a phone call about China tours. Some are two words ("voice mail"), some carry the whole deal.

Rules:
- summary: ONE short sentence in SIMPLIFIED CHINESE, plain language, for another salesperson to read.
  Keep every customer's name exactly as written in the note. Never translate or transliterate a name.
- travel_window: what the CUSTOMER said about when they travel, in their own terms ("明年三月" / "2027 年底"). Null if they never said.
- tour_interest: tour name in ENGLISH exactly as written ("Best of China", "Tale of Two Cities", "Silk Road"). Null if none named.
- competitor: another travel company the customer mentioned using or quoting. Null if none.
- callback_at: when the salesperson committed to a next step at a nameable time, as an ISO 8601 instant.
  RESOLVE RELATIVE DAYS against TODAY given in the user message — "周五给报价" / "call him Friday"
  / "下周二" / "明天下午3点" are all specific once you know today's date. Use the agency's local
  time zone (also given). If no hour was said, use 09:00 local — the salesperson means "that morning".
  Still null when genuinely vague ("sometime next week", "will call back later") or when no next
  step was promised at all.
- mentioned_next_step: true ONLY when the note promises a follow-up that has NOT happened yet
  ("周五给报价" / "明天再打给他" / "call him back Friday").
  **A COMPLETED action is false**: "刚给他报价了" / "资料发他了" / "已经打过了" / "sent the quote"
  all describe what ALREADY happened — there is no pending next step.
  A customer's TRAVEL date is not a next step either ("客户想 8 月 20 日出发" → false).
  This is independent of callback_at: a vague "下周再联系" is true here but null there.
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
    mentioned_next_step: { type: 'boolean' },
    summary: { type: 'string' },
  },
  required: [
    'outcome',
    'do_not_contact',
    'travel_window',
    'tour_interest',
    'competitor',
    'callback_at',
    'mentioned_next_step',
    'summary',
  ],
} as const

/** 解析不出来的时间一律丢掉 —— 存进 timestamptz 列会炸整条记录。 */
function safeInstant(raw: string | null): string | null {
  if (!raw) return null
  const d = new Date(raw.trim())
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** 回电时间的合理窗口：过去 14 天到未来 2 年。 */
const CALLBACK_PAST_LIMIT_MS = 14 * 86_400_000
const CALLBACK_FUTURE_LIMIT_MS = 730 * 86_400_000

/**
 * 回电时间的合理性校验。
 *
 * 只判断「能不能解析」是不够的：留言里常见「2月20日」这种不带年份的写法，
 * 解析器会自行补一个年份，存进去之后名单上就出现「该回电了 · 1118 天前」。
 * CTS 线上 23 条 callback_at **全部**落在 30 天以前，最早 2023-07-07 ——
 * 没有一条是真的约定。
 *
 * 一个两周前就过期的回电几乎不可能是真实约定，而是解析出错。宁可丢掉，
 * 也不要让名单上出现明显荒谬的时间 —— 那会让销售连带不信整页。
 */
export function saneCallbackInstant(raw: string | null, now: Date = new Date()): string | null {
  const iso = safeInstant(raw)
  if (!iso) return null

  const delta = new Date(iso).getTime() - now.getTime()
  if (delta < -CALLBACK_PAST_LIMIT_MS) return null   // 太久以前 → 多半漏了年份
  if (delta > CALLBACK_FUTURE_LIMIT_MS) return null  // 太远的未来 → 多半年份解析错
  return iso
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
/**
 * 告诉模型「今天是星期几、几号、在哪个时区」。
 *
 * 没有这一句，`callback_at` 对相对日期完全失效 —— 而销售嘴里说出来的下一步
 * 基本都是相对的（「周五」「下周二」「明天上午」），几乎没人说完整日期。
 */
export function todayContext(now: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat('en-NZ', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return `TODAY is ${fmt.format(now)} in ${timeZone}. Resolve any relative day against it.`
}

export async function parseNote(
  raw: string,
  opts: { brandTerms?: string[]; now?: Date; timeZone?: string } = {},
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

  // 没内容可整理（「测试数据」「ok」「.」）：不送 AI，摘要就是原话本身 ——
  // 2026-10-30 事故：「测试数据」被 AI 整理成「客户下周一要求报价」存进了客人档案。
  // 规则层只剩兜底值 `spoke`（没命中任何规则）时，一句没有内容的话不能算「真的聊上了」，
  // 记成 `unknown`；规则明确命中的（没接 / 坏号 / 别再联系…）照旧。
  if (noteIsContentFree(raw)) {
    return { ...base, outcome: rules.outcome === 'spoke' ? 'unknown' : rules.outcome }
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey || !raw.trim()) return base

  try {
    // 走统一封装（而不是自己 new）—— 账户级失效（余额耗尽 / 钥匙失效）
    // 的识别与落库都装在那一层，是全站唯一能一次盖住所有调用点的位置。
    // bypassGateway：这条链路用的是 responses API，从没经过 CF 网关验证过，
    // 只拿拦截、不换路由（见 openai-client.ts 的 OpenAIClientOptions）。
    const { getOpenAIClient } = await import('@/lib/ai/openai-client')
    const client = getOpenAIClient({ apiKey, bypassGateway: true })
    const res = await client.responses.create({
      model: process.env.CRM_NOTE_MODEL ?? 'gpt-4o-mini',
      input: [
        { role: 'system', content: SYSTEM_PROMPT },
        // 今天几号必须告诉它，否则「周五给报价」这类**相对日期**要么返回空、
        // 要么被瞎猜成某个过去的日期（然后被 saneCallbackInstant 丢掉）——
        // 而「说好周五给报价，周五名单上就有他」正是这一栏存在的全部意义。
        { role: 'user', content: `${todayContext(now, opts.timeZone ?? 'Pacific/Auckland')}\n\n${raw}` },
      ],
      text: { format: { type: 'json_schema', name: 'crm_note', schema: NOTE_JSON_SCHEMA } },
    } as Parameters<typeof client.responses.create>[0])

    const parsed = NoteParseSchema.parse(
      JSON.parse((res as { output_text?: string }).output_text ?? '{}'),
    )

    // 模型说的每个事实都要能在员工原话里找到依据，否则拿掉 / 退回原话（见 note-grounding）。
    const grounded = groundNoteParse(raw, parsed)
    return {
      ...grounded,
      // 规则赢。「别再联系」不交给 AI 判断，而且两边取并集。
      outcome: rules.outcome,
      do_not_contact: rules.do_not_contact || parsed.do_not_contact,
      // 模型的自由文本字段全部过一遍清洗 —— 实测它会返回字符串 "null"、
      // 把客户自己的团名当竞品、把销售的通话日期当出行时间。
      travel_window: cleanTravelWindow(grounded.travel_window, now),
      tour_interest: cleanNullish(grounded.tour_interest),
      competitor: cleanCompetitor(grounded.competitor, brandTerms),
      callback_at: saneCallbackInstant(cleanNullish(grounded.callback_at)),
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
