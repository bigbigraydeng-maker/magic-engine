/** GET/POST /api/voice/tenants/:tenantId/knowledge — list / add a knowledge doc (paste text). */
import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { z } from 'zod'
import { getVoiceStore } from '@/lib/voice/store'
import { requireVoiceAdmin } from '@/lib/voice/api-auth'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { tenantId: string } }): Promise<NextResponse> {
  const auth = await requireVoiceAdmin()
  if (auth instanceof NextResponse) return auth
  const store = await getVoiceStore()
  const docs = (await store.listKnowledgeByTenant(params.tenantId))
    .filter((d) => d.index_status !== 'disabled')
    .map((d) => ({
      id: d.id, title: d.title, index_status: d.index_status, version: d.version,
      chars: String((d.attributes as { content?: string })?.content ?? '').length,
    }))
  return NextResponse.json({ documents: docs })
}

const DocBody = z.object({
  title: z.string().min(1),
  content: z.string().min(1).max(200_000),
})

export async function POST(req: NextRequest, { params }: { params: { tenantId: string } }): Promise<NextResponse> {
  const auth = await requireVoiceAdmin()
  if (auth instanceof NextResponse) return auth
  const parsed = DocBody.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })

  const store = await getVoiceStore()
  const tenant = await store.getTenantById(params.tenantId)
  if (!tenant) return NextResponse.json({ error: 'tenant not found' }, { status: 404 })

  const checksum = createHash('sha256').update(parsed.data.content).digest('hex')
  // dedupe: same tenant + same checksum on an active doc → skip
  const dup = (await store.listKnowledgeByTenant(params.tenantId)).find(
    (d) => d.checksum === checksum && d.index_status !== 'disabled',
  )
  if (dup) return NextResponse.json({ document: { id: dup.id }, deduped: true })

  const doc = await store.createKnowledgeDoc({
    tenant_id: params.tenantId,
    title: parsed.data.title,
    source_type: 'paste',
    storage_path: null,
    source_url: null,
    mime_type: 'text/plain',
    checksum,
    openai_file_id: null,
    openai_vector_store_id: null,
    // keyword search works immediately over attributes.content (no vector store needed)
    index_status: 'ready',
    version: 1,
    attributes: { content: parsed.data.content },
    error_message: null,
  })
  await store.audit({
    tenant_id: params.tenantId, actor_type: 'user', actor_id: auth.email,
    operation: 'knowledge.create', resource_type: 'voice_knowledge_document', resource_id: doc.id,
    changes: { title: doc.title },
  })
  return NextResponse.json({ document: { id: doc.id, title: doc.title } }, { status: 201 })
}
