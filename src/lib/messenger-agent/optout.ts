/**
 * 跨渠道退订检测 —— CTS Governed Reply Agent 用它决定「这条会话还能不能回」。
 *
 * issue #1575：v3 对 v2 的唯一 blocker（F1 没查拉黑）的正式解法，也是三审第 1 轮
 * 被打回重设计过一次的部分。第一版设计过 `conversations.opted_out`，被指出
 * **换渠道就失效、也没有撤销路径** —— 客人在 Messenger 上说了「退订」，
 * 那一列只挡得住 Messenger，WhatsApp 照样会发；而一旦标错，系统里没有任何
 * 入口能把人放回来。
 *
 * 这里**不新建判断逻辑**：判据只有一份 —— `lib/crm/dnc.ts` 的
 * `isDoNotContact()`，全仓统一用它判「这个人还能不能联系」，跟销售手打备注、
 * 私信提醒走的是同一份材料（`contact_touchpoints`）。撤销也是**零新代码**：
 * 直接复用已存在的 `/api/clients/[id]/crm/contacts/[cid]/dnc` 纠正路由 ——
 * 那条路由已经把「先写触点、后放列、两步都要成」焊死了，这里不重复。
 *
 * ## 有 contact_id / 没有 contact_id，两条完全不同的路
 *
 * 大多数会话在建立时就通过 `resolveContact()`（`lib/crm/identity.ts`）挂上了
 * 真人 —— 这时退订状态**跨渠道**：同一个人在 Messenger 说过退订，WhatsApp 那边
 * 也会读到同一份触点，不看渠道。这正是这次换底座换来的核心能力（v3 vs v2）。
 *
 * 但少数会话挂不上人（该渠道身份还合并不到任何人，比如只在 FB 聊过、从没留过
 * 电话邮箱）—— 这时没有 `contacts` 行可查，只能退回查这条会话自己的
 * `conversations.optout_unlinked` 兜底列（issue #1574 新增，**不经过任何缓存**，
 * 直查这一条会话，因为它天生就是会话级、不是人级的判断）。`optout_unlinked`
 * 一旦立起来，即使之后身份解析补上了 `contact_id`（`link-contacts.ts` 会做
 * 这件事）也继续拦，不会被新联系人一张干净的 DNC 状态覆盖（Codex 复审）。
 *
 * 🔴 **已知的真实缺口，未在本 issue 修**：`optout_unlinked` 目前没有对应的
 * 撤销入口——现成的 `/dnc` 纠正路由只处理 `contacts` 表，不认识这个会话级
 * 兜底列，全仓也没有任何生产路径会清除它（Codex 复审第 4 轮指出）。如果这个
 * 关键词判定命中错了（比如客户是在问退订政策，不是真退订），而这条会话又
 * 恰好挂不上联系人，目前**没有任何界面能把它改回来**。这跟 v3 方案"opt-out
 * 必须可撤销"这条原则冲突，但这个兜底路径本身只在身份解析失败这种边角场景
 * 触发，修好需要给这一列加时间戳 + 扩展 `/dnc` 路由认会话级纠正（或单独开一个
 * 入口），属于新增界面/接口能力，不是这个文件内部能补的一行代码，留给后续
 * issue 处理，不能假装这个缺口不存在。
 *
 * ## IDOR 闸：`client_id` 只认会话自己带的，不接受外部传入
 *
 * `isConversationOptedOut` 只收 `conversationId` 一个参数 —— 调用方给不出、
 * 也不该给 `client_id`。查 `contacts` / `contact_touchpoints` 时用的
 * `client_id` 永远是**从这条会话本身查出来的那一个**，且查询同时按
 * `contact_id` 和这个 `client_id` 过滤（跟 `dnc` 路由的 IDOR 闸同一个写法）。
 * 少了这道过滤，理论上可能因为查询拼装错误而读到别的客户名下同一个 UUID
 * 撞出来的行 —— 虽然 `contact_id` 是全局唯一的外键，但「同时按两个键过滤」
 * 是这个仓库对触点类查询的统一纪律，不因为这里看似用不上就省掉。
 *
 * ## 出错时宁可拦一条，不放过一条
 *
 * 查会话 / 查 contact / 查触点任何一步失败，都当作「退订」处理（返回 true，
 * 拦下这条回复）而不是当「没退订」放行。这是「对外发消息」这类有副作用的
 * 判断该有的方向（CLAUDE.md 铁律「发布…必须 fail-closed」）—— 少发一条消息，
 * 代价远小于给一个已经明确说过别再联系的人发消息。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { isDoNotContact, dncClearedAt, type DncTouch } from '@/lib/crm/dnc'

// ---------------------------------------------------------------------------
// 1) 关键词检测 —— 纯函数，不碰数据库。
// ---------------------------------------------------------------------------

/**
 * 中英双语退订关键词，SMS 行业的老规矩：整条消息就是这个词（允许两边带标点/
 * 空白），不是「消息里出现了这个词」。
 *
 * 为什么不做子串匹配：`STOP`/`stop` 这类词一旦允许出现在句子中间，
 * 「please don't stop the tour」「can you stop by our hotel」这种正常问句
 * 全部会被误判成退订 —— 那是比「漏判一条」更糟的事故（活人被系统静默拉黑，
 * 且没有人知道为什么，直到对方投诉「你们怎么不理我了」）。SMS 行业早就用
 * 整条消息匹配解决了这个问题（Twilio 的 STOP/UNSUBSCRIBE/CANCEL/END/QUIT
 * 关键词表就是整条消息比对），这里跟随同一个约定。
 */
const OPT_OUT_KEYWORDS_EN = new Set(['stop', 'unsubscribe'])
const OPT_OUT_KEYWORDS_ZH = new Set(['退订', '取消关注'])

/**
 * 两边的标点/空白都不算数：「STOP.」「退订!」「  stop  」「(STOP)」「STOP:」
 * 「"退订"」都要认出来。用 Unicode 标点类别 `\p{P}`（涵盖引号/括号/冒号/分号/
 * 破折号等，不是只列举中英文里想到的那几个符号）而不是手写字符白名单——
 * Codex 复审指出手写清单漏了括号/冒号/分号/引号这类客户很自然会用的包装符号，
 * 之前的写法会让「(STOP)」「STOP:」这类明确的退订指令因为没剥干净标点而匹配
 * 不上，继续给已经明确表示退订的客户发消息。
 */
function normalizeForKeywordMatch(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '')
}

/**
 * 这句话是不是一条退订指令。中英双语、大小写不敏感，整条消息匹配
 * （见上方注释——不是子串匹配）。
 */
export function isOptOutKeyword(text: string): boolean {
  if (typeof text !== 'string') return false
  const normalized = normalizeForKeywordMatch(text)
  if (!normalized) return false
  return OPT_OUT_KEYWORDS_EN.has(normalized) || OPT_OUT_KEYWORDS_ZH.has(normalized)
}

// ---------------------------------------------------------------------------
// 2) 跨渠道退订判定 —— 有 I/O，可注入 supabase client 供测试用假数据源。
// ---------------------------------------------------------------------------

interface ConversationRow {
  id: string
  client_id: string
  contact_id: string | null
  /**
   * issue #1574 新增列（本 PR 提交时尚未合并主分支）。**假设它存在**，
   * 但任何依赖它真实存在于数据库里的测试都不许在本 PR 里真跑
   * ——见 PR 描述。
   */
  optout_unlinked: boolean | null
}

interface ContactRow {
  do_not_contact: boolean | null
}

interface TouchpointRow {
  occurred_at: string
  metadata: Record<string, unknown> | null
  source_ref?: string | null
}

/**
 * 这条会话现在算不算「退订了」。
 *
 * @param conversationId 会话 id（`conversations.id`）。
 * @param supabase 默认生产客户端；测试注入假数据源（跟
 *   `lib/crm/messenger-stop-signal.ts` 的 `findMessengerStopSignals` 同一个
 *   可测试写法）。
 */
export async function isConversationOptedOut(
  conversationId: string,
  supabase: SupabaseClient = supabaseAdmin,
): Promise<boolean> {
  const { data: convo, error: convErr } = await supabase
    .from('conversations')
    .select('id, client_id, contact_id, optout_unlinked')
    .eq('id', conversationId)
    .maybeSingle()

  if (convErr) {
    console.error(`[messenger-agent/optout] 查会话失败 conversationId=${conversationId}:`, convErr.message)
    return true // fail-closed：查不出来就当拦下处理，见文件头注释。
  }
  if (!convo) {
    // 会话都不存在：没有「该不该回」这回事，但也不能装作「能回」。
    console.error(`[messenger-agent/optout] 会话不存在 conversationId=${conversationId}`)
    return true
  }

  const row = convo as ConversationRow
  const contactId = row.contact_id

  // 关联转换闸（Codex 复审）：`link-contacts.ts` 会在原本 contact_id 为空的会话
  // 补上联系人，但全仓目前没有把 optout_unlinked 转移成联系人级 DNC 的生产路径——
  // 补挂的新联系人大概率没有任何 DNC 触点/镜像。这个兜底列必须继续认，不能因为
  // 「现在有 contact_id 了」就改道去查一个还没继承退订状态的联系人，否则同一
  // 会话补上联系人的瞬间就会重新获准外发。
  if (row.optout_unlinked === true) return true

  if (!contactId) {
    // 挂不上人的会话，又没命中兜底列：没有更多材料可查，放行。
    return false
  }

  // IDOR 闸：contact / 触点查询必须同时按 contact_id 和「这条会话自己的」
  // client_id 过滤 —— 不接受任何外部传入的 client_id（本函数压根不收这个参数）。
  const clientId = row.client_id

  const [contactResult, touchResult] = await Promise.all([
    supabase
      .from('contacts')
      .select('do_not_contact')
      .eq('id', contactId)
      .eq('client_id', clientId)
      .maybeSingle(),
    supabase
      .from('contact_touchpoints')
      .select('occurred_at, metadata')
      .eq('contact_id', contactId)
      .eq('client_id', clientId),
  ])

  if (contactResult.error) {
    console.error(
      `[messenger-agent/optout] 查 contact 失败 contactId=${contactId}:`,
      contactResult.error.message,
    )
    return true
  }
  if (touchResult.error) {
    console.error(
      `[messenger-agent/optout] 查触点失败 contactId=${contactId}:`,
      touchResult.error.message,
    )
    return true
  }
  if (!contactResult.data) {
    // contactId 有值，但按「同一个 client_id」过滤后查不到这一行 ——
    // 要么这条会话的 contact_id 挂错了客户（外键只约束 contacts(id) 存在，
    // 不约束同一个 client_id），要么数据本身就是坏的。这已经是异常状态，
    // 不能把「查不到」悄悄当成「没被标 DNC」放行，同样按 fail-closed 处理。
    console.error(
      `[messenger-agent/optout] contact 不属于会话的 client_id contactId=${contactId} clientId=${clientId}`,
    )
    return true
  }

  const contactFlag = (contactResult.data as ContactRow).do_not_contact === true
  const touches: DncTouch[] = ((touchResult.data as TouchpointRow[] | null) ?? []).map((t) => {
    const meta = t.metadata ?? {}
    return {
      outcome: (meta.outcome as string | undefined) ?? null,
      flagged: meta.do_not_contact === true,
      occurredAt: t.occurred_at,
    }
  })

  // 判据只有一份：lib/crm/dnc.ts。不在这里重新发明「怎么判 DNC」。
  return isDoNotContact(contactFlag, touches)
}

// ---------------------------------------------------------------------------
// 3) 关键词命中后写一条触点 —— 复用既有表结构，不新建字段、不新建判断逻辑。
// ---------------------------------------------------------------------------

export interface RecordOptOutKeywordTouchInput {
  clientId: string
  contactId: string
  /** `contact_touchpoints.channel` 的 CHECK 约束子集——这个模块只处理这两条渠道。 */
  channel: 'messenger' | 'whatsapp'
  conversationId: string
  messageId: string
  /** 默认当前时间；补记场景可传入消息本身的发送时间。 */
  occurredAt?: string
}

export interface RecordOptOutKeywordTouchResult {
  touchpointId: string | null
}

/**
 * 客人这条消息命中了退订关键词 —— 写一条触点，让 `lib/crm/dnc.ts` 的判据
 * **跨渠道**立刻看到它，并同步反规范化镜像列 `contacts.do_not_contact`。
 *
 * 字段形状是 issue #1575 钉死的：`outcome` 必须在 `metadata` 里，
 * 不是顶层列 —— `contact_touchpoints` 表压根没有顶层 `outcome` 列
 * （见 `supabase/migrations/20260726000005_contact_touchpoints.sql`），
 * 照字面写顶层字段会插入失败。
 *
 * 幂等键用 `${conversationId}:optout:${messageId}` —— Meta 的 webhook
 * 是至少一次投递，同一条消息重复到达不能记成两笔触点。
 *
 * 写法跟 `lib/crm/touchpoints.ts` 的 `recordManualTouchpoint()` 一致：
 * 先幂等写触点，镜像列的更新**默认执行**（哪怕触点命中幂等键没有真插），
 * 让「首次镜像更新失败」这种情况靠同一个幂等键重试收敛 ——跟
 * `recordManualTouchpoint` 的约定相同，这里不重复处理「报警但不阻断」
 * 这类调用方策略。
 *
 * 唯一的例外：Meta 的 webhook 是至少一次投递，一条很旧的退订消息可能在
 * 人已经走 `/dnc` 纠正（`dnc_cleared`，见 `lib/crm/dnc.ts`）之后才重放到达。
 * 这时触点真相已经以那次更晚的人工纠正为准，这里**不能**无条件把镜像列
 * 覆盖回 `true`——那会让 `/dnc` 刚做完的纠正在下一次 webhook 重试时被
 * 悄悄推翻，且没有任何报错提示。所以写镜像列之前会看一眼这个联系人
 * 现在最新的 `dnc_cleared` 时间点：晚于这条事件本身的时间戳，就跳过覆盖。
 *
 * 🔴 **判「晚于」用的是落库的事件时间，不是调用时刻**（Codex 复审）。
 * `occurredAt` 合法地可以不传（调用方没有更精确的消息时间），这时不能拿
 * `new Date().toISOString()` 去跟 `dnc_cleared` 比——同一条 webhook 每次重试
 * 都会把它重算成「现在」，于是这条比较永远不会触发（重试的「现在」几乎总是
 * 晚于任何历史上的人工纠正），保护形同虚设。这里改成：先看这条触点
 * （按 `sourceRef` 幂等键）第一次落库时到底记的是哪个时间——`ignoreDuplicates`
 * 保证同一个 `sourceRef` 只会被写一次，之后每次重放都读到那个冻结的原值，
 * 而不是重新算。
 *
 * 🔴 **写镜像列之后再回验一次**（Codex 复审，TOCTOU 缩窗）。「查最新纠正 →
 * 写镜像列」这两步之间仍有极小的窗口：人工纠正恰好插在两者中间。
 * `isConversationOptedOut` 的判据本身不受影响（它每次都直接从触点重新算，
 * 详见 `lib/crm/dnc.ts` 的 `isDoNotContact`——`dnc_cleared` 是最后一次判决时
 * 连 `contacts` 那一列都不算数），但仓库里还有别处直接读 `contacts.do_not_contact`
 * 这一列（`/dnc` 路由注释里点名的今日待办、群发接口）。写完之后立刻重新查一遍
 * 触点，发现纠正确实抢在了中间，就把镜像列直接纠正回来，别把窗口期里
 * 那条「压对了」的纠正晾在一边等下一次触发。真正的强一致需要事务/行锁，
 * 这里没有引入新迁移，只把这个已知窗口从「无限期」收窄到「本次调用内自愈」。
 */
export async function recordOptOutKeywordTouch(
  input: RecordOptOutKeywordTouchInput,
  supabase: SupabaseClient = supabaseAdmin,
): Promise<RecordOptOutKeywordTouchResult> {
  const { clientId, contactId, channel, conversationId, messageId } = input
  const occurredAt = input.occurredAt ?? new Date().toISOString()
  const sourceRef = `${conversationId}:optout:${messageId}`

  const { data, error } = await supabase
    .from('contact_touchpoints')
    .upsert(
      {
        client_id: clientId,
        contact_id: contactId,
        channel,
        direction: 'inbound',
        occurred_at: occurredAt,
        summary: '系统自动判定：客户消息命中退订关键词',
        metadata: {
          outcome: 'do_not_contact',
          do_not_contact: true,
          detected_by: 'keyword',
        },
        source: channel,
        source_ref: sourceRef,
      },
      { onConflict: 'client_id,source,source_ref', ignoreDuplicates: true },
    )
    .select('id')
    .maybeSingle()

  if (error) {
    throw new Error(`写退订触点失败: ${error.message}`)
  }

  // 重放保护：这条事件之后如果已经有更晚的人工纠正（dnc_cleared），
  // 说明镜像列现在的值就该是那次纠正定的，不该被一条旧事件的重放推翻。
  const { data: existingTouches, error: touchErr } = await supabase
    .from('contact_touchpoints')
    .select('occurred_at, metadata, source_ref')
    .eq('contact_id', contactId)
    .eq('client_id', clientId)

  if (touchErr) {
    throw new Error(`查已有触点失败: ${touchErr.message}`)
  }

  const touchRows = (existingTouches as TouchpointRow[] | null) ?? []
  const touches: DncTouch[] = touchRows.map((t) => {
    const meta = t.metadata ?? {}
    return {
      outcome: (meta.outcome as string | undefined) ?? null,
      flagged: meta.do_not_contact === true,
      occurredAt: t.occurred_at,
    }
  })

  // 这条触点第一次落库时冻结的时间 —— 幂等键命中时，找不到自己这条刚好说明
  // 上面的 upsert 没有真插（`ignoreDuplicates`），那就沿用调用方这次传入 /
  // 默认出的时间；找得到就必须用落库的那个原值，不能用这次调用临时算出来的。
  const persistedOccurredAt =
    touchRows.find((t) => t.source_ref === sourceRef)?.occurred_at ?? occurredAt
  const persistedOccurredAtMs = new Date(persistedOccurredAt).getTime()

  if (dncClearedAt(touches) > persistedOccurredAtMs) {
    // 已经有更晚的人工纠正 —— 这条事件（大概率是旧 webhook 的重放）
    // 不许覆盖回去，镜像列维持纠正后的状态。
    return { touchpointId: (data as { id: string } | null)?.id ?? null }
  }

  // 镜像列更新（幂等），配合调用方带同 sourceRef 重试收敛 ——
  // 跟 recordManualTouchpoint() 的约定一致。
  const { error: updateErr } = await supabase
    .from('contacts')
    .update({ do_not_contact: true })
    .eq('id', contactId)
    .eq('client_id', clientId)

  if (updateErr) {
    throw new Error(`更新 contacts.do_not_contact 失败: ${updateErr.message}`)
  }

  // 回验：写完这一刻再看一眼有没有别的事件在检查和写入之间插了进来。
  // 有就把镜像列纠正成**全部触点算出来的最终判决**，不是无条件设 false ——
  // Codex 复审指出的反例：如果插进来的不只是一条 dnc_cleared，而是
  // 「先纠正、又来了一条更新的退订」，无条件写 false 会让镜像跟最新判决
  // 正好相反（客户其实又退订了，镜像却说没退订）。用 isDoNotContact()
  // 重新算一遍——跟全仓判「这个人还能不能联系」用的是同一份逻辑，不会出现
  // 「这里判的和 dnc.ts 判的不一致」这第二套标准。不是完整的事务隔离，但把
  // 「镜像列卡在错误值」的窗口从无限期收窄到这次调用内自愈（见函数头部注释）。
  const { data: recheckTouches, error: recheckErr } = await supabase
    .from('contact_touchpoints')
    .select('occurred_at, metadata')
    .eq('contact_id', contactId)
    .eq('client_id', clientId)

  if (!recheckErr) {
    const recheckDncTouches: DncTouch[] = ((recheckTouches as TouchpointRow[] | null) ?? []).map(
      (t) => {
        const meta = t.metadata ?? {}
        return {
          outcome: (meta.outcome as string | undefined) ?? null,
          flagged: meta.do_not_contact === true,
          occurredAt: t.occurred_at,
        }
      },
    )
    // 只要有任何一条触点比这次写入时用的时间还晚，说明有并发事件插了进来，
    // 镜像列该以「全部触点重新算出来的最终判决」为准，而不是只看有没有更晚
    // 的 dnc_cleared——那样会漏掉「纠正之后又有更新退订」这种情况。
    const somethingNewerHappened = recheckDncTouches.some(
      (t) => new Date(t.occurredAt).getTime() > persistedOccurredAtMs,
    )
    if (somethingNewerHappened) {
      const finalVerdict = isDoNotContact(true, recheckDncTouches)
      if (finalVerdict !== true) {
        // Codex 复审：这一步失败绝不能被吞掉——补偿写不进去，镜像列会永久
        // 卡在 true，`writeback-service.ts` 这类直接读镜像列的消费方会一直
        // 错误拦截一个已经解除退订的联系人，而且没有任何报错提示。抛出去，
        // 让调用方按同一个幂等键（source_ref）重试收敛，跟本函数其它失败
        // 分支的处理方式一致。
        const { error: compensateErr } = await supabase
          .from('contacts')
          .update({ do_not_contact: finalVerdict })
          .eq('id', contactId)
          .eq('client_id', clientId)
        if (compensateErr) {
          throw new Error(`回验补偿写入 contacts.do_not_contact 失败: ${compensateErr.message}`)
        }
      }
    }
  }
  // 回验查询本身失败：不额外抛错阻断主流程（镜像列的写入已经成功且方向
  // 正确，回验只是缩窗用的补充动作，跟主路径的 fail-closed 方向不冲突）。

  return { touchpointId: (data as { id: string } | null)?.id ?? null }
}
