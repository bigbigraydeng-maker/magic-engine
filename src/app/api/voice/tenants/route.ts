/** GET /api/voice/tenants (list) · POST (create) — admin. Voice tenant management. */
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { getVoiceStore } from '@/lib/voice/store'
import { requireVoiceAdmin } from '@/lib/voice/api-auth'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  const auth = await requireVoiceAdmin()
  if (auth instanceof NextResponse) return auth
  const store = await getVoiceStore()
  const tenants = await store.listTenants()
  const withCounts = await Promise.all(
    tenants.map(async (t) => ({
      ...t,
      agent_count: (await store.listAgentsByTenant(t.id)).length,
      route_count: (await store.listRoutesByTenant(t.id)).length,
      kb_count: (await store.listKnowledgeByTenant(t.id)).length,
    })),
  )
  return NextResponse.json({ tenants: withCounts })
}

const CreateTenant = z.object({
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/, 'lowercase, digits, hyphens only'),
  name: z.string().min(1),
  client_id: z.string().uuid().nullable().optional(),
  country: z.enum(['NZ', 'AU']).default('NZ'),
})

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireVoiceAdmin()
  if (auth instanceof NextResponse) return auth
  const parsed = CreateTenant.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })
  const store = await getVoiceStore()
  if (await store.getTenantBySlug(parsed.data.slug)) {
    return NextResponse.json({ error: 'slug already exists' }, { status: 409 })
  }
  const au = parsed.data.country === 'AU'
  const tenant = await store.insertTenant({
    id: randomUUID(),
    client_id: parsed.data.client_id ?? null,
    slug: parsed.data.slug,
    name: parsed.data.name,
    status: 'active',
    default_timezone: au ? 'Australia/Sydney' : 'Pacific/Auckland',
    default_language: au ? 'en-AU' : 'en-NZ',
    openai_vector_store_id: null,
    settings: {},
  })
  await store.audit({
    tenant_id: tenant.id, actor_type: 'user', actor_id: auth.email,
    operation: 'tenant.create', resource_type: 'voice_tenant', resource_id: tenant.id,
    changes: { slug: tenant.slug },
  })
  return NextResponse.json({ tenant }, { status: 201 })
}
