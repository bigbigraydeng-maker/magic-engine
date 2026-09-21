// 触发 Reel 批量渲染工作流。内部端点，仅供 Claude Code / 后台脚本调用。
// 鉴权：INTERNAL_API_SECRET header。不对外开放。
import { NextRequest, NextResponse } from 'next/server'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import {
  REEL_BATCH_RENDER_STARTED_EVENT,
  ReelBatchStartedSchema,
} from '@/lib/inngest/functions/reel-batch-render'

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = req.headers.get('x-internal-secret')
  if (!secret || secret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsed = ReelBatchStartedSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_payload', details: parsed.error.flatten() }, { status: 422 })
  }

  const result = await sendInngestEvent({
    id: `reel-batch-${parsed.data.batch_id}`,
    name: REEL_BATCH_RENDER_STARTED_EVENT,
    data: parsed.data,
  })

  return NextResponse.json({ ok: true, event_ids: result.event_ids, batch_id: parsed.data.batch_id })
}
