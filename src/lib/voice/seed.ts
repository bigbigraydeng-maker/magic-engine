/**
 * Demo seed data (spec §22) for the mock closed loop + tests. Three tenants:
 *   - Magic Engine Demo (Mia, hybrid)
 *   - CTS Tours (sales)   — outbound Kiwi→China group tours
 *   - Oztop (sales)       — building supplies / flooring
 *
 * Business facts are kept conservative & accurate (CLAUDE.md 强约束: 绝不凭空注入).
 * The real path reads master_briefs via voice_tenants.client_id; this seed uses
 * tenant.settings.brain so the mock loop runs without a live DB.
 */
import { randomUUID } from 'crypto'
import type { BusinessBrain } from './brain'
import type { AgentRow, PhoneRouteRow, TenantRow, VoiceStore, KnowledgeDocRow } from './store/types'

const ALL_TOOLS = [
  'search_knowledge_base', 'get_contact_profile', 'create_or_update_lead',
  'schedule_callback', 'transfer_to_human', 'end_call',
]

interface SeedTenantSpec {
  slug: string
  name: string
  role: AgentRow['role']
  agentName: string
  greeting: string
  systemInstructions: string
  brain: Partial<BusinessBrain>
  inboundNumber: string
  knowledge: { title: string; content: string }
  transferUri: string
}

const SPECS: SeedTenantSpec[] = [
  {
    slug: 'magic-engine-demo',
    name: 'Magic Engine Demo',
    role: 'hybrid',
    agentName: 'Mia',
    greeting: 'Thanks for calling Magic Engine. This is Mia, our AI assistant. How can I help today?',
    systemInstructions: 'You help small and medium businesses in Australia and New Zealand explore AI websites, advertising, content automation, and AI phone sales/service. A discovery call is required before any final quote.',
    brain: {
      brandName: 'Magic Engine',
      coreProposition: 'AI websites, advertising workflows, content automation, AI phone sales and customer service for AU/NZ SMBs.',
      primaryAudience: 'Small and medium businesses in Australia and New Zealand.',
      tone: 'Warm, competent, concise.',
      country: 'NZ',
    },
    inboundNumber: '+6493000000',
    transferUri: 'tel:+6421000000',
    knowledge: {
      title: 'Magic Engine — Services & Pricing Policy',
      content:
        'Magic Engine provides AI websites, advertising workflows, content automation, AI phone sales and AI customer service for small and medium businesses in Australia and New Zealand. A discovery call is required before a final quote. The AI assistant must not invent project pricing. Typical engagements start with a discovery call to understand goals, channels and budget.',
    },
  },
  {
    slug: 'cts-tours',
    name: 'CTS Tours',
    role: 'sales',
    agentName: 'Amy',
    greeting: 'Kia ora, thanks for calling CTS Tours. This is Amy, an AI assistant. How can I help with your China trip today?',
    systemInstructions: 'CTS Tours arranges outbound group and tailored travel from New Zealand to China. Understand the traveller’s destination interests, group size, dates and budget. A consultant confirms the final itinerary and price — never confirm tour availability, group departures or prices yourself.',
    brain: {
      brandName: 'CTS Tours',
      coreProposition: 'Outbound China travel for New Zealand travellers — group tours and tailored trips.',
      primaryAudience: 'New Zealand residents travelling to China.',
      tone: 'Warm, knowledgeable, trustworthy; comfortable switching between English and Mandarin.',
      country: 'NZ',
      // 板桥 #4 redline: NZ arm ~25 years; global brand since 1928 — do NOT imply local since 1928
      redlinePhrases: ['Auckland since 1928', 'guaranteed departure', 'lowest price guaranteed'],
    },
    inboundNumber: '+6493000001',
    transferUri: 'tel:+6421000001',
    knowledge: {
      title: 'CTS Tours — How We Work',
      content:
        'CTS Tours arranges travel from New Zealand to China, including group tours and tailored private trips. All final itineraries, group departure dates and prices are confirmed by a human travel consultant after a discovery conversation. We do not quote or confirm availability over an automated call. We can arrange a callback with a consultant.',
    },
  },
  {
    slug: 'oztop',
    name: 'Oztop Building Supplies',
    role: 'sales',
    agentName: 'Sam',
    greeting: 'Hi, you’ve reached Oztop Building Supplies. This is Sam, an AI assistant. How can I help with your flooring or building supplies today?',
    systemInstructions: 'Oztop Building Supplies sells flooring and building supplies. Flooring lines include SPC (a type of hybrid flooring), hybrid and laminate. Only discuss product categories Oztop actually stocks. Never quote a price or confirm stock/installation yourself — have a team member confirm.',
    brain: {
      brandName: 'Oztop Building Supplies',
      coreProposition: 'Flooring and building supplies — SPC, hybrid and laminate flooring.',
      primaryAudience: 'Renovators, builders and homeowners.',
      tone: 'Practical, straightforward, helpful.',
      country: 'AU',
      // 板桥 #4 / taxonomy memory: don't offer categories Oztop doesn't sell
      redlinePhrases: ['plantation shutters', 'sheer curtains', 'herringbone timber'],
    },
    inboundNumber: '+61390000002',
    transferUri: 'tel:+61400000002',
    knowledge: {
      title: 'Oztop — Product Categories',
      content:
        'Oztop Building Supplies stocks flooring and building supplies. Flooring categories: SPC flooring (a rigid type of hybrid flooring), hybrid flooring, and laminate flooring (AC durability ratings apply to laminate). Prices, current stock and installation are confirmed by the team — the AI does not quote. Oztop does not sell window furnishings such as shutters or curtains.',
    },
  },
]

export interface SeedResult {
  tenants: { slug: string; tenantId: string; agentId: string; routeId: string }[]
}

export async function seedDemoData(store: VoiceStore): Promise<SeedResult> {
  const result: SeedResult = { tenants: [] }
  for (const spec of SPECS) {
    const tenantId = randomUUID()
    const agentId = randomUUID()
    const routeId = randomUUID()

    const tenant: TenantRow = {
      id: tenantId, client_id: null, slug: spec.slug, name: spec.name, status: 'active',
      default_timezone: spec.brain.country === 'AU' ? 'Australia/Sydney' : 'Pacific/Auckland',
      default_language: spec.brain.country === 'AU' ? 'en-AU' : 'en-NZ',
      openai_vector_store_id: null,
      settings: { brain: spec.brain },
    }
    await store.insertTenant(tenant)

    const agent: AgentRow = {
      id: agentId, tenant_id: tenantId, name: spec.agentName, role: spec.role, status: 'active',
      model: 'gpt-realtime-2.1-mini', voice: 'marin', reasoning_effort: 'low',
      primary_language: tenant.default_language,
      supported_languages: spec.slug === 'cts-tours' ? ['en-NZ', 'zh-CN'] : [tenant.default_language],
      greeting: spec.greeting, system_instructions: spec.systemInstructions, ai_disclosure_required: true,
      business_hours: {}, human_transfer_uri: spec.transferUri,
      transfer_targets: { default: spec.transferUri, sales: spec.transferUri, support: spec.transferUri, manager: spec.transferUri },
      enabled_tools: ALL_TOOLS, settings: {},
    }
    await store.insertAgent(agent)

    const route: PhoneRouteRow = {
      id: routeId, tenant_id: tenantId, agent_id: agentId, provider: 'twilio', channel: 'sip',
      phone_number_e164: spec.inboundNumber, sip_uri: null, provider_resource_id: null,
      direction: 'both', status: 'active', priority: 100, settings: {},
    }
    await store.insertRoute(route)

    const doc: Omit<KnowledgeDocRow, 'id'> = {
      tenant_id: tenantId, title: spec.knowledge.title, source_type: 'seed', storage_path: null,
      source_url: null, mime_type: 'text/plain', checksum: null, openai_file_id: null,
      openai_vector_store_id: null, index_status: 'ready', version: 1,
      attributes: { content: spec.knowledge.content }, error_message: null,
    }
    await store.createKnowledgeDoc(doc)

    result.tenants.push({ slug: spec.slug, tenantId, agentId, routeId })
  }
  return result
}
