/**
 * 「AI 读对话得出的事实」的形状定义 —— 纯类型与常量，不碰 IO。
 *
 * 离线探针（拿历史对话试 prompt、算准确率）和线上任务（每小时读一批对话）
 * 共用这一份 schema：两边对「一条事实长什么样」的理解必须完全一致，
 * 否则探针上好看的准确率到了线上就不成立。
 *
 * 七个 yes/no 是给读路径用的（`FactsLite`），五段文字是给人核对用的证据。
 */

import { z } from 'zod'

/** prompt 改一次就换一次 —— 线上结果要能追到是哪版 prompt 读出来的。 */
/**
 * 垃圾 / 无关的种类。只有点得出名的才算：平台营销群发、别家来推销、找工作、发错人、跟业务无关。
 * 一个措辞生硬、像模板、很短的「我有一柜货要运」**不在里面** —— 2026-10-11 干跑时模型把它
 * 笼统地判成垃圾，而它正是 PM 盲测里回「该」的那位客人。
 */
export const SPAM_KINDS = ['none', 'platform_broadcast', 'pitch_to_us', 'job_seeker', 'wrong_recipient', 'unrelated'] as const
export type SpamKind = (typeof SPAM_KINDS)[number]

export const FACTS_PROMPT_VERSION = 'v1.2-2026-10-11'

/** 落库的 `schema_version`：字段增删时 +1，读路径据此决定要不要重算。 */
export const FACTS_SCHEMA_VERSION = 1

export const FactsSchema = z.object({
  /** 垃圾的**种类**（不是一个笼统的「像垃圾」）：模型必须点名是哪一种，点不出来就是 'none'。 */
  spam_kind: z.enum(SPAM_KINDS),
  is_spam_or_unrelated: z.boolean(),
  customer_gave_specifics: z.boolean(),
  we_gave_price: z.boolean(),
  next_step_arranged: z.boolean(),
  ordered_or_paid: z.boolean(),
  we_declined: z.boolean(),
  customer_said_not_now: z.boolean(),
  decline_quote: z.string(),
  customer_quote: z.string(),
  our_quote: z.string(),
  progression: z.string(),
  reason: z.string(),
})

export type Facts = z.infer<typeof FactsSchema>

/**
 * 给 OpenAI `text.format.json_schema` 用的等价 JSON Schema。
 *
 * 和上面的 zod 是同一件事的两种写法，**必须一起改**：模型按这份 schema 生成，
 * 我们按上面那份校验，两边不一致就会出现「模型答得对但被我们判成格式错」。
 */
export const FACTS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'spam_kind',
    'is_spam_or_unrelated',
    'customer_gave_specifics',
    'we_gave_price',
    'next_step_arranged',
    'ordered_or_paid',
    'we_declined',
    'customer_said_not_now',
    'decline_quote',
    'customer_quote',
    'our_quote',
    'progression',
    'reason',
  ],
  properties: {
    spam_kind: { type: 'string', enum: [...SPAM_KINDS] },
    is_spam_or_unrelated: { type: 'boolean' },
    customer_gave_specifics: { type: 'boolean' },
    we_gave_price: { type: 'boolean' },
    next_step_arranged: { type: 'boolean' },
    ordered_or_paid: { type: 'boolean' },
    we_declined: { type: 'boolean' },
    customer_said_not_now: { type: 'boolean' },
    decline_quote: { type: 'string' },
    customer_quote: { type: 'string' },
    our_quote: { type: 'string' },
    progression: { type: 'string' },
    reason: { type: 'string' },
  },
} as const

/**
 * 读路径真正需要的那几个字段 —— **不带任何引文**。
 *
 * 引文里是客户原话，只留在 service_role 的表里；任何对外/对界面的读路径
 * 只拿这一份，从结构上就没有把客户原话漏出去的可能。
 */
export interface FactsLite {
  is_spam_or_unrelated: boolean
  customer_gave_specifics: boolean
  we_gave_price: boolean
  next_step_arranged: boolean
  ordered_or_paid: boolean
  we_declined: boolean
  customer_said_not_now: boolean
  lastSpeaker: 'customer' | 'us'
}
