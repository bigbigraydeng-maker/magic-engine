/**
 * P0 tool implementations (spec §10.1). Server injects tenant/call context; args
 * never carry tenant/target identity.
 */
import { z } from 'zod'
import { getVoiceConfig } from '../config'
import { VoiceError, normalizeE164 } from '../domain'
import { searchKnowledge } from '../knowledge'
import type { ToolDefinition, ToolExecutionContext, ToolResult } from './registry'
import type { AgentRow } from '../store/types'

// ── search_knowledge_base ────────────────────────────────────────────────────
const KbArgs = z.object({
  query: z.string().min(1),
  category: z.string().nullable(),
  language: z.string().nullable(),
})
export const searchKnowledgeBaseTool: ToolDefinition<z.infer<typeof KbArgs>> = {
  name: 'search_knowledge_base',
  description:
    "Search the company's approved knowledge for accurate answers about products, services, policies, pricing guidance and FAQs.",
  schema: KbArgs,
  requiresConfirmation: false,
  jsonSchema: {
    type: 'function',
    name: 'search_knowledge_base',
    description:
      "Search the company's approved knowledge for accurate answers about products, services, policies, pricing guidance and FAQs.",
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        query: { type: 'string' },
        category: { type: ['string', 'null'] },
        language: { type: ['string', 'null'] },
      },
      required: ['query', 'category', 'language'],
    },
  },
  async execute(ctx, args): Promise<ToolResult> {
    const res = await searchKnowledge(ctx, args)
    return { output: res as unknown as Record<string, unknown> }
  },
}

// ── get_contact_profile ──────────────────────────────────────────────────────
const ProfileArgs = z.object({ phone: z.string().nullable() })
export const getContactProfileTool: ToolDefinition<z.infer<typeof ProfileArgs>> = {
  name: 'get_contact_profile',
  description: 'Look up the caller’s profile and any existing lead. Defaults to the current caller.',
  schema: ProfileArgs,
  requiresConfirmation: false,
  jsonSchema: {
    type: 'function', name: 'get_contact_profile',
    description: 'Look up the caller’s profile and any existing lead. Defaults to the current caller.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { phone: { type: ['string', 'null'] } }, required: ['phone'],
    },
  },
  async execute(ctx, args): Promise<ToolResult> {
    let contact = ctx.contactId ? await ctx.store.getContactById(ctx.contactId) : null
    if (!contact && args.phone) {
      const e164 = normalizeE164(args.phone, ctx.brain.country ?? 'NZ')
      if (e164) contact = await ctx.store.findContactByPhone(ctx.tenantId, e164)
    }
    if (!contact) return { output: { found: false } }
    const leads = await ctx.store.listLeadsByTenant(ctx.tenantId, 50)
    const lead = leads.find((l) => l.contact_id === contact!.id) ?? null
    // PII-minimised (板桥 #8): no full phone/email echoed back to the model
    return {
      output: {
        found: true,
        first_name: contact.first_name,
        preferred_language: contact.preferred_language,
        has_existing_lead: Boolean(lead),
        lead_stage: lead?.stage ?? null,
        lead_service_interest: lead?.service_interest ?? null,
        do_not_call: contact.do_not_call,
      },
    }
  },
}

// ── create_or_update_lead ────────────────────────────────────────────────────
const LeadArgs = z.object({
  service_interest: z.string().nullable(),
  intent_level: z.enum(['low', 'medium', 'high', 'unknown']),
  budget_min: z.number().nullable(),
  budget_max: z.number().nullable(),
  currency: z.string().nullable(),
  preferred_area: z.string().nullable(),
  timeline: z.string().nullable(),
  next_action: z.string().nullable(),
  notes: z.string().nullable(),
})
export const createOrUpdateLeadTool: ToolDefinition<z.infer<typeof LeadArgs>> = {
  name: 'create_or_update_lead',
  description: 'Create or update the sales lead for this call. Idempotent per call.',
  schema: LeadArgs,
  requiresConfirmation: false,
  jsonSchema: {
    type: 'function', name: 'create_or_update_lead',
    description: 'Create or update the sales lead for this call. Idempotent per call.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        service_interest: { type: ['string', 'null'] },
        intent_level: { type: 'string', enum: ['low', 'medium', 'high', 'unknown'] },
        budget_min: { type: ['number', 'null'] },
        budget_max: { type: ['number', 'null'] },
        currency: { type: ['string', 'null'] },
        preferred_area: { type: ['string', 'null'] },
        timeline: { type: ['string', 'null'] },
        next_action: { type: ['string', 'null'] },
        notes: { type: ['string', 'null'] },
      },
      required: ['service_interest', 'intent_level', 'budget_min', 'budget_max', 'currency', 'preferred_area', 'timeline', 'next_action', 'notes'],
    },
  },
  async execute(ctx, args): Promise<ToolResult> {
    const stage = args.intent_level === 'high' || args.intent_level === 'medium' ? 'qualified' : 'new'
    const lead = await ctx.store.upsertLeadForCall(ctx.callId, ctx.tenantId, {
      contact_id: ctx.contactId ?? null,
      source: 'voice_call',
      stage,
      intent_level: args.intent_level,
      service_interest: args.service_interest,
      budget_min: args.budget_min,
      budget_max: args.budget_max,
      currency: args.currency,
      preferred_area: args.preferred_area,
      timeline: args.timeline,
      next_action: args.next_action,
      structured_data: { notes: args.notes },
      last_contact_at: new Date().toISOString(),
    })
    return { output: { lead_id: lead.id, stage: lead.stage, intent_level: lead.intent_level } }
  },
}

// ── transfer_to_human ────────────────────────────────────────────────────────
const TransferArgs = z.object({
  reason: z.string().min(1),
  target: z.enum(['default', 'sales', 'support', 'manager']),
  brief: z.string().nullable(),
})
export function resolveTransferUri(agent: AgentRow, target: string): string | null {
  const map = agent.transfer_targets ?? {}
  const cfg = getVoiceConfig()
  // whitelist ONLY: model picks a key, never a raw number (spec §10.1)
  return map[target] ?? map.default ?? agent.human_transfer_uri ?? cfg.env.DEFAULT_HUMAN_TRANSFER_URI ?? null
}
export const transferToHumanTool: ToolDefinition<z.infer<typeof TransferArgs>> = {
  name: 'transfer_to_human',
  description: 'Transfer the live call to a human on the approved routing list.',
  schema: TransferArgs,
  requiresConfirmation: false,
  jsonSchema: {
    type: 'function', name: 'transfer_to_human',
    description: 'Transfer the live call to a human on the approved routing list.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        reason: { type: 'string' },
        target: { type: 'string', enum: ['default', 'sales', 'support', 'manager'] },
        brief: { type: ['string', 'null'] },
      },
      required: ['reason', 'target', 'brief'],
    },
  },
  async execute(ctx, args): Promise<ToolResult> {
    const uri = resolveTransferUri(ctx.agent, args.target)
    if (!uri) throw new VoiceError('TRANSFER_NOT_CONFIGURED', `no transfer URI for target=${args.target}`)
    return {
      output: { transferring: true, target: args.target },
      control: { action: 'transfer', targetUri: uri, reason: args.reason },
    }
  },
}

// ── end_call ─────────────────────────────────────────────────────────────────
const EndArgs = z.object({
  reason: z.enum(['completed', 'caller_requested', 'unsupported', 'abusive', 'system_error']),
})
export const endCallTool: ToolDefinition<z.infer<typeof EndArgs>> = {
  name: 'end_call',
  description: 'End the call politely.',
  schema: EndArgs,
  requiresConfirmation: false,
  jsonSchema: {
    type: 'function', name: 'end_call', description: 'End the call politely.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { reason: { type: 'string', enum: ['completed', 'caller_requested', 'unsupported', 'abusive', 'system_error'] } },
      required: ['reason'],
    },
  },
  async execute(_ctx, args): Promise<ToolResult> {
    return { output: { ending: true, reason: args.reason }, control: { action: 'hangup', reason: args.reason } }
  },
}

// ── schedule_callback ────────────────────────────────────────────────────────
const CallbackArgs = z.object({
  preferred_date: z.string().nullable(),
  preferred_time_window: z.string().nullable(),
  timezone: z.string(),
  reason: z.string(),
})
export const scheduleCallbackTool: ToolDefinition<z.infer<typeof CallbackArgs>> = {
  name: 'schedule_callback',
  description: 'Record a callback request for a human to follow up.',
  schema: CallbackArgs,
  requiresConfirmation: false,
  jsonSchema: {
    type: 'function', name: 'schedule_callback',
    description: 'Record a callback request for a human to follow up.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        preferred_date: { type: ['string', 'null'] },
        preferred_time_window: { type: ['string', 'null'] },
        timezone: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['preferred_date', 'preferred_time_window', 'timezone', 'reason'],
    },
  },
  async execute(ctx, args): Promise<ToolResult> {
    const cb = await ctx.store.createCallbackRequest({
      tenant_id: ctx.tenantId,
      call_id: ctx.callId,
      contact_id: ctx.contactId ?? null,
      preferred_date: args.preferred_date,
      preferred_time_window: args.preferred_time_window,
      timezone: args.timezone,
      reason: args.reason,
    })
    return { output: { callback_id: cb.id, scheduled: true } }
  },
}
