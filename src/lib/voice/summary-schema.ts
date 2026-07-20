/** Structured call-summary schema (spec §12.2). */
import { z } from 'zod'
import { CALL_OUTCOMES } from './domain'

export const SUMMARY_SCHEMA_VERSION = 1

export const CallSummarySchema = z.object({
  summary: z.string(),
  outcome: z.enum(CALL_OUTCOMES),
  intent_level: z.enum(['low', 'medium', 'high', 'unknown']),
  customer_needs: z.array(z.string()).default([]),
  objections: z.array(z.string()).default([]),
  facts_confirmed: z.array(z.string()).default([]),
  promises_made: z.array(z.string()).default([]), // 板桥 #3: surfaced most prominently on the card
  next_action: z.string().nullable().default(null),
  follow_up_due_at: z.string().nullable().default(null),
  risk_flags: z.array(z.string()).default([]),
  crm_updates: z
    .object({
      service_interest: z.string().nullable().default(null),
      budget_min: z.number().nullable().default(null),
      budget_max: z.number().nullable().default(null),
      currency: z.string().nullable().default(null),
      preferred_area: z.string().nullable().default(null),
      timeline: z.string().nullable().default(null),
    })
    .default({ service_interest: null, budget_min: null, budget_max: null, currency: null, preferred_area: null, timeline: null }),
})

export type CallSummary = z.infer<typeof CallSummarySchema>

/** JSON schema for the OpenAI structured-output summary call (real path). */
export const CALL_SUMMARY_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    outcome: { type: 'string', enum: [...CALL_OUTCOMES] },
    intent_level: { type: 'string', enum: ['low', 'medium', 'high', 'unknown'] },
    customer_needs: { type: 'array', items: { type: 'string' } },
    objections: { type: 'array', items: { type: 'string' } },
    facts_confirmed: { type: 'array', items: { type: 'string' } },
    promises_made: { type: 'array', items: { type: 'string' } },
    next_action: { type: ['string', 'null'] },
    follow_up_due_at: { type: ['string', 'null'] },
    risk_flags: { type: 'array', items: { type: 'string' } },
    crm_updates: {
      type: 'object',
      additionalProperties: false,
      properties: {
        service_interest: { type: ['string', 'null'] },
        budget_min: { type: ['number', 'null'] },
        budget_max: { type: ['number', 'null'] },
        currency: { type: ['string', 'null'] },
        preferred_area: { type: ['string', 'null'] },
        timeline: { type: ['string', 'null'] },
      },
      required: ['service_interest', 'budget_min', 'budget_max', 'currency', 'preferred_area', 'timeline'],
    },
  },
  required: [
    'summary', 'outcome', 'intent_level', 'customer_needs', 'objections',
    'facts_confirmed', 'promises_made', 'next_action', 'follow_up_due_at', 'risk_flags', 'crm_updates',
  ],
} as const
