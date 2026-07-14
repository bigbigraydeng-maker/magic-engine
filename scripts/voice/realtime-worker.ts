/**
 * scripts/voice/realtime-worker.ts — the long-lived realtime worker process.
 *
 * Spec §4/§23: this MUST run as a persistent Node process (Render/Fly/Railway
 * `worker` service), NOT a short-lived serverless function, because it holds the
 * OpenAI realtime control WebSocket open for the duration of each call.
 *
 * Endpoints:
 *   GET  /health/live
 *   GET  /health/ready
 *   POST /internal/realtime/sessions        { callId }   (Bearer INTERNAL_WORKER_TOKEN)
 *   POST /internal/realtime/sessions/:id/stop
 *
 * P0 status: the HTTP control surface, auth, health, and session bootstrap
 * (buildSession + start) are implemented. The live OpenAI realtime WebSocket bridge
 * (mapping raw realtime events → NormalizedEvent and streaming audio) is the marked
 * real-integration extension point — see connectRealtimeSocket() below. The mock
 * closed loop is exercised end-to-end by scripts/voice/simulate-openai-call.ts.
 *
 * Usage: npx tsx --env-file=.env.local scripts/voice/realtime-worker.ts
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { getVoiceConfig, resetVoiceConfigCache } from '../../src/lib/voice/config'
import { getVoiceStore } from '../../src/lib/voice/store'
import { getRealtimeProvider } from '../../src/lib/voice/providers'
import { buildSession } from '../../src/lib/voice/realtime/worker'
import { RecordingSink } from '../../src/lib/voice/realtime/session'

const PORT = Number(process.env.REALTIME_WORKER_PORT ?? 4100)

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Real-integration extension point: open the OpenAI realtime control socket
 *   wss://api.openai.com/v1/realtime?call_id={openaiCallId}
 * with Authorization: Bearer OPENAI_API_KEY, map raw events → NormalizedEvent, and
 * feed them into the CallSession. Not wired in P0 (mock loop covers the data path).
 */
async function connectRealtimeSocket(openaiCallId: string): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`[worker] TODO: open realtime ws for ${openaiCallId} (real-integration extension point)`)
}

async function handleSession(req: IncomingMessage, res: ServerResponse) {
  const cfg = getVoiceConfig()
  const token = cfg.env.INTERNAL_WORKER_TOKEN
  const auth = req.headers['authorization']
  if (!token || auth !== `Bearer ${token}`) return json(res, 401, { error: 'unauthorized' })

  const body = JSON.parse((await readBody(req)) || '{}')
  const callId = body.callId as string | undefined
  if (!callId) return json(res, 400, { error: 'callId required' })

  const store = await getVoiceStore()
  const provider = getRealtimeProvider()
  try {
    const session = await buildSession(store, provider, callId, new RecordingSink())
    await session.start()
    const call = await store.getCallById(callId)
    if (call?.openai_call_id && !provider.simulated) await connectRealtimeSocket(call.openai_call_id)
    return json(res, 202, { status: 'session_started', callId })
  } catch (e) {
    return json(res, 500, { error: (e as Error).message })
  }
}

const server = createServer((req, res) => {
  const url = req.url ?? '/'
  if (req.method === 'GET' && url === '/health/live') return json(res, 200, { status: 'live' })
  if (req.method === 'GET' && url === '/health/ready') {
    try { getVoiceConfig(); return json(res, 200, { status: 'ready' }) }
    catch (e) { return json(res, 503, { status: 'unready', error: (e as Error).message }) }
  }
  if (req.method === 'POST' && url === '/internal/realtime/sessions') return void handleSession(req, res)
  json(res, 404, { error: 'not found' })
})

resetVoiceConfigCache()
server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[voice-realtime-worker] listening on :${PORT} (store=${getVoiceConfig().storeKind})`)
})
