/**
 * CTS Governed Reply Agent — system prompt assembly (Issue #1580 · v3 改接客户知识库)。
 *
 * 组装喂给 `callClaudeWithTools`(`src/lib/anthropic/client.ts`)的 system prompt:
 * brief(品牌语气)+ 客户知识库事实快照(`getClientKnowledge` 已经是这次调用
 * 时刻读到的结果)+ 对话历史(调用方已经取好的最近几轮)+ 硬闸文案(输出契约 +
 * 绝不能做的事)。
 *
 * 为什么知识库事实已经写进 prompt 了,`tools.ts` 还要再给一遍
 * `query_customer_facing_facts`:这里写进去的是**这一刻的快照**,只用来让
 * Claude 一眼看到"大概有哪些已确认事实"，降低多余的工具调用；调用工具能拿到
 * 对话处理这一刻最新的数据,而快照是组装 prompt 那一刻的旧值,两者之间可能已
 * 经有事实被批准/被撤回。
 *
 * 🔴（子牙复审 2026-09-15 指出并修正）**这里不能说"Verifier 只认工具调用轨迹,
 * 不认 prompt 里写过"**——这句话描述的是 Issue #1579 目前并不存在的机制:
 * `verifier/policies/cts.ts` 的 gate 3(数字核实)/gate 5(provenance)并不检查
 * Agent 有没有真的调用过某个工具,它们只是重新对**这次校验时刻**的
 * `getClientKnowledge` 结果做核对——不管 Agent 是凭工具调用结果还是凭 prompt
 * 快照写出的数字/团名,只要它能在核验时刻的知识库里核到,就一样会通过。
 * `cited_knowledge`/`tool_trace_json`(真正的"工具调用轨迹校验")目前还只在
 * design doc 的 medium 待建清单里,没有实现。硬闸文案第 1 条因此改写成如实的
 * 说法:调用工具是为了拿到更新的数据、降低"快照过期"的风险,不是为了留下一条
 * Verifier 会检查的调用记录。
 *
 * ## v3 改接(design doc §9.14 C.2)—— 不再区分"在售/下架"两个数组
 *
 * v2 的 `formatOfferingsSnapshot` 分别列出 `active_tours`(可推荐)和
 * `retired_tours`(已下架,明确警示官网仍可见的陷阱)。v3 改用 `getClientKnowledge`
 * 后,`visibility='forbidden'` 的事实(取代 v2 的下架团)**永远不会作为正文
 * 出现在这里**——读取入口本身就不把这些事实的内容交给任何用途(见
 * `read.ts` 文件头 §4),Agent 完全看不到"曾经有哪些团、为什么下架"。这不是
 * 疏漏:防止 Agent 反而从这些描述里学会怎么委婉提及一个下架产品,是这次
 * 改接的设计意图之一(design doc §9.14 C.2)。因此硬闸文案第 2 条从 v2 的
 * "查到下架就明确告知已下架"改为"查不到就一律当作未知,交给人工跟进"——
 * 两种情况(真的下架 / 单纯没被问到的产品)对 Agent 而言现在是同一种处理:
 * 说"不确定,请人工同事确认"。是否真的下架,由 Verifier 的
 * `retired_tour_mention` 闸事后用 `forbiddenFactKeys` 校验,不再是 Agent 的
 * 前置判断职责。
 *
 * ## 未收进本次改动:`reply_forbidden_topics`(CTS 话题禁区静态清单)
 *
 * v2 从 `offerings.yaml` 读到的 `reply_forbidden_topics` 会被写进这份 prompt,
 * 提前提醒 Agent 别碰这些话题。v3 设计文档"三份禁止清单分工"表把这份清单
 * 划给 CTS Verifier policy(`verifier/policies/cts.ts`,Issue #1579,另一个
 * PR)的静态配置,不再挂在知识库事实结构里。这个模块(Issue #1580)刻意不去
 * import 另一个未合并 PR 的文件(跟 `agent-output-schema.ts` 与
 * `verifier/policies/cts.ts` 之间"契约靠注释约定、不靠代码 import"是同一个
 * 既有惯例),所以这份提前提醒**这次没有迁移过来**——话题闸门仍然 100% 生效
 * (Verifier gate 4 事后拦截,不受影响),只是 Agent 不再有机会提前"礼貌绕开"
 * 这些话题,命中时会先答一次再被挡下、转人工,而不是一次到位礼貌转人工。
 * 这是已知的、经过取舍的行为退化(不影响安全性,只影响一次交互的顺滑度),
 * 留给复审判断是否值得为此单独接一条只读静态数组的最小依赖。
 *
 * 这个模块是纯函数(不碰数据库/网络)——所有材料由调用方(F2 Inngest 函数,
 * 未来 issue 落地)先各自取好再传进来,方便单测,也让"取数据"和"拼文案"
 * 两件事解耦。
 */

import type { MasterBrief } from '@/types/magic-engine'
import { formatBriefForPrompt } from '@/lib/content/brief-injector'
import type { KnowledgeEntry } from '@/lib/knowledge'

export interface ConversationHistoryTurn {
  direction: 'inbound' | 'outbound'
  senderName: string | null
  body: string | null
  sentAt: string
}

export interface BuildMessengerAgentSystemPromptInput {
  /** 该客户当前生效的 Master Brief;没有则明确告诉 Claude 不要编造品牌信息。 */
  brief: MasterBrief | null
  /**
   * `getClientKnowledge(clientId, { purpose: 'customer_reply' })` 这一刻读到的
   * 结果里,sensitivity 为 price/timeline/commitment/policy 的条目(取代 v2 的
   * `offerings.active_tours`)。跟 `tools.ts` 的 `query_customer_facing_facts`
   * 读的是同一个筛选条件,调用方各自取一次即可,互不依赖。
   */
  customerFacingFacts: KnowledgeEntry[]
  /**
   * 同一次读取结果里 sensitivity='general' 的条目(取代 v2 的
   * `offerings.factual_bullets`)。
   */
  brandFacts: KnowledgeEntry[]
  /** 调用方已经取好的最近几轮对话,时间正序(最老的在前)。 */
  conversationHistory: ConversationHistoryTurn[]
}

function formatKnowledgeSnapshot(customerFacingFacts: KnowledgeEntry[], brandFacts: KnowledgeEntry[]): string {
  const commercialLines = customerFacingFacts.length === 0
    ? '  (目前没有任何已确认可对客户说的商业事实 —— 不要向客户报价、说团期、或承诺任何政策细节)'
    : customerFacingFacts.map((f) => `  - [${f.factKey}] ${f.statement}`).join('\n')

  const brandLines = brandFacts.length === 0
    ? '  (无)'
    : brandFacts.map((f) => `  - ${f.statement}`).join('\n')

  return `事实层快照(客户知识库,读取时刻的结果 —— 每条都已经过内部批准 + 客户本人确认):

已确认可对客户说的商业事实(价格 / 团期 / 承诺 / 政策)：
${commercialLines}

品牌 / 公司事实：
${brandLines}`
}

function formatConversationHistory(history: ConversationHistoryTurn[]): string {
  if (history.length === 0) {
    return '（这是这段对话目前已知的第一条消息，没有更早的历史。）'
  }
  return history
    .map((m) => {
      const who = m.direction === 'inbound' ? '客户' : 'CTS'
      const name = m.senderName ? `（${m.senderName}）` : ''
      return `[${m.sentAt}] ${who}${name}: ${m.body ?? '(空消息)'}`
    })
    .join('\n')
}

const HARD_GATE_TEXT = `硬性规则（不可违反）：

1. 在回复里提到任何具体价格 / 团期 / 政策承诺之前，必须先调用
   \`query_customer_facing_facts\` 核实它确实存在。只凭上面的事实层快照或你自己的
   记忆直接下结论 = 违规，因为快照可能在这次对话过程中已经过期——调用工具能
   拿到最新的数据，而 Verifier 最终核验的是你回复里陈述的具体数字/产品名对不
   对，不是你有没有调过某个工具，所以过期的快照数据一样可能被挡下。
2. 如果客户问起的产品 / 价格 / 政策不在 \`query_customer_facing_facts\` 的结果
   里，一律当作"未知"处理——不要假设它已下架，也不要假设它仍然可订，明确告诉
   客户这个问题需要人工同事确认，绝不能凭训练知识或网站印象自己回答。
3. 绝不能编造、猜测、或用"大概"这类模糊说法陈述价格、团期、政策细节——
   要么有事实层数据支撑，要么明确告诉客户这个问题需要人工确认。
4. 输出必须严格符合以下 JSON 契约（不要输出任何 JSON 之外的文字）：
   { "reply_text": string, "confidence": number（0 到 1 之间，代表这条回复可以
   直接发送、不需要人工介入的把握）, "offerings": [{ "name": string, "code": string }] }
   \`offerings\` 是 reply_text 里提到的每一个具体产品，按 {name, code} 一一配对——
   name 用你回复里实际写的名称，code 必须是工具返回结果里那条事实的 canonical
   code（\`structured_value.code\`）。没有提到任何具体产品时 \`offerings\` 传空
   数组 \`[]\`，不要省略这个字段。
5. 对自己没有把握回答好、或者需要人工判断的问题（例如投诉、退款、超出上面
   事实层范围的追问），把 \`confidence\` 调低，而不是硬答一个听起来合理但没有
   事实支撑的回复。`

export function buildMessengerAgentSystemPrompt(input: BuildMessengerAgentSystemPromptInput): string {
  const briefSection = input.brief
    ? formatBriefForPrompt(input.brief)
    : '（未找到该客户当前生效的 Master Brief——不要编造任何品牌语气/定位信息，只使用下方事实层快照和工具查询结果作答。）'

  return [
    '你是 CTS Tours NZ 的 Messenger 客服回复助手。',
    briefSection,
    formatKnowledgeSnapshot(input.customerFacingFacts, input.brandFacts),
    `最近的对话历史：\n${formatConversationHistory(input.conversationHistory)}`,
    HARD_GATE_TEXT,
  ].join('\n\n')
}
