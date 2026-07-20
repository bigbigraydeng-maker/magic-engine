/**
 * scripts/voice/simulate-openai-call.ts
 *
 * Runs the full P0 closed loop against the in-memory store + mock provider — no
 * external services required (spec §0.2 mock DoD). Proves:
 *   incoming webhook (verified) → route → accept → greeting → user speech →
 *   search_knowledge_base → create_or_update_lead → schedule_callback → end_call →
 *   transcript + tool calls + summary + lead persisted.
 *
 * Usage:
 *   npx tsx scripts/voice/simulate-openai-call.ts            # inbound demo
 *   npx tsx scripts/voice/simulate-openai-call.ts --outbound # outbound (sandbox test number)
 */
import { InMemoryVoiceStore } from '../../src/lib/voice/store/memory'
import { setVoiceStore } from '../../src/lib/voice/store'
import { MockRealtimeProvider } from '../../src/lib/voice/providers/mock'
import { resetVoiceConfigCache } from '../../src/lib/voice/config'
import { seedDemoData } from '../../src/lib/voice/seed'
import { simulateInboundCall, simulateOutboundCall } from '../../src/lib/voice/realtime/mock-runner'
import type { NormalizedEvent } from '../../src/lib/voice/realtime/session'

async function main() {
  const outbound = process.argv.includes('--outbound')
  process.env.MOCK_EXTERNAL_SERVICES = 'true'
  process.env.VOICE_TEST_NUMBERS = '+6421999999'
  process.env.OUTBOUND_CALLING_ENABLED = 'false'
  resetVoiceConfigCache()

  const store = new InMemoryVoiceStore()
  setVoiceStore(store)
  const provider = new MockRealtimeProvider()
  const seed = await seedDemoData(store)
  const demo = seed.tenants.find((t) => t.slug === 'magic-engine-demo')!

  const script: NormalizedEvent[] = [
    { type: 'session.created' },
    { type: 'user_transcript', text: 'Hi, I run a flooring business in Brisbane. Can you help me get more leads?' },
    { type: 'function_call', name: 'search_knowledge_base', arguments: { query: 'services and pricing policy', category: null, language: null }, callId: 'tc_kb' },
    { type: 'assistant_transcript', text: "Absolutely. We start with a discovery call before any final quote. What's your monthly budget range?" },
    { type: 'user_transcript', text: 'Around one to three thousand dollars a month, and I want to start this month.' },
    { type: 'function_call', name: 'create_or_update_lead', arguments: { service_interest: 'lead generation for flooring', intent_level: 'high', budget_min: 1000, budget_max: 3000, currency: 'AUD', preferred_area: 'Brisbane', timeline: 'this month', next_action: 'book discovery call', notes: 'flooring SMB' }, callId: 'tc_lead' },
    { type: 'assistant_transcript', text: "Great — I'll arrange a callback with a specialist to confirm the details." },
    { type: 'function_call', name: 'schedule_callback', arguments: { preferred_date: null, preferred_time_window: 'tomorrow morning', timezone: 'Australia/Brisbane', reason: 'discovery call' }, callId: 'tc_cb' },
    { type: 'function_call', name: 'end_call', arguments: { reason: 'completed' }, callId: 'tc_end' },
    { type: 'call.ended', reason: 'completed' },
  ]

  const res = outbound
    ? await simulateOutboundCall({ store, provider, tenantId: demo.tenantId, agentId: demo.agentId, toNumber: '+6421999999', script })
    : await simulateInboundCall({ store, provider, calledNumber: '+6493000000', callerNumber: '+61400111222', script })

  const call = await store.getCallById(res.callId)
  const transcript = await store.listTranscript(res.callId)
  const toolCalls = await store.listToolCalls(res.callId)
  const leads = await store.listLeadsByTenant(demo.tenantId)
  const so = (call?.structured_outcome ?? {}) as Record<string, unknown>

  console.log(`\n=== ${outbound ? 'OUTBOUND' : 'INBOUND'} MOCK CALL RESULT ===`)
  console.log(`webhook http: ${res.webhookStatus}`)
  console.log(`call: id=${call?.id} status=${call?.status} direction=${call?.direction} provider=${call?.provider} simulated=${call?.is_simulated} duration=${call?.duration_seconds}s`)
  console.log(`summary_status: ${call?.summary_status}`)
  console.log(`outcome: ${call?.outcome}`)
  console.log(`summary: ${call?.summary}`)
  console.log(`promises_made: ${JSON.stringify(so.promises_made)}`)
  console.log(`\n--- transcript (${transcript.length} segments) ---`)
  for (const s of transcript) console.log(`  [${s.sequence_no}] ${s.speaker}: ${s.text}`)
  console.log(`\n--- tool calls (${toolCalls.length}) ---`)
  for (const t of toolCalls) console.log(`  ${t.tool_name} → ${t.status} (${t.latency_ms}ms)`)
  console.log(`\n--- lead ---`)
  const lead = leads[0]
  console.log(`  id=${lead?.id} stage=${lead?.stage} intent=${lead?.intent_level} interest=${lead?.service_interest} budget=${lead?.budget_min}-${lead?.budget_max} ${lead?.currency} area=${lead?.preferred_area} timeline=${lead?.timeline} next=${lead?.next_action}`)
  console.log(`  call.lead_id linked: ${call?.lead_id === lead?.id ? 'YES' : 'NO'}`)
  console.log(`\n--- provider control plane ---`)
  console.log(`  accepted=${provider.log.accepted.length} referred=${provider.log.referred.length} hungup=${provider.log.hungup.length} originated=${provider.log.originated.length}`)

  const ok = call?.status && ['completed', 'transferred'].includes(call.status) && call.summary_status === 'done' && leads.length === 1 && call.lead_id === lead?.id
  console.log(`\n${ok ? '✅ CLOSED LOOP OK' : '❌ CLOSED LOOP FAILED'}\n`)
  process.exit(ok ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
