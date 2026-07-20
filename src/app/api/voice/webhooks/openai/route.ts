/**
 * POST /api/voice/webhooks/openai — OpenAI SIP incoming-call webhook (spec §8.2).
 *
 * Verify → idempotency → route → accept, then drive the realtime session. Two modes:
 *   - REALTIME_WORKER_URL set → dispatch to the dedicated long-lived worker (scale mode)
 *   - otherwise → open the OpenAI realtime WebSocket IN-PROCESS inside this persistent
 *     web service (MVP mode: no separate worker service needed; a web redeploy drops
 *     in-flight calls, acceptable for first-call / low volume).
 * The webhook always returns 2xx fast; the ws is fire-and-forget on the event loop.
 */
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { handleOpenAiWebhook } from '@/lib/voice/webhook/openai-handler'
import { getVoiceConfig } from '@/lib/voice/config'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs' // ws bridge needs the Node runtime, not edge
export const maxDuration = 30

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text()
  const headers: Record<string, string | undefined> = {}
  req.headers.forEach((v, k) => { headers[k] = v })
  const requestId = headers['webhook-id'] ?? randomUUID()

  const result = await handleOpenAiWebhook(rawBody, headers, { requestId })

  if (result.accepted && result.callId) {
    const cfg = getVoiceConfig()
    const workerUrl = process.env.REALTIME_WORKER_URL
    if (workerUrl && cfg.env.INTERNAL_WORKER_TOKEN) {
      // scale mode: hand off to the dedicated worker
      void fetch(`${workerUrl}/internal/realtime/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.env.INTERNAL_WORKER_TOKEN}` },
        body: JSON.stringify({ callId: result.callId }),
      }).catch(() => { /* worker reconciles; webhook must still 2xx */ })
    } else if (cfg.providers.openai === 'real') {
      // MVP mode: open the realtime ws in-process (this web service is persistent)
      const callId = result.callId
      void (async () => {
        try {
          const [{ getVoiceStore }, { startRealtimeSession }] = await Promise.all([
            import('@/lib/voice/store'),
            import('@/lib/voice/realtime/openai-bridge'),
          ])
          const store = await getVoiceStore()
          await startRealtimeSession(store, callId)
        } catch (err) {
          console.error('[voice] in-process realtime session failed', err)
        }
      })()
    }
  }

  return NextResponse.json(result.body, { status: result.httpStatus })
}
