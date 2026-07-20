/**
 * Mock closed-loop runner — drives a full call (inbound or outbound) end to end with
 * no external services. Used by scripts/voice/simulate-openai-call.ts and the tests.
 */
import { randomUUID } from 'crypto'
import { getVoiceConfig } from '../config'
import { handleOpenAiWebhook } from '../webhook/openai-handler'
import { signWebhook } from '../providers/webhook-sign'
import type { RealtimeProvider } from '../providers'
import type { VoiceStore } from '../store/types'
import { buildSession, placeOutboundCall } from './worker'
import { RecordingSink, type NormalizedEvent } from './session'

export function buildIncomingWebhook(opts: {
  calledNumber: string
  callerNumber?: string
  openaiCallId?: string
  eventId?: string
}): { rawBody: string; headers: Record<string, string | undefined> } {
  const openaiCallId = opts.openaiCallId ?? `rtc_${randomUUID()}`
  const eventId = opts.eventId ?? `evt_${randomUUID()}`
  const payload = {
    id: eventId,
    type: 'realtime.call.incoming',
    data: {
      call_id: openaiCallId,
      sip_headers: [
        { name: 'From', value: `<sip:${opts.callerNumber ?? '+6421000000'}@sip.example>` },
        { name: 'To', value: `<sip:${opts.calledNumber}@sip.example>` },
        { name: 'Call-ID', value: randomUUID() },
      ],
    },
  }
  const rawBody = JSON.stringify(payload)
  const cfg = getVoiceConfig()
  const headers: Record<string, string | undefined> = { 'content-type': 'application/json' }
  if (cfg.env.OPENAI_WEBHOOK_SECRET) {
    Object.assign(headers, signWebhook(rawBody, cfg.env.OPENAI_WEBHOOK_SECRET, eventId, Math.floor(Date.now() / 1000)))
  } else {
    headers['webhook-id'] = eventId
  }
  return { rawBody, headers }
}

export interface SimulateResult {
  callId: string
  webhookStatus: number
  sink: RecordingSink
}

/** Simulate a full inbound call: webhook → accept → session → scripted events → finalize. */
export async function simulateInboundCall(opts: {
  store: VoiceStore
  provider: RealtimeProvider
  calledNumber: string
  callerNumber?: string
  script: NormalizedEvent[]
  eventId?: string
}): Promise<SimulateResult> {
  const { rawBody, headers } = buildIncomingWebhook({
    calledNumber: opts.calledNumber, callerNumber: opts.callerNumber, eventId: opts.eventId,
  })
  const res = await handleOpenAiWebhook(rawBody, headers, { store: opts.store, provider: opts.provider })
  if (!res.callId) return { callId: '', webhookStatus: res.httpStatus, sink: new RecordingSink() }

  const sink = new RecordingSink()
  const session = await buildSession(opts.store, opts.provider, res.callId, sink)
  await session.start()
  for (const ev of opts.script) await session.ingest(ev)
  return { callId: res.callId, webhookStatus: res.httpStatus, sink }
}

/** Simulate a full outbound call: gate → originate → session → scripted events → finalize. */
export async function simulateOutboundCall(opts: {
  store: VoiceStore
  provider: RealtimeProvider
  tenantId: string
  agentId: string
  toNumber: string
  script: NormalizedEvent[]
}): Promise<SimulateResult> {
  const { callId } = await placeOutboundCall(opts.store, opts.provider, {
    tenantId: opts.tenantId, agentId: opts.agentId, toNumber: opts.toNumber,
  })
  const sink = new RecordingSink()
  const session = await buildSession(opts.store, opts.provider, callId, sink)
  await session.start()
  for (const ev of opts.script) await session.ingest(ev)
  return { callId, webhookStatus: 200, sink }
}
