/**
 * scripts/voice/test-supabase-store.ts
 *
 * Live-DB integration test for SupabaseVoiceStore — exercises the ACTUAL store JS code
 * (PGRST116 handling, upsert+refetch, error mapping, tenant scoping) against a real
 * Supabase, covering what typecheck + the in-memory tests cannot.
 *
 * The DB-level constraint behaviours (unique/idempotency/atomic-claim/cascade) were
 * separately verified via SQL on the live schema (see Phase 36 notes). This script
 * verifies the JS wrapper layer end-to-end.
 *
 * Requires real Supabase env; creates a throwaway tenant `store-jstest-<ts>` and
 * cleans it up (cascade) in a finally block.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/voice/test-supabase-store.ts
 *   (env must include NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
 */
import { randomUUID } from 'crypto'
import { getVoiceConfig, resetVoiceConfigCache } from '../../src/lib/voice/config'
import { getVoiceStore } from '../../src/lib/voice/store'
import { VoiceError } from '../../src/lib/voice/domain'

let passed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`ASSERT FAIL: ${msg}`)
  passed++
  console.log(`  ✓ ${msg}`)
}

async function main() {
  process.env.VOICE_STORE = 'supabase'
  resetVoiceConfigCache()
  const cfg = getVoiceConfig()
  if (cfg.storeKind !== 'supabase') {
    console.error('❌ store is not supabase — set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  const store = await getVoiceStore()
  const { supabaseAdmin } = await import('../../src/lib/supabase')
  const slug = `store-jstest-${Date.now()}`
  const tenantId = randomUUID()

  try {
    // tenants
    const tenant = await store.insertTenant({
      id: tenantId, client_id: null, slug, name: 'JS Store Test', status: 'active',
      default_timezone: 'Pacific/Auckland', default_language: 'en-NZ', openai_vector_store_id: null, settings: {},
    })
    assert(tenant.id === tenantId, 'insertTenant returns row')
    assert((await store.getTenantById(tenantId))?.slug === slug, 'getTenantById')
    assert((await store.getTenantBySlug(slug))?.id === tenantId, 'getTenantBySlug')
    assert((await store.getTenantById(randomUUID())) === null, 'getTenantById(missing) → null (PGRST116 handled)')

    // agent + route
    const agent = await store.insertAgent({
      id: randomUUID(), tenant_id: tenantId, name: 'Mia', role: 'sales', status: 'active',
      model: 'gpt-realtime-2.1-mini', voice: 'marin', reasoning_effort: 'low', primary_language: 'en-NZ',
      supported_languages: ['en-NZ'], greeting: 'hi', system_instructions: 'x', ai_disclosure_required: true,
      business_hours: {}, human_transfer_uri: null, transfer_targets: {}, enabled_tools: ['end_call'], settings: {},
    })
    assert((await store.listAgentsByTenant(tenantId)).some((a) => a.id === agent.id), 'insertAgent + listAgentsByTenant')
    const route = await store.insertRoute({
      id: randomUUID(), tenant_id: tenantId, agent_id: agent.id, provider: 'mock', channel: 'sip',
      phone_number_e164: '+6493999001', sip_uri: null, provider_resource_id: null, direction: 'both',
      status: 'active', priority: 100, settings: {},
    })
    assert((await store.listRoutesByTenant(tenantId)).some((r) => r.id === route.id), 'insertRoute + listRoutesByTenant')

    // contact
    const contact = await store.createContact({
      tenant_id: tenantId, phone_e164: '+6421999001', whatsapp_phone_e164: null, email: null,
      first_name: 'Test', last_name: null, preferred_language: null, consent_status: 'unknown',
      do_not_call: false, me_lead_id: null, metadata: {},
    })
    assert((await store.findContactByPhone(tenantId, '+6421999001'))?.id === contact.id, 'createContact + findContactByPhone')

    // call + openai_call_id uniqueness (dup → VoiceError)
    const openaiId = `jstest_rtc_${Date.now()}`
    const call = await store.createCall({
      tenant_id: tenantId, agent_id: agent.id, contact_id: contact.id, lead_id: null, channel: 'sip',
      direction: 'inbound', provider: 'mock', is_simulated: true, provider_call_id: null, openai_call_id: openaiId,
      from_number: '+6421999001', to_number: '+6493999001', status: 'ringing', started_at: new Date().toISOString(),
      answered_at: null, ended_at: null, duration_seconds: null, language_detected: null, recording_url: null,
      transcript_status: 'pending', summary_status: 'pending', summary: null, outcome: null, disposition: null,
      structured_outcome: {}, usage: {}, cost_estimate: {}, error_code: null, error_message: null,
    })
    assert((await store.getCallByOpenAiId(openaiId))?.id === call.id, 'createCall + getCallByOpenAiId')
    let dupThrew = false
    try {
      await store.createCall({ ...call, id: randomUUID() } as never)
    } catch (e) { dupThrew = e instanceof VoiceError && e.code === 'CALL_ALREADY_ENDED' }
    assert(dupThrew, 'duplicate openai_call_id → VoiceError(CALL_ALREADY_ENDED)')

    // transcript idempotency (same seq → same row)
    const s1 = await store.appendTranscript({
      tenant_id: tenantId, call_id: call.id, sequence_no: 1, speaker: 'user', text: 'hi',
      started_at_ms: null, ended_at_ms: null, source_event_id: null, is_final: true, metadata: {},
    })
    const s2 = await store.appendTranscript({
      tenant_id: tenantId, call_id: call.id, sequence_no: 1, speaker: 'user', text: 'dup',
      started_at_ms: null, ended_at_ms: null, source_event_id: null, is_final: true, metadata: {},
    })
    assert(s1.id === s2.id, 'appendTranscript idempotent on (call,seq) — upsert+refetch')
    assert((await store.listTranscript(call.id)).length === 1, 'listTranscript has 1 segment')

    // lead upsert idempotency (same call → same lead, anchored on call.lead_id)
    const lead1 = await store.upsertLeadForCall(call.id, tenantId, { intent_level: 'medium', service_interest: 'a' })
    const lead2 = await store.upsertLeadForCall(call.id, tenantId, { intent_level: 'high', service_interest: 'a updated' })
    assert(lead1.id === lead2.id, 'upsertLeadForCall idempotent per call')
    assert(lead2.service_interest === 'a updated', 'upsertLeadForCall updates existing')
    assert((await store.getCallById(call.id))?.lead_id === lead1.id, 'call.lead_id anchored')

    // webhook insert-if-new
    const evId = `jstest_evt_${Date.now()}`
    const wh1 = await store.insertWebhookEventIfNew({ provider: 'openai', external_event_id: evId, event_type: 'x', signature_valid: true, payload_hash: 'h', payload: null, status: 'processing', attempts: 0 })
    const wh2 = await store.insertWebhookEventIfNew({ provider: 'openai', external_event_id: evId, event_type: 'x', signature_valid: true, payload_hash: 'h', payload: null, status: 'processing', attempts: 0 })
    assert(wh1.isNew === true && wh2.isNew === false, 'insertWebhookEventIfNew: first isNew, second not (23505 refetch)')
    await store.markWebhookProcessed(wh1.row.id, 'processed')

    // claimCallForFinalize atomic
    const claim1 = await store.claimCallForFinalize(call.id)
    const claim2 = await store.claimCallForFinalize(call.id)
    assert(claim1 !== null && claim2 === null, 'claimCallForFinalize: first claims, second null')

    // knowledge
    const doc = await store.createKnowledgeDoc({
      tenant_id: tenantId, title: 'd', source_type: 'paste', storage_path: null, source_url: null,
      mime_type: 'text/plain', checksum: 'jscs1', openai_file_id: null, openai_vector_store_id: null,
      index_status: 'ready', version: 1, attributes: { content: 'hello world' }, error_message: null,
    })
    assert((await store.listKnowledgeByTenant(tenantId)).some((d) => d.id === doc.id), 'createKnowledgeDoc + list')
    await store.updateKnowledgeDoc(doc.id, { index_status: 'disabled' })
    assert((await store.getKnowledgeById(doc.id))?.index_status === 'disabled', 'updateKnowledgeDoc (disable)')

    // suppression + frequency
    await store.addSuppression(tenantId, '+6421999888', 'stop')
    assert((await store.isSuppressed(tenantId, '+6421999888')) === true, 'addSuppression + isSuppressed')
    const since = new Date(Date.now() - 3600_000).toISOString()
    assert((await store.countRecentCallsTo(tenantId, '+6493999001', since)) >= 1, 'countRecentCallsTo counts the call')

    // callback + audit
    const cb = await store.createCallbackRequest({ tenant_id: tenantId, call_id: call.id, contact_id: contact.id, preferred_date: null, preferred_time_window: 'tomorrow', timezone: 'Pacific/Auckland', reason: 'x' })
    assert(Boolean(cb.id), 'createCallbackRequest')
    await store.audit({ tenant_id: tenantId, actor_type: 'system', operation: 'test', resource_type: 'test', resource_id: 't' })
    assert(true, 'audit insert')

    // tenant-scoped list filters simulated
    const realOnly = await store.listCallsByTenant(tenantId, { includeSimulated: false })
    assert(realOnly.length === 0, 'listCallsByTenant includeSimulated=false excludes sim call')

    console.log(`\n✅ SUPABASE STORE LIVE-DB TEST PASSED (${passed} assertions)`)
  } finally {
    // cleanup (cascade) — best effort even on failure
    await supabaseAdmin.from('voice_tenants').delete().eq('id', tenantId)
    console.log(`cleaned up tenant ${slug}`)
  }
}

main().catch((e) => { console.error(`\n❌ ${(e as Error).message}`); process.exit(1) })
