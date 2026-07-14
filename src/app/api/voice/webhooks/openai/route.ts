/**
 * POST /api/voice/webhooks/openai — OpenAI SIP incoming-call webhook (spec §8.2).
 *
 * Uses the raw request body for signature verification, delegates to the reusable
 * handler (verify → idempotency → route → accept), then best-effort dispatches the
 * accepted call to the realtime worker. Returns 2xx quickly.
 */
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { handleOpenAiWebhook } from '@/lib/voice/webhook/openai-handler'
import { getVoiceConfig } from '@/lib/voice/config'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text()
  const headers: Record<string, string | undefined> = {}
  req.headers.forEach((v, k) => { headers[k] = v })
  const requestId = headers['webhook-id'] ?? randomUUID()

  const result = await handleOpenAiWebhook(rawBody, headers, { requestId })

  // Dispatch accepted call to the long-lived realtime worker (best-effort).
  if (result.accepted && result.callId) {
    const cfg = getVoiceConfig()
    const workerUrl = process.env.REALTIME_WORKER_URL
    if (workerUrl && cfg.env.INTERNAL_WORKER_TOKEN) {
      void fetch(`${workerUrl}/internal/realtime/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.env.INTERNAL_WORKER_TOKEN}` },
        body: JSON.stringify({ callId: result.callId }),
      }).catch(() => { /* worker will reconcile; webhook must still 2xx */ })
    }
  }

  return NextResponse.json(result.body, { status: result.httpStatus })
}
