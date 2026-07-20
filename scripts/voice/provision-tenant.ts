/**
 * scripts/voice/provision-tenant.ts
 *
 * Register a REAL phone number for the Voice Agent without touching SQL: creates
 * (or reuses) a voice tenant — optionally mapped to a real ME client so the agent
 * reads that client's master_brief as its brain — plus an active agent and a phone
 * route for the number.
 *
 * Run against the configured store (Supabase in prod when SUPABASE_* env is set).
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/voice/provision-tenant.ts \
 *     --slug cts-voice --name "CTS Tours" --number +6493000123 \
 *     --client <ME_CLIENT_UUID> --role sales --provider telnyx \
 *     --transfer tel:+64211234567 \
 *     --greeting "Kia ora, thanks for calling CTS Tours. This is Amy, an AI assistant. How can I help?"
 *
 * Re-running with the same --slug updates the tenant/agent and (re)uses the route.
 */
import { randomUUID } from 'crypto'
import { getVoiceConfig, resetVoiceConfigCache } from '../../src/lib/voice/config'
import { getVoiceStore } from '../../src/lib/voice/store'
import { normalizeE164, isValidE164 } from '../../src/lib/voice/domain'
import type { AgentRow } from '../../src/lib/voice/store/types'

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const ALL_TOOLS = ['search_knowledge_base', 'get_contact_profile', 'create_or_update_lead', 'schedule_callback', 'transfer_to_human', 'end_call']

async function main() {
  resetVoiceConfigCache()
  const cfg = getVoiceConfig()

  const slug = arg('slug')
  const rawNumber = arg('number')
  if (!slug || !rawNumber) {
    console.error('Required: --slug <tenant-slug> --number <phone>')
    process.exit(1)
  }
  const number = normalizeE164(rawNumber, arg('country', cfg.env.DEFAULT_COUNTRY) as string)
  if (!isValidE164(number)) { console.error(`Invalid phone number: ${rawNumber} → ${number}`); process.exit(1) }

  const name = arg('name', slug)!
  const clientId = arg('client') ?? null
  const role = (arg('role', 'sales') as 'sales' | 'support' | 'hybrid')
  const provider = arg('provider', 'twilio')!
  const channel = arg('channel', 'sip')!
  const transferUri = arg('transfer', cfg.env.DEFAULT_HUMAN_TRANSFER_URI) ?? null
  const agentName = arg('agent-name', 'Assistant')!
  const country = (arg('country', cfg.env.DEFAULT_COUNTRY) as string)
  const tz = country === 'AU' ? 'Australia/Sydney' : 'Pacific/Auckland'
  const lang = country === 'AU' ? 'en-AU' : 'en-NZ'
  const greeting = arg('greeting', `Thanks for calling ${name}. This is ${agentName}, our AI assistant. How can I help today?`)!
  const instructions = arg('instructions', `You are the AI ${role} for ${name}. Never quote prices, confirm availability, or make promises you cannot verify — use the knowledge base or offer a human follow-up.`)!

  console.log(`store=${cfg.storeKind} · provider=${provider} · number=${number} · client_id=${clientId ?? '(none — brain from tenant settings)'}`)
  if (cfg.storeKind !== 'supabase') {
    console.log('⚠️  store is not supabase — this run writes to the in-memory store and will not persist. Set SUPABASE_* env to target the real DB.')
  }

  const store = await getVoiceStore()

  // 1. tenant (reuse by slug)
  let tenant = await store.getTenantBySlug(slug)
  if (tenant) {
    console.log(`tenant exists: ${tenant.id} (reusing)`)
    if (clientId && tenant.client_id !== clientId) {
      tenant = await store.insertTenant({ ...tenant, client_id: clientId })
      console.log(`  updated client_id → ${clientId}`)
    }
  } else {
    tenant = await store.insertTenant({
      id: randomUUID(), client_id: clientId, slug, name, status: 'active',
      default_timezone: tz, default_language: lang, openai_vector_store_id: null, settings: {},
    })
    console.log(`tenant created: ${tenant.id}`)
  }

  // 2. agent (reuse first agent on tenant, else create)
  const agents = await store.listAgentsByTenant(tenant.id)
  let agent = agents[0]
  const agentRow: AgentRow = {
    id: agent?.id ?? randomUUID(), tenant_id: tenant.id, name: agentName, role, status: 'active',
    model: cfg.env.OPENAI_REALTIME_MODEL, voice: cfg.env.OPENAI_DEFAULT_VOICE ?? 'marin', reasoning_effort: 'low',
    primary_language: lang, supported_languages: [lang], greeting, system_instructions: instructions,
    ai_disclosure_required: true, business_hours: {}, human_transfer_uri: transferUri,
    transfer_targets: transferUri ? { default: transferUri, sales: transferUri, support: transferUri, manager: transferUri } : {},
    enabled_tools: ALL_TOOLS, settings: {},
  }
  agent = await store.insertAgent(agentRow)
  console.log(`agent ${agents[0] ? 'updated' : 'created'}: ${agent.id} (${role}, disclosure=${agent.ai_disclosure_required})`)

  // 3. phone route (reuse by number, else create)
  const routes = await store.listRoutesByTenant(tenant.id)
  const existingRoute = routes.find((r) => r.phone_number_e164 === number)
  const route = await store.insertRoute({
    id: existingRoute?.id ?? randomUUID(), tenant_id: tenant.id, agent_id: agent.id,
    provider, channel, phone_number_e164: number, sip_uri: null, provider_resource_id: null,
    direction: 'both', status: 'active', priority: 100, settings: {},
  })
  console.log(`route ${existingRoute ? 'updated' : 'created'}: ${route.id} → ${number}`)

  if (!transferUri) console.log('⚠️  no --transfer set: transfer_to_human has no whitelist target (板桥 硬闸 #4). Set one before live calls.')
  if (!clientId) console.log('ℹ️  no --client: brain will be minimal. Map to a real ME client to read its master_brief.')

  console.log(`\n✅ provisioned. Point your SIP provider's ${number} origination at OpenAI SIP, then call it.`)
}

main().catch((e) => { console.error('❌', (e as Error).message); process.exit(1) })
