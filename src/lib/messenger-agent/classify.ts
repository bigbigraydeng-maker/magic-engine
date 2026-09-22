/**
 * 售前留资 vs 售后 —— 一段对话属于哪一类，Messenger 和 WhatsApp 共用这一段查询逻辑，
 * 但判据本身按行业/客户注入，不在这个共享函数里写死。
 *
 * ## 为什么要抽出来
 *
 * 3 审第 1 轮子牙 B1 blocker（v3 方案 `~/.claude/plans/cts-tours-messenger-dynamic-pearl.md`）：
 * 原设计是 F2（WhatsApp 那条线）靠「等 F1（Messenger）发完事件」来判断「这段对话
 * 要不要继续走自动回复」，会跟 opt-out 检查互相卡死。改成 F1/F2 各自独立调用
 * 这同一个纯函数，谁也不等谁。
 *
 * `conversation_messages` 表 Messenger / WhatsApp 两个渠道共用（见
 * `src/lib/messaging/adapters/messenger.ts` 和 `whatsapp.ts` 里对同一张表的读法），
 * 所以这里**不需要按渠道分支** —— 只读 `body` / `sent_at`，不认渠道。
 *
 * ## 判据不写死在共享函数里（Codex 复审 P1）
 *
 * "booking" / 30 天这类判据只对旅游场景成立 —— 地产客户收到「我想约一个 appraisal
 * booking」这种售前留资消息，一样会命中 "booking"。这些判据必须由调用方通过
 * `PostSaleClassificationPolicy` 显式传入，共享函数本身不带任何行业默认值。
 * 旅游行业（issue #1576，CTS Tours 等）的具体判据放在下面的 `TOURISM_POST_SALE_POLICY`，
 * 作为一个具名、需要显式 import 才会生效的 Playbook 级常量，不是这个模块的隐式默认。
 *
 * 命中任一条即判 `post_sale`：
 *   1. 历史消息（不分收发方向）里出现 `policy.postSaleKeywords` 里的关键词
 *   2. 对话跨度（第一条消息到最后一条消息的时间差）**严格大于** `policy.postSaleSpanMs`
 *      —— 卡在整数分界不算，多 1 毫秒才算（见本文件测试的边界用例）——
 *      **且**最新这条消息本身不是紧跟着一段超过 `policy.postSaleSpanMs` 的沉寂期
 *      才重新出现的（issue #1773 修复，见 `classifyConversation` 内注释：跨度长
 *      既可能是"持续很久的售后关系"，也可能是"客户沉寂很久后刚重新联系"——
 *      后者是典型售前场景，原算法分不清这两种情况，把后者也误判成了 post_sale）
 *
 * 否则判 `lead_intake`。
 *
 * `TOURISM_POST_SALE_POLICY` 里的关键词清单目前是「已知案例」而非穷尽列表 —— 像
 * "我已经付了定金"这类模糊表达能不能识别，issue #1576 明确排除在这次范围外，
 * 留到 dry-run 阶段用真实对话验证覆盖率之后再迭代关键词。
 *
 * ## 为什么不整段拉取消息（3 审第 1 轮 Codex P2）
 *
 * 单个对话消息数一旦超过 PostgREST 的 `max-rows`（默认 1,000），不分页的
 * `select` 只会拿到按时间排好序的前一批，后面的售后关键词和真正的最后一条
 * 消息时间都会被漏掉 —— 长对话可能被误判成 `lead_intake` 继续自动回复。
 * 改成三条服务端查询各自独立完成判断：关键词命中用 `.or()` 交给数据库端过滤
 * 只取 1 行判断存在性，首尾消息时间各自 `order + limit(1)` 单独取，
 * 都不依赖把全部消息搬到内存。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { hasIndustryFeature } from '@/lib/clients/industry-features'

export type ConversationClass = 'lead_intake' | 'post_sale'

/** 售后判据 —— 由调用方（Playbook / Profile / Configuration）显式传入，没有平台级默认值。 */
export interface PostSaleClassificationPolicy {
  /** 命中任一关键词（大小写不敏感，匹配前正文和关键词都转小写）即判 `post_sale`。 */
  postSaleKeywords: string[]
  /** 对话跨度严格大于这个毫秒数才判 `post_sale` —— 卡在整数分界不算。 */
  postSaleSpanMs: number
}

/**
 * 旅游行业（issue #1576，CTS Tours 等）的售后判据。这是行业特定 Playbook 常量，
 * 不是 `classifyConversation` 的隐式默认值 —— 其它行业（地产、专业服务等）
 * "booking" 一类词可能正是售前留资场景，必须由各自的 Playbook 提供自己的 policy，
 * 不能沿用这份旅游关键词清单。
 */
export const TOURISM_POST_SALE_POLICY: PostSaleClassificationPolicy = {
  postSaleKeywords: ['booking', '我订的', '我已付', 'receipt', '我下单了'],
  postSaleSpanMs: 30 * 24 * 60 * 60 * 1000,
}

/**
 * 这个客户该用哪份售后判据——按行业关键词匹配（跟
 * `industry-features.ts::hasIndustryFeature` 同一套判法），不是按 `clientId`
 * 硬编码。F1（issue #1584）和 F2（issue #1585）各自独立调用同一份分类结果，
 * 这个选择器是两边共用的"该用哪份 policy"决定，本来就该跟 `classifyConversation`
 * 住在一起，不是各函数自己复制一份。目前只有旅游行业有具名 Playbook；认不出行业
 * 时返回 `null`，调用方应按 `lead_intake` 处理（不猜、不套错行业的判据）。
 */
export function resolvePostSaleClassificationPolicy(
  industry: string | null | undefined,
): PostSaleClassificationPolicy | null {
  if (hasIndustryFeature(industry, 'tailor_made')) return TOURISM_POST_SALE_POLICY
  return null
}

interface EdgeMessageRow {
  sent_at: string
}

/**
 * 单个关键词按 PostgREST 引号转义规则整体加引号，避免 `,` `(` `)` 等字符被
 * 当成 `.or()` 的子句分隔符 / 分组符拆开、或双引号打断值本身；同时按 ilike
 * 默认转义字符（反斜杠）转义 `%` `_` 通配符，避免误判命中（关键词里的原始
 * 反斜杠也要先转义，否则会被当成转义符吃掉后面的字符）。
 * 两层转义顺序不能反：先转 ilike 通配符，再转 PostgREST 引号层的反斜杠 / 双引号
 * ——PostgREST 解析引号内容时，`\\` 还原成 `\`、`\"` 还原成 `"`，其余字符原样
 * 传到数据库，所以里层转义产生的反斜杠必须在外层再转义一次才能保真传到底。
 */
function escapeIlikeKeyword(keyword: string): string {
  const wildcardEscaped = keyword.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
  const quoteEscaped = wildcardEscaped.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `"%${quoteEscaped}%"`
}

/** 关键词命中判断交给数据库端做（`.or()` + `ilike`），这里只拼过滤表达式。 */
function buildKeywordOrFilter(keywords: string[]): string {
  return keywords.map((kw) => `body.ilike.${escapeIlikeKeyword(kw)}`).join(',')
}

/**
 * 只问「存在不存在」，`limit(1)` 保证不管命中多少行都只搬 1 行回来。
 * 空关键词数组直接判「没命中」—— `.or('')` 是无效的 PostgREST 过滤表达式。
 */
async function hasPostSaleKeyword(conversationId: string, keywords: string[]): Promise<boolean> {
  if (keywords.length === 0) return false

  const { data, error } = await supabaseAdmin
    .from('conversation_messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .or(buildKeywordOrFilter(keywords))
    .limit(1)

  if (error) {
    throw new Error(`classifyConversation: 关键词查询失败 — ${error.message}`)
  }
  return (data ?? []).length > 0
}

/** 只要对话的第一条消息时间，`order + limit(1)`，不搬中间的消息。 */
async function fetchEdgeMessage(
  conversationId: string,
  ascending: boolean
): Promise<EdgeMessageRow | null> {
  const { data, error } = await supabaseAdmin
    .from('conversation_messages')
    .select('sent_at')
    .eq('conversation_id', conversationId)
    .order('sent_at', { ascending })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(`classifyConversation: 读 conversation_messages 失败 — ${error.message}`)
  }
  return data
}

/**
 * 🔴 issue #1773（2026-09-15，#1591 端到端 dry-run 用 CTS 真实历史私信实测发现）：
 * 最近两条消息各自的时间，用来判断「最新这条消息是不是客户沉寂很久之后才
 * 重新联系」——不再只取最后一条消息本身。
 */
async function fetchLastTwoMessages(conversationId: string): Promise<EdgeMessageRow[]> {
  const { data, error } = await supabaseAdmin
    .from('conversation_messages')
    .select('sent_at')
    .eq('conversation_id', conversationId)
    .order('sent_at', { ascending: false })
    .limit(2)

  if (error) {
    throw new Error(`classifyConversation: 读 conversation_messages 失败 — ${error.message}`)
  }
  return data ?? []
}

/**
 * 判断一段对话是「售前留资」还是「售后」。
 *
 * `policy` 必须由调用方显式传入（例如旅游场景传 `TOURISM_POST_SALE_POLICY`）——
 * 这个函数本身不内置任何行业判据，避免旅游关键词悄悄套到其它行业客户身上。
 *
 * 查不到消息（比如 conversationId 传错，或者对话还没同步进消息）时保守判
 * `lead_intake` —— 没有证据说明它是售后，不能替它升级成「跳过自动回复」
 * 之外更重的分支。
 *
 * 🔴 issue #1773 修复（2026-09-15）：「对话跨度」曾经是「第一条消息到最后一条
 * 消息」的原始时间差，用来近似"这段关系已经维持很久，大概率是售后"。但
 * `#1591` 端到端 dry-run 用 CTS 真实历史私信实测抓到两条真实误判——两位客户
 * 都是 7 月留资、沉寂了两个月、9 月才重新发来一条全新的售前问题（"一个人去
 * 多少钱"、"能不能发我行程单"），旧算法只看首末消息时间差 > 30 天就直接判
 * post_sale、完全跳过 AI 起草，害这类真实商机可能被漏掉。
 *
 * 根因：「首末消息跨度长」这件事，即可能是"持续了很久的售后关系"（真该判
 * post_sale），也同样可能是"客户沉寂很久后才刚重新联系"（这恰恰是典型的
 * 售前场景，越该判 lead_intake）——原算法没有办法区分这两种情况，把后者也
 * 错杀了。
 *
 * 修复：只有当"最新一条消息"本身是紧跟着上一条消息、对话仍在连续进行时，
 * 才用首末跨度判 post_sale；如果最新一条消息前面本身就隔了一段超过
 * `policy.postSaleSpanMs` 的沉寂期，说明客户是刚重新联系上，不该只凭"关系
 * 存在了很久"这一件事就判定成售后并跳过起草——这次重新联系本身该按它自己
 * 的内容（关键词命中与否）判断，不该被历史沉寂期拖累。
 */
export async function classifyConversation(
  conversationId: string,
  policy: PostSaleClassificationPolicy
): Promise<ConversationClass> {
  if (await hasPostSaleKeyword(conversationId, policy.postSaleKeywords)) return 'post_sale'

  const [firstMessage, lastTwoMessages] = await Promise.all([
    fetchEdgeMessage(conversationId, true),
    fetchLastTwoMessages(conversationId),
  ])

  const lastMessage = lastTwoMessages[0] ?? null
  if (!firstMessage || !lastMessage) return 'lead_intake'

  const firstAt = new Date(firstMessage.sent_at).getTime()
  const lastAt = new Date(lastMessage.sent_at).getTime()
  if (lastAt - firstAt > policy.postSaleSpanMs) {
    const secondLastMessage = lastTwoMessages[1]
    // 只有一条消息（firstAt === lastAt，跨度必为 0）走不到这个分支；
    // 有第二条消息时，检查它跟最新这条之间隔了多久——隔太久说明客户是
    // 沉寂后重新联系，不该只凭"关系存在了很久"判 post_sale。
    const gapBeforeLastMessage = secondLastMessage
      ? lastAt - new Date(secondLastMessage.sent_at).getTime()
      : 0
    if (gapBeforeLastMessage <= policy.postSaleSpanMs) return 'post_sale'
  }

  return 'lead_intake'
}
