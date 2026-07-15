/** GET/POST /api/voice/tenants/:tenantId/agents — list / create-or-update agent. */
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { getVoiceStore } from '@/lib/voice/store'
import { requireVoiceAdmin } from '@/lib/voice/api-auth'

export const dynamic = 'force-dynamic'

const ALL_TOOLS = ['search_knowledge_base', 'get_contact_profile', 'create_or_update_lead', 'schedule_callback', 'transfer_to_human', 'end_call']

export async function GET(_req: NextRequest, { params }: { params: { tenantId: string } }): Promise<NextResponse> {
  const auth = await requireVoiceAdmin()
  if (auth instanceof NextResponse) return auth
  const store = await getVoiceStore()
  return NextResponse.json({ agents: await store.listAgentsByTenant(params.tenantId) })
}

const AgentBody = z.object({
  id: z.string().uuid().optional(), // present = update
  name: z.string().min(1),
  role: z.enum(['sales', 'support', 'hybrid']),
  status: z.enum(['draft', 'active', 'disabled']).default('active'),
  greeting: z.string().min(1),
  system_instructions: z.string().default(''),
  voice: z.string().nullable().default('marin'),
  primary_language: z.string().default('en-NZ'),
  supported_languages: z.array(z.string()).default(['en-NZ']),
  enabled_tools: z.array(z.string()).default(ALL_TOOLS),
  human_transfer_uri: z.string().nullable().default(null),
  // 板桥 #1 hard rule: cannot be turned off
  ai_disclosure_required: z.literal(true).default(true),
})

export async function POST(req: NextRequest, { params }: { params: { tenantId: string } }): Promise<NextResponse> {
  const auth = await requireVoiceAdmin()
  if (auth instanceof NextResponse) return auth
  const parsed = AgentBody.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })

  const store = await getVoiceStore()
  const tenant = await store.getTenantById(params.tenantId)
  if (!tenant) return NextResponse.json({ error: 'tenant not found' }, { status: 404 })

  const b = parsed.data
  const existing = b.id ? await store.getAgentById(b.id) : null
  if (b.id && (!existing || existing.tenant_id !== params.tenantId)) {
    return NextResponse.json({ error: 'agent not found in tenant' }, { status: 404 })
  }
  const transfer = b.human_transfer_uri
  const agent = await store.insertAgent({
    id: b.id ?? randomUUID(),
    tenant_id: params.tenantId,
    name: b.name,
    role: b.role,
    status: b.status,
    model: existing?.model ?? 'gpt-realtime-2.1-mini',
    voice: b.voice,
    reasoning_effort: existing?.reasoning_effort ?? 'low',
    primary_language: b.primary_language,
    supported_languages: b.supported_languages,
    greeting: b.greeting,
    system_instructions: b.system_instructions,
    ai_disclosure_required: true,
    business_hours: existing?.business_hours ?? {},
    human_transfer_uri: transfer,
    transfer_targets: transfer
      ? { default: transfer, sales: transfer, support: transfer, manager: transfer }
      : (existing?.transfer_targets ?? {}),
    enabled_tools: b.enabled_tools,
    settings: existing?.settings ?? {},
  })
  await store.audit({
    tenant_id: params.tenantId, actor_type: 'user', actor_id: auth.email,
    operation: existing ? 'agent.update' : 'agent.create', resource_type: 'voice_agent', resource_id: agent.id,
    changes: { name: agent.name, role: agent.role, status: agent.status },
  })
  return NextResponse.json({ agent }, { status: existing ? 200 : 201 })
}
