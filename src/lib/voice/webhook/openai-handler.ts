/**
 * OpenAI SIP webhook handler (spec §8.2). Reusable pure function used by the Next
 * route and the simulate script.
 *
 * Order: verify → atomic idempotency gate (insert-if-new; 魏征 #7) → parse SIP →
 * resolve route → create/lookup contact + call → compile prompt/tools → accept →
 * return callId for the realtime worker to pick up.
 *
 * NOTE (assumption, documented in final report): the incoming event payload shape
 * is `{ id, type, data: { call_id, sip_headers } }` where sip_headers is either an
 * object or an array of {name,value}. Parsing is defensive against both.
 */
import { createHash } from 'crypto'
import { getVoiceConfig } from '../config'
import { loadBusinessBrain } from '../brain'
import { parseCalledNumber, parseCallerNumber, resolveRoute, type SipHeaders } from '../domain'
import { compileSystemPrompt } from '../prompt-compiler'
import { getToolRegistry } from '../tools'
import { getVoiceStore } from '../store'
import { getRealtimeProvider } from '../providers'
import type { RealtimeProvider } from '../providers'
import type { VoiceStore } from '../store/types'

export interface WebhookHandlerDeps {
  store?: VoiceStore
  provider?: RealtimeProvider
  requestId?: string
}

export interface WebhookHandlerResult {
  httpStatus: number
  body: Record<string, unknown>
  callId?: string
  accepted?: boolean
}

function normalizeSipHeaders(raw: unknown): SipHeaders {
  if (Array.isArray(raw)) {
    const out: SipHeaders = {}
    for (const h of raw) {
      if (h && typeof h === 'object' && 'name' in h) out[String((h as { name: string }).name)] = String((h as { value?: string }).value ?? '')
    }
    return out
  }
  if (raw && typeof raw === 'object') return raw as SipHeaders
  return {}
}

export async function handleOpenAiWebhook(
  rawBody: string,
  headers: Record<string, string | undefined>,
  deps: WebhookHandlerDeps = {},
): Promise<WebhookHandlerResult> {
  const store = deps.store ?? (await getVoiceStore())
  const provider = deps.provider ?? getRealtimeProvider()
  const cfg = getVoiceConfig()

  // 1. verify signature
  const verified = provider.verifyWebhook(rawBody, headers)
  if (!verified.valid) {
    return { httpStatus: 400, body: { error: 'WEBHOOK_SIGNATURE_INVALID', reason: verified.reason } }
  }
  const eventId = verified.eventId ?? (headers['webhook-id'] as string | undefined) ?? null
  if (!eventId) {
    return { httpStatus: 400, body: { error: 'WEBHOOK_SIGNATURE_INVALID', reason: 'missing event id' } }
  }
  const payload = verified.payload ?? {}
  const eventType = verified.eventType ?? String((payload as { type?: string }).type ?? 'unknown')

  // 2. atomic idempotency gate — only the first inserter proceeds (魏征 #7)
  const payloadHash = createHash('sha256').update(rawBody).digest('hex')
  const { isNew } = await store.insertWebhookEventIfNew({
    provider: 'openai',
    external_event_id: eventId,
    event_type: eventType,
    signature_valid: true,
    payload_hash: payloadHash,
    payload: payload as Record<string, unknown>,
    status: 'processing',
    attempts: 0,
  })
  if (!isNew) {
    return { httpStatus: 200, body: { received: true, status: 'skipped_duplicate' } }
  }

  // 3. only handle incoming-call events
  if (eventType !== 'realtime.call.incoming') {
    await markProcessed(store, eventId, 'processed')
    return { httpStatus: 200, body: { received: true, status: 'ignored', eventType } }
  }

  // 4. extract SIP info
  const data = ((payload as { data?: Record<string, unknown> }).data ?? payload) as Record<string, unknown>
  const openaiCallId = String(data.call_id ?? (payload as { call_id?: string }).call_id ?? '')
  const sipHeaders = normalizeSipHeaders(data.sip_headers ?? data.headers)
  const calledNumber = parseCalledNumber(sipHeaders, cfg.env.DEFAULT_COUNTRY)
  const callerNumber = parseCallerNumber(sipHeaders, cfg.env.DEFAULT_COUNTRY)

  if (!openaiCallId) {
    await markProcessed(store, eventId, 'failed', 'missing call_id')
    return { httpStatus: 400, body: { error: 'REALTIME_TOOL_INVALID_ARGS', reason: 'missing call_id' } }
  }

  // 5. resolve route
  const routes = await store.listActiveRoutes()
  const route = resolveRoute(routes, calledNumber)
  if (!route) {
    await provider.reject(openaiCallId, 'no route for called number')
    await markProcessed(store, eventId, 'processed', 'ROUTE_NOT_FOUND')
    return { httpStatus: 200, body: { received: true, status: 'rejected', reason: 'ROUTE_NOT_FOUND' } }
  }

  const tenant = await store.getTenantById(route.tenant_id)
  const agent = await store.getAgentById(route.agent_id)
  if (!tenant || !agent) {
    await provider.reject(openaiCallId, 'route misconfigured')
    await markProcessed(store, eventId, 'failed', 'route misconfigured')
    return { httpStatus: 200, body: { received: true, status: 'rejected', reason: 'route misconfigured' } }
  }

  // 6. find/create contact
  let contactId: string | null = null
  if (callerNumber) {
    let contact = await store.findContactByPhone(tenant.id, callerNumber)
    if (!contact) {
      contact = await store.createContact({
        tenant_id: tenant.id, phone_e164: callerNumber, whatsapp_phone_e164: null, email: null,
        first_name: null, last_name: null, preferred_language: null, consent_status: 'unknown',
        do_not_call: false, me_lead_id: null, metadata: {},
      })
    }
    contactId = contact.id
  }

  // 7. create call (ringing)
  const call = await store.createCall({
    tenant_id: tenant.id, agent_id: agent.id, contact_id: contactId, lead_id: null,
    channel: route.channel ?? 'sip', direction: 'inbound', provider: provider.simulated ? 'mock' : 'openai',
    is_simulated: provider.simulated, provider_call_id: null, openai_call_id: openaiCallId,
    from_number: callerNumber, to_number: calledNumber, status: 'ringing',
    started_at: new Date().toISOString(), answered_at: null, ended_at: null, duration_seconds: null,
    language_detected: null, recording_url: null, transcript_status: 'pending', summary_status: 'pending',
    summary: null, outcome: null, disposition: null, structured_outcome: {}, usage: {}, cost_estimate: {},
    error_code: null, error_message: null,
  })

  // 8. compile prompt + tools, accept
  const brain = await loadBusinessBrain(tenant)
  const enabledTools = agent.enabled_tools
  const registry = getToolRegistry()
  const instructions = compileSystemPrompt({ agent, tenant, brain, enabledTools, direction: 'inbound' })
  const tools = registry.schemasFor(enabledTools)

  try {
    await provider.accept({
      callId: openaiCallId, model: agent.model, instructions, tools,
      voice: agent.voice, reasoningEffort: agent.reasoning_effort,
    })
  } catch (err) {
    await store.updateCall(call.id, { status: 'failed', error_code: 'OPENAI_ACCEPT_FAILED', error_message: (err as Error).message })
    await markProcessed(store, eventId, 'failed', 'accept failed')
    return { httpStatus: 200, body: { received: true, status: 'accept_failed' } }
  }

  await store.updateCall(call.id, { status: 'accepted', answered_at: new Date().toISOString() })
  await store.audit({
    tenant_id: tenant.id, actor_type: 'webhook', operation: 'call.accepted', resource_type: 'call',
    resource_id: call.id, call_id: call.id, request_id: deps.requestId,
  })
  await markProcessed(store, eventId, 'processed')

  // 9. worker dispatch is the caller's responsibility (route posts to worker; the
  // simulate script drives the session directly). We return the callId.
  return { httpStatus: 200, body: { received: true, status: 'accepted', call_id: call.id }, callId: call.id, accepted: true }
}

async function markProcessed(store: VoiceStore, eventId: string, status: string, error?: string): Promise<void> {
  // find the event row id via a fresh insert-if-new (returns existing row)
  const { row } = await store.insertWebhookEventIfNew({
    provider: 'openai', external_event_id: eventId, event_type: 'x', signature_valid: true,
    payload_hash: 'x', payload: null, status, attempts: 0,
  })
  await store.markWebhookProcessed(row.id, status, error)
}
