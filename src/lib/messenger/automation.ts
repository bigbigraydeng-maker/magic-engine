/**
 * 「这条 Page 出站消息是真人客服打的,还是 Meta 的自动回复?」
 *
 * 为什么这件事非分不可(魏征在 PR #673 复审提的):Meta 的 instant reply /
 * away message / Business AI 会替 Page 自动回消息 —— 在 Graph 读接口里,它们和真人
 * 客服完全一样(`from.id === pageId` → direction='outbound'),无法从发信人区分。
 *
 * 如果把自动回复当成「我们联系过」写进触点,后果在 lib/crm/segments 里:一个本该
 * 是 `new_untouched`(从没人碰过)的热新线索,只要 AI 自动回了一句(且回在客户消息
 * 之后),lastOutbound 就被顶成 >0、又进不了 `replied` —— 直接掉出「今天该联系谁」
 * 名单。一条机器人问候把最该打的新线索藏了起来。
 *
 * ── 判定信号(2026-07-29 做过 Graph API 尽调,结论沉淀在 memory)──────────────
 * 读接口里**没有**任何公开文档化、可靠的字段能干净区分 AI vs 真人:
 *   · `app_id` 只出现在 webhook echo,不在 conversations 的 messages 读边(ME 走轮询)。
 *   · `from.{id,name}` 自动回复和真人都= Page 本身。
 *   · **`tags`(`tags.data[].name`)是唯一的「消息来源」信号**。文档确认值含
 *     `inbox` / `read` / `source:chat`(source:chat = 人在收件箱 composer 打的字);
 *     自动化来源(如 Business AI / subscription)带的 `source:` 值官方无文档 ——
 *     需要拿 CTS 真实收件箱的一条 Graph 返回确认一次(见下方常量注释)。
 *
 * ── 判定策略:deny-list,默认真人(零回归)────────────────────────────────
 * 只在有**正面自动化证据**时才判定为自动回复,其余(含未知 source、无 tag、
 * `source:chat`、FDE 经 ME 发的回复)一律当真人。理由:错杀一条真人回复的代价
 * (线索多在名单里露一次面)远小于错信一条机器人问候是真人联系(热新线索被埋)。
 *   1. 结构信号(可靠、免 tag):某条出站消息**前面没有任何客户来信** = 自动欢迎语 /
 *      广播 / 开场自动回复 —— 真人不会(Meta 政策也不允许)先给没留过言的客户发消息。
 *   2. tag 信号:`source:` 命中已知自动化来源集(见 AUTOMATED_MESSAGE_SOURCES)。
 *   3. **速度信号**(2026-08-03 加):客户说完话到我们回复不到 30 秒 —— 真人读完
 *      再打一句有内容的话做不到这个速度。
 *
 * ── 为什么必须加第 3 条 ────────────────────────────────────────────────────
 * 前两条只挡得住「我们先开口」那种开场问候。PM 关心的恰恰是另一种:**客户先说话、
 * Meta 的 AI 客服接着回**。那时 hasPriorInbound=true,tag 又没有确认过的自动化值,
 * 于是判成真人 —— 这个客户就从「客人在等你」里消失了,而实际上**没有任何真人看过
 * 他一眼**。CTS 2026-07-20 开了 Meta AI 客服,这条路上的人一直在漏。
 *
 * 阈值取 30 秒的依据(CTS 真实数据,2026-05-01 起):客户消息后 30 秒内就有回复的
 * 占比,7/20 之后 120/157 = 76%,7/20 之前 314/345 = 91% —— 之前那么高是因为这个
 * 主页早就挂着自动回复。两个时期都说明**秒回=机器**,而这正是要挡的东西。
 * 真人偶尔点一个快捷短语可能也很快,那会被误判成机器 —— 后果只是这个客户在名单上
 * 多留一次,方向是安全的(见上面那条不对称)。
 */

/**
 * `tags` 里被视为「机器人/自动化来源」的 `source:` 值(小写、去掉 `source:` 前缀)。
 *
 * ⚠️ 需对 CTS 真实收件箱确认:`source:chat` 是官方唯一文档化的**真人** composer 来源,
 * 自动化那侧的确切值 Meta 没公开文档。下面是基于 Meta 生态的合理 seed —— 命中即判
 * 自动化,命中不到也**不会误杀真人**(默认真人)。确认到真实值后往这里加一行即可,
 * 全仓无其它地方要改。
 */
const AUTOMATED_MESSAGE_SOURCES = new Set<string>([
  'subscription', // Send-API / bot / subscription messaging
  'business_ai', // Meta Business AI 助手(待用真实收件箱确认确切 tag)
])

/**
 * 快到不可能是真人的回复间隔。
 *
 * 30 秒:真人要读完客户的话、想一下、再打一句有内容的回复。做不到。
 * 不取更长(比如 2 分钟)是因为真人客服盯着收件箱时确实可能一分多钟就回,
 * 那种应该算真人。
 */
const INSTANT_REPLY_MS = 30_000

/**
 * 「转移给你」这条通知之后多久内的出站消息仍算 AI 的收尾话。
 *
 * 依据（CTS 生产 60 天，2026-09-26 只读实测）：73 次「转移给你」里 28 次在 5 秒内
 * 紧跟一条 AI 收尾话；5–15 秒这一段**0 条**；真人接手后最快也在 10 秒以上。
 * 5 秒落在那段空白里，两边都不擦边。
 */
const AI_TAKEOVER_CLOSING_WINDOW_MS = 5_000

/**
 * Meta 在会话里留下的系统通知 —— 这是**唯一**可靠的「AI 现在接不接管」信号。
 *
 * 每条都标了发现日期和 CTS 60 天样本量（2026-09-26 只读实测）。加新文案时照这个
 * 格式补一行，并在 `__tests__/automation.test.ts` 里补一条断言。
 *
 * `mode` 的意思：
 *   · `ai_on`    —— 之后的出站消息都是 AI 发的，直到下一条 `human_on`
 *   · `human_on` —— 真人接手 / Meta 把会话转给真人，之后的出站算真人
 *                   （但紧跟其后 AI_TAKEOVER_CLOSING_WINDOW_MS 内那条仍算 AI 收尾）
 *   · `neutral`  —— 只是告知，不改变谁在回话
 *
 * 通知本身永远不算真人回复 —— 它不是客服说的话。
 *
 * ⚠️ **认不出来的通知文案，方向是危险的那一边，不是安全的那一边。**
 * （魏征复审 2026-09-26 纠正；原注释写反了，说成「最多名单上多留一个人」。）
 *
 * 认不出「AI 将会回复」那条 → `aiHasTheThread` 永远不会被打开 → 紧跟其后的
 * AI 回复落到旧判据，间隔超过 30 秒就被判成**真人回复** → 那个客人显示成
 * 「我们联系过了」→ 掉出「今天该联系谁」。这正是本模块要消灭的那个错本身。
 *
 * 全库目前没见过英文版通知（所有客户都没有），但 Meta 随时可能改文案或换语言。
 * 所以「每天扫一遍近 7 天含 AI / 客服字样的系统通知、跟这张表比对、对不上的进
 * 待办」（M3）**不是锦上添花，是这道判据的安全网**，必须跟接线同一轮或更早上线。
 */
type AiNoticeMode = 'ai_on' | 'human_on' | 'neutral'

interface AiNoticePattern {
  /** 出站消息正文的开头。比对前会 trim + 去零宽字符。 */
  prefix: string
  mode: AiNoticeMode
  /**
   * 这条 `human_on` 通知之后极短窗口内那条出站，是不是仍算 AI 的收尾话。
   *
   * **只有「转移给你」有证据支持**（CTS 60 天：73 次里 28 次在 5 秒内紧跟一条
   * AI 收尾话，5–15 秒区间 0 条，真人最快 >10 秒）。
   *
   * 「你已接管」**没有**同类证据 —— 那是真人主动点了接管，5 秒内出现的话很可能是
   * 他早就打好按下发送的。对它也套这个窗口会吞掉真人回复：2026-09-26 拿 CTS 真实
   * 数据实测，套了之后「整条会话没有真人回复」从 377 变成 379，多算的那 2 条正是
   * 接管后 5 秒内的真人回复。所以这个窗口按通知逐条声明，不按 mode 一刀切。
   */
  closingWindow?: boolean
  /** 发现日期 + CTS 60 天样本量，供后来人判断这条还成不成立。 */
  seen: string
}

const AI_NOTICE_PATTERNS: readonly AiNoticePattern[] = [
  { prefix: '你的 AI 客服将会回复', mode: 'ai_on', seen: '2026-09-26 · 239 条' },
  { prefix: '你的 AI 客服已将这个聊天转移给你', mode: 'human_on', closingWindow: true, seen: '2026-09-26 · 53 条（另有带「请训练你的 AI…」后缀 7 条、「…因为客户已准备购买。」1 条）' },
  { prefix: '你已接管', mode: 'human_on', seen: '2026-09-26 · 46 条' },
  // 下面两条只是告知，不改变谁在回话。漏掉它们会把一条通知误当成真人回复。
  { prefix: '你的 AI 客服', mode: 'neutral', seen: '2026-09-26 · 兜底：上面两条更具体的先匹配，其余「你的 AI 客服…」一律中性' },
]

/**
 * 「XX 回复了一条广告。」「A 把这个对话分配给了 B。」这类 —— 中性通知，
 * 不改变谁在回话，本身也不算真人回复。
 * 样本（2026-09-26）：广告回复通知 CTS 52 / NAL 114；分配对话通知 NAL 23。
 */
const NEUTRAL_NOTICE_SUFFIXES: readonly string[] = ['回复了一条广告。', '把这个对话分配给了']

/** 零宽字符会让前缀比对落空（编码、复制粘贴都可能带进来）。比对前一律去掉。 */
const ZERO_WIDTH_RE = /[\u200b\u200c\u200d\ufeff]/g

/** 比对前的规范化：去零宽 + trim。 */
export function normaliseNoticeText(body: string): string {
  return body.replace(ZERO_WIDTH_RE, '').trim()
}

/**
 * 这条出站消息是不是 Meta 的系统通知？是的话它把「谁在回话」切到哪一档？
 * 返回 null = 不是已知通知（可能是真人的话，也可能是 AI 说的内容）。
 */
export function classifyAiNotice(body: string): AiNoticeMode | null {
  return matchAiNotice(body)?.mode ?? null
}

/**
 * 同 `classifyAiNotice`，但把命中的那条 pattern 整个给出来 —— walker 需要知道
 * 这条 `human_on` 要不要套「5 秒收尾话」窗口（只有「转移给你」要，见 closingWindow）。
 */
function matchAiNotice(body: string): AiNoticePattern | null {
  const text = normaliseNoticeText(body)
  if (text.length === 0) return null
  for (const suffix of NEUTRAL_NOTICE_SUFFIXES) {
    if (text.includes(suffix)) return { prefix: suffix, mode: 'neutral', seen: 'NEUTRAL_NOTICE_SUFFIXES' }
  }
  for (const p of AI_NOTICE_PATTERNS) {
    if (text.startsWith(p.prefix)) return p
  }
  return null
}

export interface PageMessageSignal {
  /** 这条消息的 `tags.data[].name` 列表(原样,可能含 `source:chat` 等)。 */
  tags: string[]
  /**
   * 这条出站消息**之前**,同一线程里是否已经有过客户来信。
   * false = 我们先开的口 = 自动欢迎语/广播,不可能是真人在回客户。
   */
  hasPriorInbound: boolean
  /**
   * 距离**紧挨着它前面那条客户来信**过了多少毫秒。
   *
   * null / undefined = 不知道(老数据、回补历史)—— 这时不用这条判据,
   * 按 deny-list 的原则默认真人,不猜。
   */
  msSincePriorInbound?: number | null
}

/** 从 tags 里抽出 `source:*` 的来源名(小写、去前缀)。 */
function sourceTags(tags: string[]): string[] {
  const out: string[] = []
  for (const t of tags) {
    const lower = t.toLowerCase()
    if (lower.startsWith('source:')) out.push(lower.slice('source:'.length))
  }
  return out
}

/**
 * 这条 **Page 出站** 消息是不是自动回复(而非真人客服)。
 * 只应对 outbound 调用;inbound(客户来信)永远是真人,不走这里。
 *
 * 默认真人:只有正面证据(先开口 / 命中自动化来源)才判自动化。
 */
export function isAutomatedPageMessage(signal: PageMessageSignal): boolean {
  // 1) 我们先开口、客户还没留过言 —— 只可能是自动欢迎语/广播/开场自动回复。
  if (!signal.hasPriorInbound) return true

  // 2) 来源 tag 命中已知自动化来源。
  if (sourceTags(signal.tags).some((s) => AUTOMATED_MESSAGE_SOURCES.has(s))) return true

  // 3) 秒回 —— 真人读完再打一句有内容的话做不到(见文件头的数据)。
  //    不知道间隔(老数据)时不判,按默认真人走。
  const gap = signal.msSincePriorInbound
  if (typeof gap === 'number' && gap >= 0 && gap < INSTANT_REPLY_MS) return true

  // 其余一律当真人:真人 composer(source:chat)、未知来源、无 tag、FDE 经 ME 的回复。
  return false
}

/** `lastHumanPageReplyAt` 的入参：一条消息在会话里的样子。 */
export interface ThreadMessage {
  direction: 'inbound' | 'outbound'
  body: string
  /** ISO 时间。 */
  sentAt: string
  tags: string[]
  /**
   * 这条出站消息在 `conversation_outbound_log` 里对得上、**而且是真人经 ME 发的**。
   *
   * 优先级最高：这是最硬的证据（我们自己的发送记录里写着谁发的）。它同时修掉
   * link-contacts 记着的那个根因 —— 销售在 ME 里秒回被速度判据当成机器。
   * 机器身份（自动安抚）经 ME 发出的要传 false。
   */
  sentByHumanViaMe?: boolean
}

/**
 * 整条会话走一遍，返回**最后一次真人回复**的时间；一次都没有则 null。
 *
 * 判定顺序（对每条出站消息）：
 *   1. `sentByHumanViaMe === true` → 真人。不管 AI 是否在接管、也不管是不是秒回。
 *   2. 是已知系统通知 → **不算真人**，但按 mode 切换「谁在回话」。
 *   3. AI 接管期间 → 机器。包括第 60 / 120 分钟那种「还感兴趣吗」追问 ——
 *      所以「回得慢就是真人」这条路走不通，必须靠通知定档。
 *   4. 其余 → 交给既有的 `isAutomatedPageMessage`（先开口 / 来源 tag / 秒回）。
 *
 * 不认识的通知文案落到第 4 步，也就是默认真人 —— 跟本文件既有的 deny-list 原则一致：
 * 错杀真人（线索多露一次面）远比错信机器是真人（热线索被埋）轻。
 */
export function lastHumanPageReplyAt(messages: readonly ThreadMessage[]): string | null {
  // 🔴 按**时刻**排，不能按字符串排（魏征复审 2026-09-26 抓到，已复现）。
  // ISO 时间的写法不止一种：`…T10:00:00Z` 和 `…T22:00:00+12:00` 是同一时刻，
  // 但字符串比较会把后者排到前者后面很远。实测一条：客人 09:59Z 来信 →
  // AI 接管通知写成 22:00+12:00 → AI 回复写成 10:01Z，字符串排序得到
  // 「来信 → AI 回复 → 通知」，于是那条 AI 回复在「还没接管」的状态下被判成
  // **真人回复** —— 正好是这个模块要消灭的那个错。
  // 解析不出来的时间排到最后：不知道它在哪，就别让它去改变前面那些的判定。
  const at = (v: string): number => {
    const t = Date.parse(v)
    return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t
  }
  const ordered = [...messages].sort((a, b) => at(a.sentAt) - at(b.sentAt))

  let aiHasTheThread = false
  /** 最近一条 `human_on` 通知的时间 —— 用来判「转移给你」后 5 秒内的收尾话。 */
  let humanOnAt: number | null = null
  let lastInboundAt: number | null = null
  let lastHuman: string | null = null

  for (const m of ordered) {
    const at = Date.parse(m.sentAt)
    const atMs = Number.isNaN(at) ? null : at

    if (m.direction === 'inbound') {
      lastInboundAt = atMs
      continue
    }

    // 1) 我们自己的发送记录说这是真人发的 —— 最硬的证据，先判。
    if (m.sentByHumanViaMe === true) {
      lastHuman = m.sentAt
      continue
    }

    // 2) 系统通知：本身不算真人，但会切换「谁在回话」。
    const notice = matchAiNotice(m.body)
    if (notice !== null) {
      if (notice.mode === 'ai_on') {
        aiHasTheThread = true
        humanOnAt = null
      } else if (notice.mode === 'human_on') {
        aiHasTheThread = false
        // 只有「转移给你」才武装收尾话窗口；「你已接管」是真人主动点的，
        // 他 5 秒内发出的话算他自己的（见 closingWindow 注释里的实测）。
        humanOnAt = notice.closingWindow === true ? atMs : null
      }
      continue
    }

    // 3) 「转移给你」之后极短窗口内那条，仍是 AI 的收尾话。
    if (humanOnAt !== null && atMs !== null && atMs - humanOnAt <= AI_TAKEOVER_CLOSING_WINDOW_MS) {
      continue
    }

    // 4) AI 接管期间的出站一律算机器（含长间隔的追问）。
    if (aiHasTheThread) continue

    // 5) 其余交给既有判据。
    const automated = isAutomatedPageMessage({
      tags: m.tags,
      hasPriorInbound: lastInboundAt !== null,
      msSincePriorInbound: lastInboundAt !== null && atMs !== null ? atMs - lastInboundAt : null,
    })
    if (!automated) lastHuman = m.sentAt
  }

  return lastHuman
}
