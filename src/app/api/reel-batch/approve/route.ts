// PM 批准 Reel 小样，触发全尺寸渲染继续。内部端点。
import { NextRequest, NextResponse } from 'next/server'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import { REEL_BATCH_PREVIEW_APPROVED_EVENT } from '@/lib/inngest/functions/reel-batch-render'
import { z } from 'zod'

const BodySchema = z.object({
  batch_id: z.string().min(1),
})

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = req.headers.get('x-internal-secret')
  const expectedSecret = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!expectedSecret || !secret || secret !== expectedSecret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'missing batch_id' }, { status: 422 })
  }

  const result = await sendInngestEvent({
    id: `reel-batch-approved-${parsed.data.batch_id}-${Date.now()}`,
    name: REEL_BATCH_PREVIEW_APPROVED_EVENT,
    data: { batch_id: parsed.data.batch_id, approved_at: new Date().toISOString() },
  })

  return NextResponse.json({ ok: true, event_ids: result.event_ids })
}
