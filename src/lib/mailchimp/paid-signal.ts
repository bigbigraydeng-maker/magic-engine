/**
 * 从 info@ 邮箱的往来里读出「这个人的钱到账了没有」。
 *
 * ## 为什么需要它（PM 2026-09-02 拍板）
 *
 * CTS 的付款事实只存在于 info@ 邮箱：客人转账后发一封回单，Baker 收到钱后回一封
 * 确认。Mailchimp 那边**一个自动化都没有**，`paid_customer` 那 19 个标签是
 * 2026-08-30 有人翻邮箱手工打上去的。手工的代价当天就付了 —— 9/1 那次 192 人的
 * 群发里混进了 2 个已付款客户，其中 Nikki Smith 是 Baker 亲口回过
 * 「your payment has been received in full」的人。
 *
 * ## 唯一可靠的信号是「我们自己说收到了」
 *
 * 这个邮箱里有两种长得几乎一样的邮件：
 *
 *   催款  `Payment of Invoice - Best of China Tour`
 *         "Please find the credit card payment link below: https://..."
 *   收款  `Fw: New Reborn Lead: Nikki Smith`
 *         "Hi Nikki Your payment has been received in full."
 *
 * 两封都含 payment，都由 CTS 发出，都在 Sent Items。**按关键词匹配 `payment`
 * 就打标签，会把正在催款的客人标成付费客户，然后停掉他所有跟进邮件 —— 这单就
 * 丢了。** 所以判据不是「提到钱」，是「我们自己确认钱到账了」。
 *
 * 这跟 `crm/stage-from-conversation` 里那条已经写死的红线是同一条：
 * 一封写着「I'll transfer tomorrow」的邮件不等于钱到账，**看账不看话**。
 * 那个文件因此拒绝判定 deposit_paid / paid_full；这里之所以敢判，是因为只认
 * **我们自己发出去的确认句**，不认客人的任何声明。客人发来的回单截图一律降级成
 * `needs_review`，交给人点一下 —— 宁可多问一句，不可错停一单。
 *
 * ## 三条不许破的线
 *
 * 1. **只认 outbound 的确认句**。inbound 里客人说什么都只到 `needs_review`。
 * 2. **必须交回逐字原话**（铁律 8：绝不凭空注入客户业务数据）。调用方拿 evidence
 *    回原文里核对，对不上就整条丢掉。
 * 3. **只给已经在 Mailchimp 名单里的人打标签**（同 `mailchimp/sync` 的护栏）。
 *    本文件只判「这封信说了什么」，不判「这个人是谁」—— 身份归属在调用方，
 *    因为一封 outbound 的收件人可能是同事、供应商或一封转发。
 *
 * 本文件只有判断，不碰网络、不碰数据库 —— 每条判断都能被单测钉住。
 */

/** 判定结果。`evidence` 一律是原文里逐字截出来的那一句。 */
export type PaidSignal =
  | {
      /** 我们自己确认过钱到账 —— 可以自动打 `paid_customer`。 */
      kind: 'confirmed'
      evidence: string
    }
  | {
      /** 有付款的意思，但不是我们确认的 —— 下发给人点一下，不自动打。 */
      kind: 'needs_review'
      evidence: string
      reason: 'inbound_claim' | 'mixed_with_chasing' | 'forwarded' | 'attachment_only'
    }
  | {
      /** 明确是在催款 —— 这个人**还没付**，碰都不要碰。 */
      kind: 'chasing'
      evidence: string
    }
  | { kind: 'not_payment' }

/**
 * 「我们收到钱了」的确认句。
 *
 * 全部要求出现在 **outbound** 邮件里。措辞取自 info@ 已发送里的真实句子
 * （2026-09-02 抽样）：Baker 写确认时稳定用 received / thank you for the payment
 * 这两类，不用 "got your money" 之类的口语。
 *
 * 刻意**不收**这些看起来也像的：
 *   · "booking is confirmed"  —— 行程确认 ≠ 钱到账，CTS 会先确认位子再收款
 *   · "we have your deposit"  —— 没在真实语料里出现过，凭空加等于放宽判据
 */
const RECEIVED_PATTERNS: readonly RegExp[] = [
  // 允许中间插一个副词：真实语料里有「payment has been **well** received」
  // 和「deposit has **now** been received」。不允许插词是首版最大的假阴性来源。
  /\b(?:your |the )?(?:payment|deposit|balance|funds)\s+(?:has|have|is|was|were)\s+(?:\w+\s+){0,2}?(?:been\s+)?(?:\w+\s+){0,1}?received\b[^.!?\n]*/i,
  // 金额夹在名词和 has been received 之间：「Your deposit of $500.00 has been received」
  // 「Your payment $7760.00 has been received in full」。成交识别（conversions/payment-email-extract）
  // 要靠它取同句金额。无 `of` 时必须带 `$` 或币种代码，避免把「payment 2 has been…」当金额。
  /\b(?:your |the )?(?:(?:balance|final|deposit|full)\s+)?(?:payment|deposit|balance|funds)\s+(?:of\s+(?:(?:NZD|AUD|USD)\s*)?(?:(?:NZ|AU|US)?\$\s*)?|(?:(?:NZD|AUD|USD)\s*)?(?:NZ|AU|US)?\$\s*|(?:NZD|AUD|USD)\s*)[\d,]+(?:\.\d{1,2})?(?:\s*(?:NZD|AUD|USD))?\s+(?:has|have|is|was|were)\s+(?:\w+\s+){0,2}?(?:been\s+)?(?:\w+\s+){0,1}?received\b[^.!?\n]*/i,
  // 真实往来里最常见的口语写法（2026-10-04 对 info@ 已发邮件抽样）：
  // 「Deposit received with thanks」「The payment was received with thanks」「deposit payment received well」。
  // 只收「received with thanks / received well」这两个收尾，不放宽成裸 `deposit received`。
  /\b(?:your |the )?(?:payment|deposit)(?:\s+payment)?\s+(?:is\s+|was\s+)?(?:well\s+)?received\s+(?:with\s+thanks|well)(?=\s*(?:$|[.!?,;\n]|and\b))[^.!?\n]*/i,
  /\bwe(?:'ve| have)\s+received\s+(?:your|the)\s+(?:\w+\s+){0,2}?(?:payment|deposit|balance|funds)\b[^.!?\n]*/i,
  /\breceived\s+(?:your|the)\s+(?:\w+\s+){0,2}?(?:payment|deposit|balance|funds)\b[^.!?\n]*/i,
  /\b(?:thank\s+you|thanks|many\s+thanks)\s+(?:so\s+much\s+|very\s+much\s+|again\s+)?for\s+(?:your|the)\s+(?:\w+\s+){0,2}?(?:payment|deposit)\b[^.!?\n]*/i,
  /\bconfirming\s+receipt\s+of\s+(?:your|the)\s+(?:payment|deposit|balance)\b[^.!?\n]*/i,
  // 裸「payment received」只在它是**主题式独立短句**时才认（句首 + 后面不再跟词）。
  // 首版是裸相邻匹配，被页脚样板「payment received receipts are issued…」直接攻破。
  /(?:^|[.!?]\s+)(?:payment|deposit)\s+received\s*(?=[.!?]|$)/i,
]

/**
 * 中文确认句 —— CTS 员工在 Messenger / WhatsApp 上常用中文确认收款。
 *
 * 与英文 `RECEIVED_PATTERNS` 并列使用，只在 outbound 时生效（同英文）。
 * 中文没有词形变化，但同样有「还没到账」的写法（未收到 / 待收到 / 收到后），
 * 所以命中后必须过 `cnBlocked` 这一关，否则「定金未收到」会被当成已收款。
 */
const CN_RECEIVED_PATTERNS: readonly RegExp[] = [
  /(?:已经?|已)(?:收到|到账)[^。！？!?\n]{0,12}?(?:定金|订金|款项|付款|全款|全额|尾款|余款)[^。！？!?\n]*/,
  /(?:定金|订金|款项|付款|全款|全额|尾款|余款)(?:已经?|已)?(?:收到|到账|入账)[^。！？!?\n]*/,
  /(?:收到|收讫)(?:了)?(?:您的|你的|你们的)?(?:定金|订金|款项|付款|全款|全额|尾款|余款)[^。！？!?\n]*/,
]

/** 中文否定 / 条件 / 疑问词 —— 出现在命中所在分句里就说明钱还没到。 */
const CN_BLOCKERS =
  /未|没有|没|尚未|还没|不曾|待|等到|等|一旦|如果|若|是否|能否|请问|请确认|吗|嘛|？|\?|如|麻烦|请您|请核实|核实|预计|假设|万一|只要|的话|比如|例如|请核对|核对|如有问题|有问题请|请联系|请查收|请查看/

/**
 * 整句级别的阻断词 —— 命中所在**整句**里出现这些就说明钱还没到。
 *
 * 分句级 `CN_BLOCKERS` 只看命中所在分句，管不到「客人说：定金已收到」这种
 * 转述，也管不到「明天转」这种将来时。整句里出现转述 / 模板 / 将来时措辞，
 * 一律降级不认。
 */
const CN_SENTENCE_BLOCKERS =
  /测试|模板|示例|忽略|明天|稍后|晚点|待会|准备转|将转|会转|还没|尚未|没到|客人说|客户说|他说|她说|对方说|你说|他们说|据说|听说|客户已收到|客人已收到|客户已经收到|客人已经收到|客户已付|客人已付|请核实|请核对|如有问题|有问题请|请联系|请查收|请查看/

const CN_MESSAGE_BLOCKERS = /测试|模板|示例|忽略/

/** 命中点**之前**的条件式收尾 —— 「收到后 / 到账后」说明这是将来时。 */
const CN_PREFIX_BLOCKERS = /收到后|到账后|收到之后|到账之后|待收到|等收到/

/** 分句边界（中英文标点都算）。 */
function cnClauseBounds(text: string, index: number): { start: number; end: number } {
  let start = 0
  for (let i = index - 1; i >= 0; i--) {
    if (/[。！？!?\n,，;；]/.test(text[i])) {
      start = i + 1
      break
    }
  }
  let end = text.length
  for (let i = index; i < text.length; i++) {
    if (/[。！？!?\n,，;；]/.test(text[i])) {
      end = i
      break
    }
  }
  return { start, end }
}

/** 命中所在的整句（按句末标点切分）。 */
function cnSentence(text: string, index: number): string {
  let start = 0
  for (let i = index - 1; i >= 0; i--) {
    if (/[。！？!?\n]/.test(text[i])) {
      start = i + 1
      break
    }
  }
  let end = text.length
  for (let i = index; i < text.length; i++) {
    if (/[。！？!?\n]/.test(text[i])) {
      end = i
      break
    }
  }
  return text.slice(start, end)
}

/** 中文命中是否被否定 / 条件 / 疑问挡住。 */
function cnBlocked(text: string, matchIndex: number, matchText: string): boolean {
  const { start, end } = cnClauseBounds(text, matchIndex)
  const clause = text.slice(start, end)
  if (CN_BLOCKERS.test(clause)) return true
  // 分句边界停在 `？`/`?` 上且不含它，所以句末问号要单独看。
  if (text[end] === '？' || text[end] === '?') return true
  if (CN_SENTENCE_BLOCKERS.test(cnSentence(text, matchIndex))) return true
  // Template / ignore markers anywhere in the message void a confirmation (orchestrator fix: next-sentence "请忽略此条").
  if (CN_MESSAGE_BLOCKERS.test(text)) return true
  const before = text.slice(start, matchIndex)
  if (CN_PREFIX_BLOCKERS.test(before)) return true
  // 「收到定金后…」= 将来时：名词后紧跟「后 / 之后」
  return /(?:定金|订金|款项|付款|全款|全额|尾款|余款)(?:之后|后)/.test(matchText)
}

/**
 * 条件 / 将来 / 否定词 —— 出现在确认句**前面**就说明钱还没到。
 *
 * 这是魏征复审攻破首版的那一刀，用一句旅行社发票标准条款：
 *
 *   "Please find the credit card payment link below: https://…
 *    Your booking will be confirmed **once** payment has been received in full."
 *
 * 首版判成 confirmed，于是一个**刚收到付款链接、还没付钱**的客人被打上
 * paid_customer、线索标签被摘光、从此收不到任何跟进 —— 正是本文件开头承诺要防的事故。
 *
 * 同族的还有 "will be issued **after** payment is received"、
 * "cannot hold the seats **until** the deposit has been received"。
 */
const CONDITIONAL_LEADINS =
  /\b(?:once|after|until|till|when|unless|whenever|if|provided|assuming|as\s+soon\s+as|before|upon|subject\s+to|pending|in\s+order\s+to|so\s+that|will\s+be|cannot|can't|won't|not\s+yet|has\s+not|have\s+not|hasn't|haven't)\b/i

/**
 * 催款句 —— 命中这些说明**钱还没到**。
 *
 * 只在没有任何确认句时才判 `chasing`：一封「定金收到了，尾款请点这个链接」
 * 两种句子都有，那个人**确实付过定金**，该算 confirmed。所以顺序是
 * 先找确认句，找不到才看催款句（见 `readPaidSignal`）。
 */
const CHASING_PATTERNS: readonly RegExp[] = [
  /\b(?:credit\s+card\s+)?payment\s+link\b[^.!\n]*/i,
  /\bplease\s+(?:find|use|click)[^.!\n]*\bpayment\b[^.!\n]*/i,
  /\bplease\s+(?:make|complete|arrange)\s+(?:the\s+|your\s+|a\s+)?payment\b[^.!\n]*/i,
  /\b(?:awaiting|pending|outstanding)\s+payment\b[^.!\n]*/i,
  /\bpayment\s+is\s+(?:due|required|outstanding)\b[^.!\n]*/i,
]

/**
 * 客人自己说付了 —— 只到 `needs_review`。
 *
 * 「I'll transfer tomorrow」这种未来式故意**不收**：它连声明都算不上。
 * 收进来的都是已完成时态，人工确认的成本才划算。
 */
const INBOUND_CLAIM_PATTERNS: readonly RegExp[] = [
  /\bproof\s+of\s+(?:payment|account)\b[^.!\n]*/i,
  /\bpayment\s+confirmation\b[^.!\n]*/i,
  /\bi(?:'ve| have)\s+(?:just\s+)?(?:made|paid|transferred|sent)\s+(?:the|your|a)?\s*(?:payment|deposit|money|funds)\b[^.!\n]*/i,
  /\b(?:payment|deposit|money)\s+(?:has\s+been\s+)?transferred\b[^.!\n]*/i,
  /\bpaid\s+the\s+(?:deposit|balance|invoice)\b[^.!\n]*/i,
  // 客人用的是短句，不是完整主谓。真实回信里最常见的就是「Payment done」
  // 「Payment made」这种 —— 少了它们，这句话会被下面的催款判据抢走判成
  // 「我们在催他」，于是一个已经付了钱的客人**永远进不了人工核对名单**。
  /\b(?:payment|deposit|transfer|invoice)\s+(?:is\s+|has\s+been\s+)?(?:done|made|paid|completed|settled|sent)\b[^.!\n]*/i,
  /\bjust\s+(?:paid|transferred|sent)\b[^.!\n]*/i,
]

/**
 * 客人回一句「附件里」就不写别的 —— 付款截图 / 银行回单本身，正文只字不提。
 *
 * 单看 `hasAttachment` 什么都证明不了：一封带附件的询价信（行程单、护照照片）
 * 一样会有附件。只有正文本身**已经在谈付款**（`payment` / `deposit` /
 * `invoice` / `receipt` / `balance` 这类词），证据却止步于文字、真正的凭证
 * 藏在附件里没法读的时候，才够格降级成 `needs_review`。
 */
const ATTACHMENT_PAYMENT_CONTEXT_PATTERNS: readonly RegExp[] = [
  /\b(?:payment|deposit|balance|invoice|receipt)\b[^.!\n]*/i,
]

/** 逐字截出命中的那一句，供调用方回原文核对。截断只是为了日志好读。 */
const EVIDENCE_MAX = 200

/**
 * 「一旦 / 当 / 如果」收到钱 —— 这是**还没发生的事**，不是确认句。
 *
 * 真实语料里就有这种写法：`Once your payment is received, we will send the
 * invoice.` / `Once we have received your payment, ...` /
 * `Until your payment is received, ...` / `Before the payment is received,
 * ...`。它们跟 `Your payment has been received` 长得几乎一样（都含
 * `payment ... received`），但语义完全相反 —— 前者还在等钱，后者钱已经到账。
 * 判断依据是**整个分句**开头是不是条件词，而不是只看紧贴在命中短语前面的
 * 那几个字：「Once we have received your payment」里，条件词 `once` 隔着
 * `we have` 才挨到 `received your payment`，只看紧邻前缀会漏掉它。命中
 * RECEIVED_PATTERNS 后必须回头看它所在分句开头，不然就是把「还没付」判成
 * 「已付」，比催款误判更隐蔽。`until` / `before` 是 2026-09-03 复审补的两个
 * 常见前缀 —— 之前只覆盖了 once/when/if 这类，漏了这两个同样常见的条件句。
 */
const CONDITIONAL_CLAUSE_START =
  /^\s*(?:once|when|if|after|upon|until|before|as\s+soon\s+as|provided\s+that|assuming)\b/i

/** 分句边界：句号/问号/感叹号/换行/逗号 —— 条件从句常见的收尾都在这几个字符上。 */
function clauseStart(text: string, index: number): number {
  for (let i = index - 1; i >= 0; i--) {
    if (/[.!?\n,]/.test(text[i])) return i + 1
  }
  return 0
}

function hasConditionalPrefix(text: string, matchIndex: number): boolean {
  const clause = text.slice(clauseStart(text, matchIndex), matchIndex)
  return CONDITIONAL_CLAUSE_START.test(clause)
}

/** 命中就返回逐字原句；跳过被「once/when/if」等条件句管辖的假命中，继续往后找。 */
function firstMatch(text: string, patterns: readonly RegExp[]): string | null {
  for (const re of patterns) {
    const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
    let m: RegExpExecArray | null
    while ((m = global.exec(text))) {
      if (!hasConditionalPrefix(text, m.index)) return m[0].trim().slice(0, EVIDENCE_MAX)
      if (global.lastIndex === m.index) global.lastIndex += 1
    }
  }
  return null
}

/** 否定词。放在匹配**内部**检查 —— 「payment has not been received」的 not 就在中间。 */
const NEGATION = /\b(?:not|never|nt)\b|n['’]t\b/i

/**
 * 请求 / 询问语气 —— 「我们在问钱到没到」，不是「我们确认钱到了」。
 *
 * 光看句末问号不够（Codex 复审）：出站邮件常写成句号结尾的礼貌请求 ——
 * `Please confirm whether your payment has been received.`
 * `Can you confirm that your payment has been received.`
 * 这两句用问号判据完全漏掉，会把一个**我们自己都还没确认到账**的客人
 * 打成付费客户并停掉跟进。标点不是语气，得看措辞。
 */
const REQUEST_TONE =
  /\b(?:please\s+(?:confirm|advise|check|let)|can\s+you\s+(?:confirm|advise|check)|could\s+you\s+(?:confirm|advise|check)|kindly\s+(?:confirm|advise)|confirm\s+(?:whether|if)|let\s+us\s+know\s+(?:whether|if)|checking\s+(?:whether|if)|wondering\s+(?:whether|if))\b/i

/**
 * 「还没收到 / 应当收到」的将来式：`is yet to be received` / `is due to be received by Friday` /
 * `is required to be received`。它们含 `payment … is … received`，旧正则允许中间夹两个词，
 * 于是被当成确认句（魏征 2026-10-04 复审实测：三句都判成已收到、带金额进自动车道）。
 * 查**命中的整段文本**，不只看命中点之前。
 */
const FUTURE_RECEIVE =
  /\b(?:yet\s+to|due\s+to|required\s+to|expected\s+to|supposed\s+to|going\s+to|about\s+to|need(?:s|ed)?\s+to|must|should|will|would|to)\s+(?:\w+\s+){0,2}?be\s+(?:\w+\s+){0,1}?received\b/i

/** 命中点所在句子的边界（绝对下标）。 */
function sentenceBounds(text: string, index: number): { start: number; end: number } {
  const start =
    Math.max(
      text.lastIndexOf('.', index),
      text.lastIndexOf('!', index),
      text.lastIndexOf('?', index),
      text.lastIndexOf('\n', index),
    ) + 1
  const endRel = text.slice(index).search(/[.!?\n]/)
  return { start, end: endRel === -1 ? text.length : index + endRel + 1 }
}

/**
 * 找一句**真正断言钱已经到账**的确认句。
 *
 * 光匹配 received 的词形不够 —— 必须排掉三类看起来一样、意思相反的：
 *   1. 条件 / 将来（`once payment has been received` → 还没付）
 *   2. 疑问（`has your payment been received?` → 我们在问对方）
 *   3. 否定（`payment has not been received` → 明确没收到）
 */
function findConfirmation(text: string): string | null {
  for (const re of RECEIVED_PATTERNS) {
    const m = re.exec(text)
    if (!m) continue

    const { start, end } = sentenceBounds(text, m.index)
    const sentence = text.slice(start, end)

    // ① 疑问 / 请求语气 —— 我们在问对方收没收到，不是在确认。
    //    问号和措辞都要看：`Please confirm whether your payment has been received.`
    //    是句号结尾的请求，只看标点会漏。
    if (/\?\s*$/.test(sentence.trim())) continue
    if (REQUEST_TONE.test(sentence)) continue

    // ② 否定 —— 「payment has **not** been received」。not 落在匹配**内部**，
    //    所以必须查匹配文本本身，只看前文是查不到的。
    if (NEGATION.test(m[0])) continue
    if (FUTURE_RECEIVE.test(m[0])) continue

    // ③ 条件 / 将来 —— 只看命中点**之前**那一段（绝对下标切，别自己算偏移），
    //    避免被句尾的「…received in full, we will send the itinerary」误伤。
    if (CONDITIONAL_LEADINS.test(text.slice(start, m.index))) continue

    return m[0].trim().slice(0, EVIDENCE_MAX)
  }
  return findCnConfirmation(text)
}

/** 中文确认句 —— 与英文并列，命中后过 `cnBlocked` 排掉否定 / 条件 / 疑问。 */
function findCnConfirmation(text: string): string | null {
  for (const re of CN_RECEIVED_PATTERNS) {
    const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
    let m: RegExpExecArray | null
    while ((m = global.exec(text))) {
      if (!cnBlocked(text, m.index, m[0])) return m[0].trim().slice(0, EVIDENCE_MAX)
      if (global.lastIndex === m.index) global.lastIndex += 1
    }
  }
  return null
}

/**
 * 主题是不是一封转发。
 *
 * Outlook 会叠前缀链：`RE: Fw: China Tour`。首版正则只认开头就是 `Fw:` 的，
 * 员工回复一封转发时 `isForward` 会是 false，于是针对原客户的收款确认句被
 * 自动执行，标签打到当前收件人（代理 / 同事）身上（Codex 复审指出）。
 *
 * 判据：把开头连续的 `Re:` / `Fw:` / `Fwd:` 整条链取出来，链里出现过
 * fw / fwd 就算转发。纯 `Re:` 回复不算 —— 那是正常往来。
 */
export function isForwardedSubject(subject: string | null | undefined): boolean {
  const m = /^((?:\s*(?:re|fw|fwd)\s*:\s*)+)/i.exec(subject ?? '')
  return m ? /\bfwd?\s*:/i.test(m[1]) : false
}

export interface PaidSignalInput {
  /** 主题 + 正文摘要拼起来的可搜文本。 */
  text: string
  /** 这封是我们发出去的还是客人发进来的。 */
  direction: 'inbound' | 'outbound'
  /**
   * 这封是转发吗（主题以 Fw:/FW:/Fwd: 开头）。
   *
   * 转发信的「第一个收件人」常常不是正文里那句话说的人 —— 魏征实测：Baker 把
   * 「your payment has been received in full for Nikki」发给客人的旅行代理，
   * 代理会被打成付费客户并踢出营销名单，真正付钱的 Nikki 什么都没拿到。
   */
  isForward?: boolean
  /**
   * 这封带附件吗。
   *
   * 我在首版把它当死代码删了（当时全仓确实没有路径产出 `attachment_only`），
   * Codex 复审同时把它**真接上了**：`mail-graph` 现在 `$select` 里带
   * `hasAttachments`，客人带转账回单附件发来的信因此能进 needs_review。
   * 合并时保留 Codex 这一侧 —— 信号是真的，只是首版没接线。
   */
  hasAttachment?: boolean
}

/**
 * 读一封邮件，判断它是否证明「这个人的钱到账了」。
 *
 * 判定顺序是有意的，换顺序会出事：
 *
 *   1. 先找**我们自己的确认句** —— 一封「定金收到了，尾款请点链接」两种句子
 *      都有，先看确认句才不会把它误判成催款。只认 outbound。
 *   2. inbound 里先看**客人自己的付款声明** —— 客人回信「I have made the
 *      payment using the payment link below」时，正文里同样含
 *      `payment link` 这个催款关键词，但这封信是客人在说他已经付过款，
 *      不是我们在催他付款。催款句 CHASING_PATTERNS 是从 outbound 视角写的
 *      （「请点链接付款」），套在 inbound 上会把「我已经付了」错判成
 *      「还没付」，然后这个人会继续被群发（2026-09-03 复审发现）。所以
 *      inbound 必须先过一遍客人声明，声明命中就直接 needs_review，不再看
 *      催款句。
 *   3. inbound 声明都没有、但带附件又在谈付款 —— 证据可能就在附件里，同样
 *      只到 needs_review，理由标成 `attachment_only` 方便人工核对时先看
 *      附件。
 *   4. 走到这里说明：outbound 没有确认句，或 inbound 没有声明/附件证据 ——
 *      再看**催款句**。单独标出来而不是并进 not_payment，是为了让调用方
 *      能把它记成「这个人被催过款」，将来做跟进用。
 */
export function readPaidSignal(input: PaidSignalInput): PaidSignal {
  const text = (input.text ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return { kind: 'not_payment' }

  // ① 我们自己确认收款 —— 唯一能自动打标签的信号，且只认 outbound。
  if (input.direction === 'outbound') {
    const confirmed = findConfirmation(text)
    if (confirmed) {
      const chasingToo = firstMatch(text, CHASING_PATTERNS)
      // 同一封信里既确认收款、又在催款：可能是「定金收到了，尾款请点链接」
      // （他确实付过），也可能是一句条款样板混进了催款信（他没付）。
      // 分不出来就**不自动执行** —— 降级成人工确认，这一档本来就是为拿不准准备的。
      if (chasingToo) {
        return { kind: 'needs_review', evidence: confirmed, reason: 'mixed_with_chasing' }
      }
      // 一封转发（Fw:）的收件人常常不是这句话说的那个人 —— 真实语料里
      // 有 `Fw: New Reborn Lead: …`，也有把地接回单转给客人的。降级给人看一眼。
      if (input.isForward) {
        return { kind: 'needs_review', evidence: confirmed, reason: 'forwarded' }
      }
      return { kind: 'confirmed', evidence: confirmed }
    }
  }

  if (input.direction === 'inbound') {
    // ② 客人自己说付了 —— 必须先于催款句判断，否则「I have made the payment
    // using the payment link below」会被 CHASING_PATTERNS 的 `payment link`
    // 抢先命中，误判成还没付。
    const claim = firstMatch(text, INBOUND_CLAIM_PATTERNS)
    if (claim) return { kind: 'needs_review', evidence: claim, reason: 'inbound_claim' }

    // ③ 声明都没有，但带附件、又在谈付款 —— 证据大概率在附件里，别静默丢掉。
    if (input.hasAttachment) {
      const ctx = firstMatch(text, ATTACHMENT_PAYMENT_CONTEXT_PATTERNS)
      if (ctx) return { kind: 'needs_review', evidence: ctx, reason: 'attachment_only' }
    }
  }

  // ④ 没有确认句（outbound）也没有付款声明/附件证据（inbound），却在催款 ——
  // 这个人还没付，明确标出来别碰。
  const chasing = firstMatch(text, CHASING_PATTERNS)
  if (chasing) return { kind: 'chasing', evidence: chasing }

  return { kind: 'not_payment' }
}

/**
 * evidence 必须能在原文里逐字找回来 —— 调用方落库前跑一次。
 *
 * 防的是「判定逻辑改了正则、evidence 变成了拼接出来的句子」这种漂移：
 * 一旦 evidence 不再是原话，铁律 8 那条「说不出原话就不算数」就失效了，
 * 而且**不会报错**，只会安静地开始编。
 */
export function evidenceIsVerbatim(evidence: string, sourceText: string): boolean {
  if (!evidence.trim()) return false
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
  return norm(sourceText).includes(norm(evidence))
}

/**
 * 这个邮箱能不能当成「客人」。
 *
 * 一封 outbound 的收件人可能是同事、供应商，或者一封内部转发 —— 真实语料里
 * 就有 `Fw: New Reborn Lead: ...` 这种转发后又回给客人的信。把同事的邮箱打上
 * `paid_customer` 不只是脏数据，还会把他从所有营销名单里踢出去。
 *
 * ## `ownDomains` 为什么是必填参数、而且没有默认值
 *
 * 首版这里硬编码了 `['ctstours.co.nz']`，并且辩解说「真正的护栏在调用方 ——
 * 只给已在 Mailchimp 名单里的人打标签」。**那条辩解是错的**，子牙复审时用这个
 * 仓库自己的事故记录驳倒了：`mail-ingest.ts` 的注释记着 2026-08-04 的真实事件，
 * `pa@chinatravel.co.nz`（CTS 关联公司的员工）**已经进了客人名单**，客户当场反馈。
 * 同事完全可能自己订阅过、就在 audience 里 —— 「在名单里」根本不是「不是自己人」
 * 的代理判据。唯一能判自己人的就是域名清单。
 *
 * 而域名清单一旦写死成第一个客户，换成 Oztop 这个过滤器就完全失效：一封写着
 * 「payment has been received」、收件人是同事且在名单里的转发，会把这位同事打成
 * 付费客户并摘掉线索标签，从所有群发里消失，没有任何人会发现（平台化红线 2）。
 *
 * 所以域名从客户配置来，由调用方用 `microsoft/mail-ingest` 里已有的
 * `ownDomainsOf(mailbox, clients.domain, leads_config.own_email_domains)` 算好传进来。
 * **不给默认值**：给了默认就等于允许「忘了传」这件事静默发生。
 *
 * `ROBOT_LOCALPARTS` 留在这里 —— 那份清单是真通用的，跟客户无关。
 */
const ROBOT_LOCALPARTS: readonly string[] = [
  'noreply',
  'no-reply',
  'donotreply',
  'do-not-reply',
  'mailer-daemon',
  'postmaster',
  'notifications',
  'bounce',
]

export function looksLikeCustomerAddress(
  address: string | null | undefined,
  ownDomains: readonly string[],
): boolean {
  const email = (address ?? '').trim().toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false
  const [local, domain] = email.split('@')
  const own = ownDomains.map((d) => d.trim().toLowerCase()).filter(Boolean)
  if (own.some((d) => domain === d || domain.endsWith(`.${d}`))) return false
  if (ROBOT_LOCALPARTS.some((r) => local === r || local.startsWith(`${r}+`) || local.startsWith(`${r}-`))) {
    return false
  }
  return true
}
