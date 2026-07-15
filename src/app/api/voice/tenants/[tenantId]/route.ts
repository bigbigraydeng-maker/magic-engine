/** PATCH /api/voice/tenants/:tenantId — update tenant (client mapping, name, vector store). */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getVoiceStore } from '@/lib/voice/store'
import { requireVoiceAdmin } from '@/lib/voice/api-auth'

export const dynamic = 'force-dynamic'

const Patch = z.object({
  name: z.string().min(1).optional(),
  client_id: z.string().uuid().nullable().optional(),
  openai_vector_store_id: z.string().nullable().optional(),
  status: z.enum(['active', 'suspended', 'archived']).optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: { tenantId: string } }): Promise<NextResponse> {
  const auth = await requireVoiceAdmin()
  if (auth instanceof NextResponse) return auth
  const parsed = Patch.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })

  const store = await getVoiceStore()
  const tenant = await store.getTenantById(params.tenantId)
  if (!tenant) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const next = await store.insertTenant({ ...tenant, ...parsed.data })
  await store.audit({
    tenant_id: tenant.id, actor_type: 'user', actor_id: auth.email,
    operation: 'tenant.update', resource_type: 'voice_tenant', resource_id: tenant.id,
    changes: parsed.data,
  })
  return NextResponse.json({ tenant: next })
}
