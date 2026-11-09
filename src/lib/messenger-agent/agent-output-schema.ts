/**
 * CTS Governed Reply Agent — output contract (Issue #1580, v3 补丁#8).
 *
 * 🔴 跨 issue 契约冻结:这个形状是 Issue #1579(Verifier provenance 闸门)的
 * 唯一输入契约,两个 issue 的实现者必须对齐同一份 schema,不能各写各的。
 *
 * v3 方案原稿(`~/.claude/plans/cts-tours-messenger-dynamic-pearl.md` 第 68 行)
 * 给的是两个独立数组 `source_offering_codes[]` / `quoted_offering_names[]`,
 * 只比长度对不上就报错。v3 补丁#8(该文件第 660 行"必补 9 条"表格第 8 项)把它
 * 换成 `{name, code}` 配对数组 `offerings[]` —— Verifier 要做的是"回复里提到的
 * 每一个团名,都能在 canonical 团清单里找到同一个 code"的逐对核验,两个独立
 * 数组只能验"数量对不对",配对数组才能验"这个名字对应的到底是不是这个 code"
 * (例如 agent 把团 A 的名字和团 B 的 code 错配,两个独立数组看不出来)。
 *
 * `offerings` 允许为空数组 —— 一条不涉及任何具体团的回复(比如纯粹回答
 * "你们营业时间"这种客户知识库里 sensitivity='general' 品牌事实范围内的问题)
 * 完全合法。
 */

import { z } from 'zod'

export const MessengerAgentOfferingRefSchema = z
  .object({
    /**
     * Agent 在回复文案里实际用的产品名(可以是客户知识库那条事实的 name 或
     * aliases 原文——见 `client_knowledge_facts.structured_value` 里
     * `tour.active.<code>` 那类事实的约定,`verifier/policies/cts.ts` 定义)。
     * 🔴（魏征复审 2026-09-15 指出）此处原引用 offerings.yaml——那条方案早已
     * 作废,已改为指向现行的客户知识库事实源。
     */
    name: z.string().min(1),
    /**
     * 必须是那条知识库事实里的 canonical `code`(`structured_value.code`，
     * 小写 kebab-case)—— Verifier 拿这个 code 去已确认在售产品清单里逐条
     * 核验,不是拿 name 模糊匹配。
     */
    code: z.string().min(1),
  })
  .strict()

export const MessengerAgentOutputSchema = z
  .object({
    /** 准备发给客户的最终文案(纯文本,不含任何 markdown/HTML)。 */
    reply_text: z.string().min(1),
    /** Agent 对这条回复"可以直接发送、不需要人工介入"的自评置信度,0-1 闭区间。 */
    confidence: z.number().min(0).max(1),
    /**
     * `reply_text` 里提到的每一个具体团,一一配对成 {name, code}。没有提到任何
     * 具体团(纯政策/事实类回答)时允许是空数组,但不允许省略这个字段——
     * 省略和"确认没有"必须能区分,才能让 Verifier 后续无歧义地做逐对核验。
     */
    offerings: z.array(MessengerAgentOfferingRefSchema),
  })
  .strict()

export type MessengerAgentOfferingRef = z.infer<typeof MessengerAgentOfferingRefSchema>
export type MessengerAgentOutput = z.infer<typeof MessengerAgentOutputSchema>
