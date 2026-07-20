/**
 * OpenAI Realtime control-plane WebSocket bridge (spec §8.4/§8.5). This is the real
 * counterpart to the mock closed loop: it holds
 *   wss://api.openai.com/v1/realtime?call_id={openaiCallId}
 * open for the call, maps raw realtime events → NormalizedEvent (fed into CallSession),
 * and sends function_call_output + response.create back over the socket.
 *
 * Design: ALL risky parsing/framing logic lives in the pure, unit-tested functions
 * `mapRealtimeEvent` and `buildFunctionOutputFrame` / `buildResponseCreateFrame`. The
 * socket I/O in OpenAiRealtimeBridge is a thin shell — the only part that can't be
 * verified without a live OpenAI key + a real call.
 *
 * ⚠️ Event names follow the OpenAI Realtime API guide; parsing is defensive against
 * shape drift. Verify against a live realtime stream before production (same posture
 * as the webhook payload assumption).
 */
import WebSocket from 'ws'
import { getVoiceConfig } from '../config'
import { loadBusinessBrain } from '../brain'
import { VoiceError } from '../domain'
import { compileGreeting } from '../prompt-compiler'
import type { VoiceStore } from '../store/types'
import { CallSession, type NormalizedEvent, type RealtimeSink } from './session'

export const REALTIME_WS_URL = 'wss://api.openai.com/v1/realtime'

function safeJsonParse(s: unknown): unknown {
  if (typeof s !== 'string') return s ?? {}
  try { return JSON.parse(s) } catch { return {} }
}

/**
 * Map one raw OpenAI realtime server event to zero or more NormalizedEvents.
 * Pure + total (never throws) so it is fully unit-testable with fixtures.
 */
export function mapRealtimeEvent(raw: unknown): NormalizedEvent[] {
  if (!raw || typeof raw !== 'object') return []
  const e = raw as Record<string, unknown>
  const type = String(e.type ?? '')
  const eventId = typeof e.event_id === 'string' ? e.event_id : undefined

  switch (type) {
    case 'session.created':
      return [{ type: 'session.created' }]

    // caller speech finalized
    case 'conversation.item.input_audio_transcription.completed': {
      const text = typeof e.transcript === 'string' ? e.transcript : ''
      return text ? [{ type: 'user_transcript', text, sourceEventId: eventId }] : []
    }

    // assistant spoken audio transcript finalized
    case 'response.audio_transcript.done':
    case 'response.output_audio_transcript.done': {
      const text = typeof e.transcript === 'string' ? e.transcript : ''
      return text ? [{ type: 'assistant_transcript', text, sourceEventId: eventId }] : []
    }

    // assistant text (non-audio) finalized
    case 'response.text.done': {
      const text = typeof e.text === 'string' ? e.text : ''
      return text ? [{ type: 'assistant_transcript', text, sourceEventId: eventId }] : []
    }

    // function calls are read from the completed response's output items (spec §8.5)
    case 'response.done': {
      const response = (e.response ?? {}) as Record<string, unknown>
      const output = Array.isArray(response.output) ? response.output : []
      const calls: NormalizedEvent[] = []
      for (const item of output) {
        const it = item as Record<string, unknown>
        if (it.type === 'function_call') {
          calls.push({
            type: 'function_call',
            name: String(it.name ?? ''),
            arguments: safeJsonParse(it.arguments),
            callId: String(it.call_id ?? it.id ?? ''),
          })
        }
      }
      return calls
    }

    case 'rate_limits.updated':
      return [{ type: 'rate_limits', data: e as Record<string, unknown> }]

    case 'error': {
      const err = (e.error ?? {}) as Record<string, unknown>
      return [{ type: 'error', message: String(err.message ?? e.message ?? 'realtime error') }]
    }

    default:
      return []
  }
}

/** Client→server frame: return a tool result to the model. */
export function buildFunctionOutputFrame(toolCallId: string, outputJson: string): Record<string, unknown> {
  return {
    type: 'conversation.item.create',
    item: { type: 'function_call_output', call_id: toolCallId, output: outputJson },
  }
}

/** Client→server frame: ask the model to produce the next response. */
export function buildResponseCreateFrame(instructions?: string): Record<string, unknown> {
  return instructions
    ? { type: 'response.create', response: { instructions } }
    : { type: 'response.create' }
}

/** Instruction that forces the opening line to disclose AI identity (板桥 #1). */
export function greetingInstruction(greeting: string): string {
  return `Open the call now in your own natural voice. You MUST say, verbatim, this exact sentence first: "${greeting}"`
}

export class OpenAiRealtimeBridge implements RealtimeSink {
  private ws: WebSocket | null = null
  private session: CallSession | null = null
  private firstResponse = true
  private closed = false

  constructor(
    private readonly openaiCallId: string,
    private readonly apiKey: string,
    private readonly greeting: string,
  ) {}

  attach(session: CallSession): void { this.session = session }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${REALTIME_WS_URL}?call_id=${encodeURIComponent(this.openaiCallId)}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      })
      this.ws = ws
      ws.on('open', () => resolve())
      ws.on('message', (data) => { void this.onMessage(data.toString()) })
      ws.on('close', () => { void this.onClose('completed') })
      ws.on('error', (err) => {
        if (this.ws?.readyState === WebSocket.CONNECTING) reject(new VoiceError('REALTIME_SOCKET_FAILED', String(err)))
        void this.session?.ingest({ type: 'error', message: String(err) })
      })
    })
  }

  private async onMessage(text: string): Promise<void> {
    let raw: unknown
    try { raw = JSON.parse(text) } catch { return }
    for (const ev of mapRealtimeEvent(raw)) {
      await this.session?.ingest(ev)
    }
  }

  private async onClose(reason: string): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.session?.ingest({ type: 'call.ended', reason })
  }

  // ── RealtimeSink ──
  async sendFunctionOutput(toolCallId: string, outputJson: string): Promise<void> {
    this.send(buildFunctionOutputFrame(toolCallId, outputJson))
  }
  async requestResponse(): Promise<void> {
    if (this.firstResponse && this.greeting) {
      this.firstResponse = false
      this.send(buildResponseCreateFrame(greetingInstruction(this.greeting)))
    } else {
      this.send(buildResponseCreateFrame())
    }
  }

  private send(obj: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj))
  }

  close(): void { this.ws?.close() }
}

/**
 * Start a real realtime session for an accepted call: load tenant/agent/brain,
 * open the control socket with the bridge as sink, and speak the greeting.
 * Returns the bridge so the worker can hold/close it.
 */
export async function startRealtimeSession(store: VoiceStore, callId: string): Promise<OpenAiRealtimeBridge> {
  const cfg = getVoiceConfig()
  if (!cfg.env.OPENAI_API_KEY) throw new VoiceError('PROVIDER_UNAVAILABLE', 'OPENAI_API_KEY not set')

  const call = await store.getCallById(callId)
  if (!call?.openai_call_id) throw new VoiceError('CALL_ALREADY_ENDED', `call ${callId} missing openai_call_id`)
  const tenant = await store.getTenantById(call.tenant_id)
  const agent = await store.getAgentById(call.agent_id)
  if (!tenant || !agent) throw new VoiceError('ROUTE_NOT_FOUND', 'tenant/agent missing for call')
  const brain = await loadBusinessBrain(tenant)
  const greeting = compileGreeting(agent, brain)

  const { getRealtimeProvider } = await import('../providers')
  const bridge = new OpenAiRealtimeBridge(call.openai_call_id, cfg.env.OPENAI_API_KEY, greeting)
  const session = new CallSession({ store, provider: getRealtimeProvider(), sink: bridge, call, tenant, agent, brain })
  bridge.attach(session)
  await bridge.connect()
  await session.start()
  return bridge
}
