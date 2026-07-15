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
import { startRealtimeSession, type OpenAiRealtimeBridge } from '../../src/lib/voice/realtime/openai-bridge'

// Render assigns PORT for private/web services; fall back to the configured/dev port.
const PORT = Number(process.env.PORT ?? process.env.REALTIME_WORKER_PORT ?? 4100)

// active real-call bridges, keyed by callId (for /stop + cleanup)
const activeBridges = new Map<string, OpenAiRealtimeBridge>()

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
 * Real path: startRealtimeSession() opens the socket via OpenAiRealtimeBridge and
 * feeds mapped events into the CallSession. Mock path: buildSession + RecordingSink.
 */
function isAuthorized(req: IncomingMessage): boolean {
  const token = getVoiceConfig().env.INTERNAL_WORKER_TOKEN
  return Boolean(token) && req.headers['authorization'] === `Bearer ${token}`
}

async function handleSession(req: IncomingMessage, res: ServerResponse) {
  if (!isAuthorized(req)) return json(res, 401, { error: 'unauthorized' })

  const body = JSON.parse((await readBody(req)) || '{}')
  const callId = body.callId as string | undefined
  if (!callId) return json(res, 400, { error: 'callId required' })

  const store = await getVoiceStore()
  const provider = getRealtimeProvider()
  try {
    if (provider.simulated) {
      // mock: no live socket — start the session against a recording sink
      const session = await buildSession(store, provider, callId, new RecordingSink())
      await session.start()
      return json(res, 202, { status: 'session_started_mock', callId })
    }
    // real: open the OpenAI realtime control socket and hold it open
    const bridge = await startRealtimeSession(store, callId)
    activeBridges.set(callId, bridge)
    return json(res, 202, { status: 'session_started', callId })
  } catch (e) {
    return json(res, 500, { error: (e as Error).message })
  }
}

async function handleStop(req: IncomingMessage, callId: string, res: ServerResponse) {
  if (!isAuthorized(req)) return json(res, 401, { error: 'unauthorized' })
  const bridge = activeBridges.get(callId)
  if (bridge) { bridge.close(); activeBridges.delete(callId) }
  return json(res, 200, { status: 'stopped', callId })
}

const server = createServer((req, res) => {
  const url = req.url ?? '/'
  if (req.method === 'GET' && url === '/health/live') return json(res, 200, { status: 'live' })
  if (req.method === 'GET' && url === '/health/ready') {
    try { getVoiceConfig(); return json(res, 200, { status: 'ready' }) }
    catch (e) { return json(res, 503, { status: 'unready', error: (e as Error).message }) }
  }
  if (req.method === 'POST' && url === '/internal/realtime/sessions') return void handleSession(req, res)
  const stop = url.match(/^\/internal\/realtime\/sessions\/([^/]+)\/stop$/)
  if (req.method === 'POST' && stop) return void handleStop(req, decodeURIComponent(stop[1]), res)
  json(res, 404, { error: 'not found' })
})

resetVoiceConfigCache()
server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[voice-realtime-worker] listening on :${PORT} (store=${getVoiceConfig().storeKind})`)
})
