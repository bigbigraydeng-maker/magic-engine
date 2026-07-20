/**
 * Realtime worker helpers — build a CallSession for a call, and place an outbound
 * call through the compliance gate (魏征 #4). Used by the standalone worker process,
 * the API route dispatch, and the simulate script.
 */
import { loadBusinessBrain } from '../brain'
import { VoiceError } from '../domain'
import { assertOutboundAllowed } from '../outbound-gate'
import { compileSystemPrompt } from '../prompt-compiler'
import { getToolRegistry } from '../tools'
import type { RealtimeProvider } from '../providers'
import type { VoiceStore } from '../store/types'
import { CallSession, type RealtimeSink } from './session'

export async function buildSession(
  store: VoiceStore,
  provider: RealtimeProvider,
  callId: string,
  sink: RealtimeSink,
  requestId?: string,
): Promise<CallSession> {
  const call = await store.getCallById(callId)
  if (!call) throw new VoiceError('CALL_ALREADY_ENDED', `call ${callId} not found`)
  const tenant = await store.getTenantById(call.tenant_id)
  const agent = await store.getAgentById(call.agent_id)
  if (!tenant || !agent) throw new VoiceError('ROUTE_NOT_FOUND', 'tenant/agent missing for call')
  const brain = await loadBusinessBrain(tenant)
  return new CallSession({ store, provider, sink, call, tenant, agent, brain, requestId })
}

export interface PlaceOutboundInput {
  tenantId: string
  agentId: string
  toNumber: string
  fromNumber?: string | null
  contactId?: string | null
}

/**
 * Place an outbound call. ALWAYS routed through assertOutboundAllowed — the single
 * non-bypassable compliance gate (魏征 #4 / 板桥 #7). In P0, real dialling is off, so
 * only sandbox test numbers pass and they run via the mock provider.
 */
export async function placeOutboundCall(
  store: VoiceStore,
  provider: RealtimeProvider,
  input: PlaceOutboundInput,
): Promise<{ callId: string; mode: 'real' | 'mock' }> {
  const tenant = await store.getTenantById(input.tenantId)
  const agent = await store.getAgentById(input.agentId)
  if (!tenant || !agent) throw new VoiceError('ROUTE_NOT_FOUND', 'tenant/agent not found')

  const contact = input.contactId
    ? await store.getContactById(input.contactId)
    : await store.findContactByPhone(input.tenantId, input.toNumber)

  // 🔒 compliance gate — throws OUTBOUND_BLOCKED on any violation
  const { mode } = await assertOutboundAllowed(store, {
    tenantId: input.tenantId, toNumber: input.toNumber, timezone: tenant.default_timezone, contact,
  })

  const { openaiCallId } = await provider.originate({
    toNumber: input.toNumber, fromNumber: input.fromNumber ?? null,
  })

  const brain = await loadBusinessBrain(tenant)
  const registry = getToolRegistry()
  const instructions = compileSystemPrompt({ agent, tenant, brain, enabledTools: agent.enabled_tools, direction: 'outbound' })
  const tools = registry.schemasFor(agent.enabled_tools)

  // Outbound has no incoming webhook to accept; the provider originate returns the id.
  await provider.accept({
    callId: openaiCallId, model: agent.model, instructions, tools,
    voice: agent.voice, reasoningEffort: agent.reasoning_effort,
  }).catch(() => { /* mock accept is a no-op; real accept for outbound handled by originate */ })

  const call = await store.createCall({
    tenant_id: tenant.id, agent_id: agent.id, contact_id: contact?.id ?? null, lead_id: null,
    channel: 'sip', direction: 'outbound', provider: provider.simulated ? 'mock' : 'openai',
    is_simulated: provider.simulated, provider_call_id: null, openai_call_id: openaiCallId,
    from_number: input.fromNumber ?? null, to_number: input.toNumber, status: 'accepted',
    started_at: new Date().toISOString(), answered_at: new Date().toISOString(), ended_at: null,
    duration_seconds: null, language_detected: null, recording_url: null,
    transcript_status: 'pending', summary_status: 'pending', summary: null, outcome: null,
    disposition: null, structured_outcome: {}, usage: {}, cost_estimate: {}, error_code: null, error_message: null,
  })

  await store.audit({
    tenant_id: tenant.id, actor_type: 'system', operation: 'call.outbound_placed',
    resource_type: 'call', resource_id: call.id, call_id: call.id,
    changes: { to: input.toNumber, mode },
  })

  return { callId: call.id, mode }
}
