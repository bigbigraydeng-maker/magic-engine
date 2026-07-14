import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryVoiceStore } from '../store/memory'
import { MockRealtimeProvider } from '../providers/mock'
import { resetVoiceConfigCache } from '../config'
import { seedDemoData, type SeedResult } from '../seed'
import { simulateInboundCall, simulateOutboundCall, buildIncomingWebhook } from '../realtime/mock-runner'
import { handleOpenAiWebhook } from '../webhook/openai-handler'
import { getToolRegistry } from '../tools'
import { searchKnowledge } from '../knowledge'
import type { NormalizedEvent } from '../realtime/session'

function tenantOf(seed: SeedResult, slug: string) {
  const t = seed.tenants.find((x) => x.slug === slug)!
  return t
}

const leadCallEvents: NormalizedEvent[] = [
  { type: 'session.created' },
  { type: 'user_transcript', text: 'Hi, I run a flooring business in Brisbane and want more leads.' },
  { type: 'function_call', name: 'search_knowledge_base', arguments: { query: 'services and pricing', category: null, language: null }, callId: 'tc1' },
  { type: 'assistant_transcript', text: 'Happy to help — a discovery call is needed before a final quote. What is your budget range?' },
  { type: 'function_call', name: 'create_or_update_lead', arguments: { service_interest: 'lead generation', intent_level: 'high', budget_min: 1000, budget_max: 3000, currency: 'AUD', preferred_area: 'Brisbane', timeline: 'this month', next_action: 'book discovery call', notes: 'flooring business' }, callId: 'tc2' },
  { type: 'assistant_transcript', text: "Great — I'll arrange a callback to confirm the details." },
  { type: 'function_call', name: 'schedule_callback', arguments: { preferred_date: null, preferred_time_window: 'tomorrow morning', timezone: 'Pacific/Auckland', reason: 'discovery call' }, callId: 'tc3' },
  { type: 'function_call', name: 'end_call', arguments: { reason: 'completed' }, callId: 'tc4' },
  { type: 'call.ended', reason: 'completed' },
]

describe('Voice Agent — full mock closed loop', () => {
  let store: InMemoryVoiceStore
  let provider: MockRealtimeProvider
  let seed: SeedResult

  beforeEach(async () => {
    process.env.MOCK_EXTERNAL_SERVICES = 'true'
    delete process.env.OPENAI_WEBHOOK_SECRET
    resetVoiceConfigCache()
    store = new InMemoryVoiceStore()
    provider = new MockRealtimeProvider()
    seed = await seedDemoData(store)
  })

  it('scenario B: inbound call → knowledge → lead → callback → summary (DoD)', async () => {
    const { callId, webhookStatus } = await simulateInboundCall({
      store, provider, calledNumber: '+6493000000', callerNumber: '+61400111222', script: leadCallEvents,
    })
    expect(webhookStatus).toBe(200)
    expect(callId).toBeTruthy()

    const call = await store.getCallById(callId)
    expect(call?.status).toBe('completed')
    expect(call?.summary_status).toBe('done')
    expect(call?.summary).toBeTruthy()
    expect(call?.duration_seconds).toBeGreaterThanOrEqual(0)

    // provider was asked to accept + hangup
    expect(provider.log.accepted.length).toBe(1)
    expect(provider.log.hungup.length).toBe(1)

    // transcript persisted (greeting + user + assistant lines)
    const transcript = await store.listTranscript(callId)
    expect(transcript.length).toBeGreaterThan(3)
    expect(transcript[0].speaker).toBe('assistant') // greeting first

    // lead created + linked
    const leads = await store.listLeadsByTenant(tenantOf(seed, 'magic-engine-demo').tenantId)
    expect(leads.length).toBe(1)
    expect(leads[0].stage).toBe('qualified')
    expect(leads[0].intent_level).toBe('high')
    expect(call?.lead_id).toBe(leads[0].id)

    // structured outcome has promises_made (板桥 #3)
    const so = call?.structured_outcome as { promises_made?: string[] }
    expect(Array.isArray(so.promises_made)).toBe(true)

    // tool calls recorded
    const tcs = await store.listToolCalls(callId)
    expect(tcs.map((t) => t.tool_name)).toEqual(
      expect.arrayContaining(['search_knowledge_base', 'create_or_update_lead', 'schedule_callback', 'end_call']),
    )
  })

  it('scenario B: repeat create_or_update_lead does NOT create duplicate leads', async () => {
    const doubleLead: NormalizedEvent[] = [
      { type: 'function_call', name: 'create_or_update_lead', arguments: { service_interest: 'a', intent_level: 'medium', budget_min: null, budget_max: null, currency: null, preferred_area: null, timeline: null, next_action: 'x', notes: null }, callId: 'd1' },
      { type: 'function_call', name: 'create_or_update_lead', arguments: { service_interest: 'a updated', intent_level: 'high', budget_min: null, budget_max: null, currency: null, preferred_area: null, timeline: null, next_action: 'y', notes: null }, callId: 'd2' },
      { type: 'call.ended', reason: 'completed' },
    ]
    const { callId } = await simulateInboundCall({ store, provider, calledNumber: '+6493000000', script: doubleLead })
    const leads = await store.listLeadsByTenant(tenantOf(seed, 'magic-engine-demo').tenantId)
    expect(leads.length).toBe(1)
    expect(leads[0].service_interest).toBe('a updated')
    const call = await store.getCallById(callId)
    expect(call?.lead_id).toBe(leads[0].id)
  })

  it('scenario E: transfer only to whitelisted target; call transferred', async () => {
    const transferEvents: NormalizedEvent[] = [
      { type: 'function_call', name: 'transfer_to_human', arguments: { reason: 'complex request', target: 'sales', brief: 'wants a manager' }, callId: 't1' },
      { type: 'call.ended', reason: 'transferred' },
    ]
    const { callId } = await simulateInboundCall({ store, provider, calledNumber: '+6493000001', script: transferEvents })
    expect(provider.log.referred.length).toBe(1)
    expect(provider.log.referred[0].targetUri).toBe('tel:+6421000001') // CTS whitelist uri, not arbitrary
    const call = await store.getCallById(callId)
    expect(['transferred', 'completed']).toContain(call?.status)
  })

  it('scenario F: cross-tenant isolation — knowledge search cannot read another tenant', async () => {
    const cts = tenantOf(seed, 'cts-tours')
    const oztop = tenantOf(seed, 'oztop')
    const ctsTenant = await store.getTenantById(cts.tenantId)
    const ctsAgent = await store.getAgentById(cts.agentId)
    const oztopContent = 'SPC flooring rigid hybrid laminate'
    // CTS context querying an Oztop-specific term must not surface Oztop docs
    const ctx = {
      store, tenant: ctsTenant!, agent: ctsAgent!, brain: { brandName: 'CTS', coreProposition: null, primaryAudience: null, painPoints: [], products: null, tone: null, avoidWords: [], contentPillars: null, redlinePhrases: [], country: 'NZ', city: null, source: 'tenant_settings' as const },
      tenantId: cts.tenantId, clientId: null, agentId: cts.agentId, callId: 'x', contactId: null, leadId: null,
      locale: 'en-NZ', timezone: 'Pacific/Auckland',
    }
    const res = await searchKnowledge(ctx, { query: oztopContent, category: null, language: null })
    // CTS store has no SPC/laminate doc → no cross-tenant leakage
    for (const s of res.sources) {
      const doc = await store.getKnowledgeById(s.document_id)
      expect(doc?.tenant_id).toBe(cts.tenantId)
    }
  })

  it('scenario D + 板桥 #2: price query flags human verification', async () => {
    const oztop = tenantOf(seed, 'oztop')
    const tenant = await store.getTenantById(oztop.tenantId)
    const agent = await store.getAgentById(oztop.agentId)
    const ctx = {
      store, tenant: tenant!, agent: agent!, brain: { brandName: 'Oztop', coreProposition: null, primaryAudience: null, painPoints: [], products: null, tone: null, avoidWords: [], contentPillars: null, redlinePhrases: [], country: 'AU', city: null, source: 'tenant_settings' as const },
      tenantId: oztop.tenantId, clientId: null, agentId: oztop.agentId, callId: 'x', contactId: null, leadId: null,
      locale: 'en-AU', timezone: 'Australia/Sydney',
    }
    const res = await searchKnowledge(ctx, { query: 'how much does SPC flooring cost per square metre', category: null, language: null })
    expect(res.requires_human_verification).toBe(true)
  })

  it('scenario G: duplicate webhook (same event id) is processed once', async () => {
    const wh = buildIncomingWebhook({ calledNumber: '+6493000000', eventId: 'evt_dupe_1' })
    const first = await handleOpenAiWebhook(wh.rawBody, wh.headers, { store, provider })
    const second = await handleOpenAiWebhook(wh.rawBody, wh.headers, { store, provider })
    expect(first.accepted).toBe(true)
    expect(second.body.status).toBe('skipped_duplicate')
    expect(provider.log.accepted.length).toBe(1) // accepted only once
  })

  it('scenario G (concurrent): two simultaneous same-event webhooks accept once', async () => {
    const wh = buildIncomingWebhook({ calledNumber: '+6493000000', eventId: 'evt_race_1' })
    const [a, b] = await Promise.all([
      handleOpenAiWebhook(wh.rawBody, wh.headers, { store, provider }),
      handleOpenAiWebhook(wh.rawBody, wh.headers, { store, provider }),
    ])
    const accepts = [a, b].filter((r) => r.accepted).length
    expect(accepts).toBe(1)
    expect(provider.log.accepted.length).toBe(1)
  })

  it('unknown called number → rejected, no call created', async () => {
    const wh = buildIncomingWebhook({ calledNumber: '+6499999999' })
    const res = await handleOpenAiWebhook(wh.rawBody, wh.headers, { store, provider })
    expect(res.body.status).toBe('rejected')
    expect(provider.log.rejected.length).toBe(1)
  })

  it('outbound: gate blocks non-test number; test number runs full loop', async () => {
    // outbound disabled, no test numbers configured → non-test blocked
    process.env.VOICE_TEST_NUMBERS = '+6421999999'
    process.env.OUTBOUND_CALLING_ENABLED = 'false'
    resetVoiceConfigCache()
    const demo = tenantOf(seed, 'magic-engine-demo')

    await expect(
      simulateOutboundCall({ store, provider, tenantId: demo.tenantId, agentId: demo.agentId, toNumber: '+6421123456', script: [] }),
    ).rejects.toMatchObject({ code: 'OUTBOUND_BLOCKED' })

    const { callId } = await simulateOutboundCall({
      store, provider, tenantId: demo.tenantId, agentId: demo.agentId, toNumber: '+6421999999',
      script: [
        { type: 'user_transcript', text: 'Hello?' },
        { type: 'function_call', name: 'end_call', arguments: { reason: 'completed' }, callId: 'o1' },
        { type: 'call.ended', reason: 'completed' },
      ],
    })
    const call = await store.getCallById(callId)
    expect(call?.direction).toBe('outbound')
    expect(call?.is_simulated).toBe(true)
    expect(call?.provider).toBe('mock')
    expect(call?.summary_status).toBe('done')
  })

  it('tool schemas exclude tools the agent has not enabled', () => {
    const registry = getToolRegistry()
    const schemas = registry.schemasFor(['search_knowledge_base'])
    expect(schemas.length).toBe(1)
    expect((schemas[0] as { name: string }).name).toBe('search_knowledge_base')
  })
})
