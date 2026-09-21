import { NextRequest, NextResponse } from 'next/server'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import { SEMANTIC_BROLL_REQUESTED_EVENT, validateSemanticBrollRequest } from '@/lib/inngest/functions/semantic-broll'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = validateSemanticBrollRequest(await request.json())
    const receipt = await sendInngestEvent({ id: body.job_id, name: SEMANTIC_BROLL_REQUESTED_EVENT, data: body })
    return NextResponse.json({ accepted: true, job_id: body.job_id, event_ids: receipt.event_ids })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid_request'
    if (message.startsWith('INNGEST_EVENT_')) return NextResponse.json({ error: message }, { status: 502 })
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
