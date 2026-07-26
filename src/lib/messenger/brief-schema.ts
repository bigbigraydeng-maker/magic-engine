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
export interface BriefContext {
  /** True when the customer spoke last and is waiting on CTS. */
  awaitingReply: boolean
  /** Whole hours since the last message in the thread. */
  hoursSinceLastMessage: number
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
    follow_up_due_at: { type: ['string', 'null'] },
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
        phone: { type: ['string', 'null'], description: "The CUSTOMER's phone number, never CTS's." },
        email: { type: ['string', 'null'], description: "The CUSTOMER's email, never CTS's." },
      },
      required: ['phone', 'email'],
    },
    draft_reply: {
      type: 'string',
      description:
        'Plain text only. Messenger renders asterisks and underscores literally, so no markdown.',
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
