/** DELETE /api/voice/tenants/:tenantId/knowledge/:docId — soft-disable a knowledge doc. */
import { NextResponse } from 'next/server'
import { getVoiceStore } from '@/lib/voice/store'
import { requireVoiceAdmin } from '@/lib/voice/api-auth'

export const dynamic = 'force-dynamic'

export async function DELETE(_req: Request, { params }: { params: { tenantId: string; docId: string } }): Promise<NextResponse> {
  const auth = await requireVoiceAdmin()
  if (auth instanceof NextResponse) return auth
  const store = await getVoiceStore()
  const doc = await store.getKnowledgeById(params.docId)
  if (!doc || doc.tenant_id !== params.tenantId) return NextResponse.json({ error: 'not found' }, { status: 404 })
  // soft delete: searchKnowledge already filters index_status='disabled'
  await store.updateKnowledgeDoc(params.docId, { index_status: 'disabled' })
  await store.audit({
    tenant_id: params.tenantId, actor_type: 'user', actor_id: auth.email,
    operation: 'knowledge.disable', resource_type: 'voice_knowledge_document', resource_id: params.docId,
  })
  return NextResponse.json({ disabled: true })
}
