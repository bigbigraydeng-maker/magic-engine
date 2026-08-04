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
