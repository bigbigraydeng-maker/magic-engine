/**
 * 拒绝说法的词表 —— 只放正则，不放判断逻辑。
 *
 * 单独成文件是为了避免循环引用（子牙 2026-11-09 P1-6）：`note-parser.ts` 和
 * `refusal-scope.ts` 都从这里取，谁也不 import 谁的词表。以前 `refusal-scope.ts`
 * 按正则原文（`p.source`）从 `DNC_PATTERNS` 里过滤电话说法，改一个字符过滤就悄悄失效。
 *
 * 业务规则（PM 2026-11-09 定稿）：客人说「不要打电话」只拦电话；任何「所有渠道都别联系」
 * 的说法**一律不许被削弱**。最贵的错 = 把拒绝所有联系的人判成只别打电话（那会放出邮件）。
 * 所以 `phone_only` 是白名单：只有电话说法、没有任何风险词时才成立（见 refusal-scope.ts）。
 *
 * ⚠️ 正则都只有 `i` 标志，**绝不带 `g`**：带 `g` 的 `.test()` 会记住 `lastIndex`，
 * 第二次调用时对时错。
 */

/** 客户明确划清界限、拒绝**所有**联系的说法。宁可多报 —— 漏判是骚扰，误判只是少联系一次。 */
export const FULL_REFUSAL_PATTERNS: RegExp[] = [
  /do\s*not\s*follow\s*up/i,
  /no\s*need\s*(to\s*)?follow\s*up/i,
  /do\s*not\s*want\s*to\s*talk/i,
  /does\s*not\s*want\s*to\s*talk/i,
  /不需要联系/,
  /别再(联系|打)/,
  // 2026-11-09 魏征 P0：旧词表漏掉的全面拒绝。
  /不要(再)?联系/,
  /别联系/,
  /不需要再联系/,
  /unsubscrib/i,
  /(do\s*not|don'?t)\s*contact/i,
  /\bremove\s+me\b/i,
  /\btake\s+me\s+off\b/i,
  /\bDNC\b/i,
  /do\s*not\s*disturb/i,
  // 2026-11-09 魏征复审（169 条探针）补的。方向都是「多拦」。
  /no\s*phone,?\s*no\s*e-?mail/i,
  /never\s*call\s*again/i,
  /no\s*more\s*contact/i,
  // Only an opt-out from messaging/lists. Bare "opt out" also means "skip optional tours" in travel notes.
  /opt(ed)?[\s-]*out\s*(of\s*)?(all|e-?mails?|(the\s*)?(mailing\s*)?list|mailing|newsletter|marketing|contact|messages?)/i,
  /^\s*opt[\s-]*out\s*[.!]*\s*$/i,
  /^\s*stop\s*[.!]*\s*$/i,
  /does\s*not\s*want\s*to\s*be\s*contacted/i,
  /not\s*to\s*be\s*(called|contacted)/i,
  /delete\s*my\s*(number|details)/i,
  /deceased/i,
  /passed\s*away/i,
  /去世/,
  /不要打扰/,
  /别烦我/,
  /不想被联系/,
  /把我从名单删/,
  /永远别打/,
  /再打就投诉/,
  /不要(再)?聯繫/,
]

/** 明确只说「电话」的拒绝。命中它**不等于**只别打电话 —— 还要过风险词（refusal-scope.ts）。 */
export const PHONE_ONLY_PATTERNS: RegExp[] = [
  /不要(再)?(打)?电话/,
  /不要(再)?(給我)?打電話/,
  /别打了/,
  /少打电话/,
  /只(要)?邮件联系/,
  /stop\s*calling/i,
  /\bno\s*(phone\s*)?calls?\b/i,
  /别再?打电话/,
  /不(想|喜欢)(接|听)?电话/,
  /(do\s*not|don'?t)\s*ring(\s*me)?/i,
  /do\s*not\s*(like|want)\s*(phone\s*calls?|phone|calls?)/i,
  /does\s*not\s*(like|want)\s*(to\s*)?(phone\s*calls?|phone|(us\s*to\s*)?calls?)(\s*(me|back))?/i,
  /(do\s*not|don'?t)\s*(want\s*)?(us\s*)?(to\s*)?(call|phone)(\s*(me|back))?/i,
  // 「never call me」「call me back never」以前被读成「约了回电」、真的排上了回电。
  // 认成电话说法，但**不吃掉 never 这个字**（零宽前瞻 / 停在 never 前），
  // 让风险词 never 留在剩余文字里 → needs_review（按全面拒绝）。
  /(?=\bnever\s*(call|phone))/i,
  /call\s*me\s*(back\s*)?(?=never)/i,
]

/**
 * 明确同意走别的渠道（「只要邮件」「请发目录」）。
 * 扫风险词之前先把这些原文拿掉 —— 否则「只邮件联系」里的「联系」、「please send」里的 send
 * 会把一句干净的「只别打电话」误送去人工。先长后短：「email instead」要整段拿掉。
 */
export const OTHER_CHANNEL_OK_PATTERNS: RegExp[] = [
  /prefers?\s*(to\s*be\s*contacted\s*by\s*)?e-?mail/i,
  /\bprefers?\s*(a\s*)?(text|whatsapp|sms|messages?)\b/i,
  /(just|only)\s*(need|want)\s*(the\s*)?(email|e-mail|information|info)/i,
  /\b(only\s*(by\s*)?e-?mail|e-?mail\s*only|e-?mail\s*(is\s*)?ok(ay)?)\b/i,
  /\be-?mail\s*(is\s*)?(fine|better|instead)\b/i,
  /\b(e-?mail|text|sms|whatsapp|message)\s*(me\s*)?instead\b/i,
  /\binstead\b/i,
  /\bonly\s*(by\s*|via\s*)?(whatsapp|text|sms)\b|\b(whatsapp|text|sms)\s*only\b/i,
  /只(要|需要)?(邮件|资料|信息)(联系)?/,
  /发邮件就(行|好|可以)|邮件就(行|好|可以)/,
  /(please\s*)?send\s*(us\s*|me\s*)?(the\s*|our\s*|your\s*)?(2027\s*)?(catalog|catalogue|brochure|information|info|details|email)/i,
  /请发(给我|我)?(一下)?(目录|资料|邮件|行程|报价)/,
]

/**
 * 风险词：电话说法旁边出现任何一个，就说不清他拒的是不是只有电话 → `needs_review`
 * （暂按全面拒绝处理）。英文带词边界，避免 context / mailbox 之类的误配。
 * 「没兴趣」「已经在别家订了」也算风险词（见文件末尾那两组，refusal-scope.ts 里一起查）。
 */
export const RISK_WORD_PATTERNS: RegExp[] = [
  /\b(e-?mail\w*|mail\w*|text\w*|sms|messag\w*|whatsapp|contact\w*|writ\w*|send\w*)\b/i,
  /\b(unsubscrib\w*|remov\w*|list\w*|delet\w*|block\w*|spam\w*|report\w*)\b/i,
  /\b(never|again|ever|alone|harass\w*|complain\w*|deceased|passed|died|bother\w*)\b/i,
  /\bstop\s+everything\b/i,
  /邮件|短信|信息|微信|消息|联系|打扰|发|退订|删除|拉黑|投诉|以后|永远|都别|去世/,
  /郵件|聯繫|發/,
]

/** 约了回电。 */
export const CALLBACK_PATTERNS: RegExp[] = [
  /call\s*(back|me|tomorrow|after|at|next)/i,
  /ring\s*me/i,
  // "call in two weeks after back to NZ" —— 真实数据里写的是英文单词不是数字
  /call\s+in\s+\S+\s*(week|day|month|hour)/i,
  /call\s+after\s+\d+\s*hours?/i,
  /\bcallback\b/i,
]

/**
 * 电话说法带时间限定或对象限定（「今天别打」「周末别打」「别打座机」「别打给她老公」）——
 * 是约时间 / 换号码，不是永久拒绝电话。只在拿掉电话说法之后的剩余文字里找。
 */
export const TIME_LIMIT_PATTERNS: RegExp[] = [
  /\b(until|till|before|after)\b/i,
  /\b(today|tonight|tomorrow|this\s+(week|morning|afternoon|evening)|right\s+now|at\s+the\s+moment)\b/i,
  /\bweekends?\b|\b(mon|tues|wednes|thurs|fri|satur|sun)days?\b/i,
  /\b(mornings?|evenings?|nights?|afternoons?)\b/i,
  /\bat\s+work\b|\b(landline|mobile|cell)\b/i,
  /\b(husband|wife|spouse|partner)\b|\b(his|her)\s+(number|phone|mobile|cell|work)\b/i,
  /今天|今晚|明天|这(周|几天|两天|阵子)|暂时|直到|之前|回电|再打给/,
  /周末|星期[一二三四五六日天]|礼拜[一二三四五六日天]|早上|上午|中午|下午|晚上|上班|座机|手机|老公|丈夫|妻子|太太|老婆/,
]

// ── 从 note-parser.ts 原样挪过来（2026-11-09 魏征 P0-1）────────────────────────
// 「没兴趣 / 已经在别家订了」+ 电话说法，旧代码判 not_interested（停邮件、停 Mailchimp），
// 不能因为句子里多了一句「别打电话」就降成只拦电话 —— refusal-scope.ts 把它们当风险词。

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
export const BOOKED_ELSEWHERE_PATTERNS: RegExp[] = [
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
export const NO_INTEREST_PATTERNS: RegExp[] = [
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
