/** GET/POST /api/voice/tenants/:tenantId/phone-routes — list / add a number→agent route. */
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { getVoiceStore } from '@/lib/voice/store'
import { requireVoiceAdmin } from '@/lib/voice/api-auth'
import { normalizeE164, isValidE164 } from '@/lib/voice/domain'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { tenantId: string } }): Promise<NextResponse> {
  const auth = await requireVoiceAdmin()
  if (auth instanceof NextResponse) return auth
  const store = await getVoiceStore()
  return NextResponse.json({ routes: await store.listRoutesByTenant(params.tenantId) })
}

const RouteBody = z.object({
  agent_id: z.string().uuid(),
  phone_number: z.string().min(3),
  provider: z.string().default('signalwire'),
  channel: z.enum(['pstn', 'sip', 'whatsapp_call']).default('sip'),
  direction: z.enum(['inbound', 'outbound', 'both']).default('both'),
  country: z.enum(['NZ', 'AU', 'US']).default('NZ'),
})

export async function POST(req: NextRequest, { params }: { params: { tenantId: string } }): Promise<NextResponse> {
  const auth = await requireVoiceAdmin()
  if (auth instanceof NextResponse) return auth
  const parsed = RouteBody.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })
  const b = parsed.data

  const e164 = normalizeE164(b.phone_number, b.country)
  if (!isValidE164(e164)) return NextResponse.json({ error: `invalid number: ${b.phone_number}` }, { status: 400 })

  const store = await getVoiceStore()
  const agent = await store.getAgentById(b.agent_id)
  if (!agent || agent.tenant_id !== params.tenantId) {
    return NextResponse.json({ error: 'agent not found in tenant' }, { status: 404 })
  }
  const existing = (await store.listRoutesByTenant(params.tenantId)).find((r) => r.phone_number_e164 === e164)
  const route = await store.insertRoute({
    id: existing?.id ?? randomUUID(),
    tenant_id: params.tenantId,
    agent_id: b.agent_id,
    provider: b.provider,
    channel: b.channel,
    phone_number_e164: e164,
    sip_uri: null,
    provider_resource_id: null,
    direction: b.direction,
    status: 'active',
    priority: 100,
    settings: {},
  })
  await store.audit({
    tenant_id: params.tenantId, actor_type: 'user', actor_id: auth.email,
    operation: existing ? 'route.update' : 'route.create', resource_type: 'voice_phone_route', resource_id: route.id,
    changes: { number: e164, agent_id: b.agent_id },
  })
  return NextResponse.json({ route }, { status: existing ? 200 : 201 })
}
