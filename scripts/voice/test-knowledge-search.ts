/**
 * scripts/voice/test-knowledge-search.ts
 *
 * Seeds demo tenants and exercises knowledge search: a known answer, a no-result
 * query, a price query (flagged), and a cross-tenant isolation check (spec §20.2).
 *
 * Usage: npx tsx scripts/voice/test-knowledge-search.ts
 */
import { InMemoryVoiceStore } from '../../src/lib/voice/store/memory'
import { resetVoiceConfigCache } from '../../src/lib/voice/config'
import { seedDemoData } from '../../src/lib/voice/seed'
import { searchKnowledge } from '../../src/lib/voice/knowledge'
import type { ToolExecutionContext } from '../../src/lib/voice/tools/registry'

async function main() {
  process.env.MOCK_EXTERNAL_SERVICES = 'true'
  resetVoiceConfigCache()
  const store = new InMemoryVoiceStore()
  const seed = await seedDemoData(store)
  const oztop = seed.tenants.find((t) => t.slug === 'oztop')!
  const cts = seed.tenants.find((t) => t.slug === 'cts-tours')!

  async function ctxFor(t: { tenantId: string; agentId: string }): Promise<ToolExecutionContext> {
    const tenant = (await store.getTenantById(t.tenantId))!
    const agent = (await store.getAgentById(t.agentId))!
    return {
      store, tenant, agent,
      brain: { brandName: tenant.name, coreProposition: null, primaryAudience: null, painPoints: [], products: null, tone: null, avoidWords: [], contentPillars: null, redlinePhrases: [], country: null, city: null, source: 'tenant_settings' },
      tenantId: t.tenantId, clientId: null, agentId: t.agentId, callId: 'x', contactId: null, leadId: null,
      locale: 'en-NZ', timezone: 'Pacific/Auckland',
    }
  }

  const oztopCtx = await ctxFor(oztop)
  const ctsCtx = await ctxFor(cts)

  const known = await searchKnowledge(oztopCtx, { query: 'what flooring categories do you stock', category: null, language: null })
  console.log(`[known answer]  confidence=${known.confidence} sources=${known.sources.length}`)
  console.log(`  ${known.answer_context}`)

  const missing = await searchKnowledge(oztopCtx, { query: 'quantum astronomy telescope satellite', category: null, language: null })
  console.log(`[no result]     confidence=${missing.confidence} sources=${missing.sources.length}`)

  const price = await searchKnowledge(oztopCtx, { query: 'how much per square metre for SPC', category: null, language: null })
  console.log(`[price query]   requires_human_verification=${price.requires_human_verification}`)

  // Cross-tenant: CTS querying Oztop-specific content must not read Oztop docs
  const cross = await searchKnowledge(ctsCtx, { query: 'SPC hybrid laminate flooring AC rating', category: null, language: null })
  const leakCheck = await Promise.all(cross.sources.map(async (s) => (await store.getKnowledgeById(s.document_id))?.tenant_id))
  const anyCrossTenant = leakCheck.some((tid) => tid && tid !== cts.tenantId)
  console.log(`[isolation]     cross-tenant sources leaked: ${anyCrossTenant ? 'YES ❌' : 'NO ✅'}`)

  const ok = known.confidence !== 'low' && missing.sources.length === 0 && price.requires_human_verification && !anyCrossTenant
  console.log(`\n${ok ? '✅ KNOWLEDGE TESTS OK' : '❌ KNOWLEDGE TESTS FAILED'}`)
  process.exit(ok ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
