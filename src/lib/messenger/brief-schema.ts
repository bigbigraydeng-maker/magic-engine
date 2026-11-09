/**
 * Customer brief — the card a CTS salesperson reads instead of scrolling the thread.
 *
 * Deliberately modelled on voice/summary-schema.ts (already in production for the
 * phone agent) so both channels produce the same shape of card. The travel-specific
 * part lives in `trip`, replacing the voice schema's generic crm_updates.
 *
 * LANGUAGE (PM decision 2026-07-26):
 *   - the brief is read by CTS staff in a Chinese UI  → summary / needs / objections
 *     / next_action are written in Chinese
 *   - draft_reply is sent to a New Zealand customer, and the Meta agent is configured
 *     English-only                                     → draft_reply is English
 * Getting these two backwards ships Chinese text to a Kiwi customer, so the schema
 * says so explicitly and the prompt repeats it.
 */

import { z } from 'zod'

export const BRIEF_SCHEMA_VERSION = 1

export const INTENT_LEVELS = ['high', 'medium', 'low', 'unknown'] as const

/**
 * Contact details the customer volunteered in the thread (lead forms drop them
 * straight into the first message). This is the single thing a salesperson wants
 * most, and it is buried in the message body — surface it on the card.
 */
export const ContactSchema = z.object({
  phone: z.string().nullable().default(null),
  email: z.string().nullable().default(null),
})

export const TripDetailsSchema = z.object({
  /**
   * Tour name EXACTLY as CTS sells it, in English ("Best of China").
   * Never translated — staff search on it and match it against the website.
   */
  tour_interest: z.string().nullable().default(null),
  /** Free text as the customer put it, e.g. "2027年3月" / "明年春天". */
  travel_window: z.string().nullable().default(null),
  party_size: z.number().int().positive().nullable().default(null),
  departure_city: z.string().nullable().default(null),
  first_time_to_china: z.boolean().nullable().default(null),
  /** Only when the customer signalled it. Never inferred from the tour price. */
  budget_signal: z.string().nullable().default(null),
})

export type TripDetails = z.infer<typeof TripDetailsSchema>
export type Contact = z.infer<typeof ContactSchema>

/** Runtime facts the model cannot read off the transcript. */
/**
 * 这张卡是从哪条渠道的对话写出来的。
 *
 * 为什么必须带着走：卡里的 `next_action` 是让销售今天就去做的事，`draft_reply`
 * 是真要发给客人的字。渠道错了，销售会跑去 Messenger 找一个从没在那说过话的人。
 */
export type BriefChannel = 'messenger' | 'email'

export interface BriefContext {
  /** True when the customer spoke last and is waiting on the business. */
  awaitingReply: boolean
  /** Whole hours since the last message in the thread. */
  hoursSinceLastMessage: number
  /** 省略时按私信处理 —— 私信是这条链路上线时唯一的渠道。 */
  channel?: BriefChannel
}

export const MessengerBriefSchema = z.object({
  /** One sentence, Chinese. What this person wants and where the conversation stands. */
  summary: z.string(),
  intent_level: z.enum(INTENT_LEVELS),
  /** Chinese. What the customer is actually after. */
  customer_needs: z.array(z.string()).default([]),
  /** Chinese. Hesitations, worries, blockers — the reason they have not booked. */
  objections: z.array(z.string()).default([]),
  /**
   * Chinese, with the original English in brackets.
   * Anything the Page (human OR the Meta agent) committed to. Surfaced most
   * prominently on the card: staff cannot honour a promise they never saw.
   */
  promises_made: z.array(z.string()).default([]),
  /** Chinese. The single most useful thing to do next. */
  next_action: z.string().nullable().default(null),
  /**
   * When to chase this person, as an ISO 8601 instant.
   *
   * This lands in a TIMESTAMPTZ column, so "下周三" or "in 3 days" does not just
   * display oddly — the whole brief fails to save and the salesperson gets no
   * card at all. The prompt asks for ISO and normaliseFollowUpDueAt() drops
   * anything that is not.
   */
  follow_up_due_at: z.string().nullable().default(null),
  /** Chinese. Things that could go wrong — misquoted price, unanswered promise, upset customer. */
  risk_flags: z.array(z.string()).default([]),
  trip: TripDetailsSchema.default({
    tour_interest: null,
    travel_window: null,
    party_size: null,
    departure_city: null,
    first_time_to_china: null,
    budget_signal: null,
  }),
  contact: ContactSchema.default({ phone: null, email: null }),
  /**
   * ENGLISH. A ready-to-send reply the salesperson can edit and send.
   * Never auto-sent — a human must press send (audit requirement).
   */
  draft_reply: z.string(),
})

export type MessengerBrief = z.infer<typeof MessengerBriefSchema>

/**
 * 校验用的**严格版**：跟上面那份字段一一对应，但**没有任何 `.default()`**，并加上语言闸。
 *
 * 为什么要两份（子牙审查 2026-10-26）：宽松版的 8 个字段带默认值，而发给模型的 JSON schema
 * 是全字段必填。备用模型（DeepSeek 的 json_object 模式只保证是合法 JSON）只答
 * summary / intent_level / draft_reply 三个字段也能过宽松版，其余被默认值悄悄填成空 ——
 * 一张「摘要有、需求承诺风险全空」的卡会被当成功写进库，而 promises_made 恰恰是卡上
 * 最该被看见的字段。严格版把「缺字段」变成 schema_invalid，让切换层去重试或换家。
 *
 * 语言闸只设两条，且都用现有数据量过：805 张 OpenAI 写的卡里 next_action 缺汉字 0 张、
 * draft_reply 夹汉字 0 张，所以对主力零误杀。**不对 summary 设汉字闸**：同一批里有 40 张
 * (5%) summary 没有汉字，设了会误杀主力的合法输出。
 * 这道闸的来由：同样的提示词，Claude 在 8 张真实邮件卡里只有 5 张把一句话/下一步写成中文。
 */
const HAN = /[\u4e00-\u9fff]/
export const hasHan = (text: string): boolean => HAN.test(text)

const ContactStrictSchema = z.object({ phone: z.string().nullable(), email: z.string().nullable() })

const TripDetailsStrictSchema = z.object({
  tour_interest: z.string().nullable(),
  travel_window: z.string().nullable(),
  party_size: z.number().int().positive().nullable(),
  departure_city: z.string().nullable(),
  first_time_to_china: z.boolean().nullable(),
  budget_signal: z.string().nullable(),
})

export const MessengerBriefStrictSchema = z.object({
  // 空壳卡不合法：summary 去空白后必须有内容
  summary: z.string().trim().min(1, 'summary 不能为空'),
  intent_level: z.enum(INTENT_LEVELS),
  customer_needs: z.array(z.string()),
  objections: z.array(z.string()),
  promises_made: z.array(z.string()),
  next_action: z
    .string()
    .nullable()
    .refine((v) => v === null || v.trim() === '' || hasHan(v), 'next_action 必须是中文（员工看的是中文界面）'),
  follow_up_due_at: z.string().nullable(),
  risk_flags: z.array(z.string()),
  trip: TripDetailsStrictSchema,
  contact: ContactStrictSchema,
  draft_reply: z.string().refine((v) => !hasHan(v), 'draft_reply 必须是英文（它会发给新西兰客人）'),
})

/** JSON schema for the structured-output call. Mirrors MessengerBriefSchema exactly. */
export const MESSENGER_BRIEF_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    intent_level: { type: 'string', enum: [...INTENT_LEVELS] },
    customer_needs: { type: 'array', items: { type: 'string' } },
    objections: { type: 'array', items: { type: 'string' } },
    promises_made: { type: 'array', items: { type: 'string' } },
    next_action: { type: ['string', 'null'] },
    follow_up_due_at: {
      type: ['string', 'null'],
      description:
        'When CTS should chase this person, as an ISO 8601 instant in UTC (e.g. "2026-08-03T21:00:00Z"). ' +
        'Never a phrase like "next week". Null when the thread gives no reason to follow up on a particular day.',
    },
    risk_flags: { type: 'array', items: { type: 'string' } },
    trip: {
      type: 'object',
      additionalProperties: false,
      properties: {
        tour_interest: {
          type: ['string', 'null'],
          description:
            'Tour the CUSTOMER named or picked, in English exactly as CTS sells it. Null if CTS merely pitched it.',
        },
        travel_window: {
          type: ['string', 'null'],
          description:
            'When the CUSTOMER said they want to travel, in their own words. A departure date CTS offered is NOT this — null in that case.',
        },
        party_size: {
          type: ['integer', 'null'],
          description: 'How many people the CUSTOMER said are travelling. Null if never stated.',
        },
        departure_city: {
          type: ['string', 'null'],
          description: 'NZ city the CUSTOMER said they fly from. Null if never stated.',
        },
        first_time_to_china: {
          type: ['boolean', 'null'],
          description: 'Only if the CUSTOMER said so. Null if never stated.',
        },
        budget_signal: {
          type: ['string', 'null'],
          description:
            'Budget the CUSTOMER signalled. A price CTS quoted is NOT a budget — null in that case.',
        },
      },
      required: [
        'tour_interest',
        'travel_window',
        'party_size',
        'departure_city',
        'first_time_to_china',
        'budget_signal',
      ],
    },
    contact: {
      type: 'object',
      additionalProperties: false,
      properties: {
        phone: { type: ['string', 'null'], description: "The CUSTOMER's phone number, never the business's own." },
        email: { type: ['string', 'null'], description: "The CUSTOMER's email, never the business's own." },
      },
      required: ['phone', 'email'],
    },
    draft_reply: {
      type: 'string',
      description:
        'Plain text only, no markdown: Messenger renders asterisks and underscores literally, and an email reply goes out as plain text.',
    },
  },
  required: [
    'summary',
    'intent_level',
    'customer_needs',
    'objections',
    'promises_made',
    'next_action',
    'follow_up_due_at',
    'risk_flags',
    'trip',
    'contact',
    'draft_reply',
  ],
} as const
