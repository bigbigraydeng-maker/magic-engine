/**
 * CallSession — provider-agnostic realtime call processor (spec §8.4/§8.5).
 *
 * Fed a stream of NORMALIZED events (a thin worker adapter maps raw OpenAI realtime
 * events → these; the simulate script feeds them directly). Responsibilities:
 *  - greeting, transcript persistence, function-call execution via Tool Router,
 *    function_call_output + response.create, transfer/hangup control, finalize trigger.
 */
import { assertTransition, type CallDirection, type Speaker } from '../domain'
import { loadBusinessBrain, type BusinessBrain } from '../brain'
import { compileGreeting } from '../prompt-compiler'
import { getToolRegistry } from '../tools'
import type { ToolExecutionContext } from '../tools/registry'
import type { RealtimeProvider } from '../providers'
import type { VoiceStore, AgentRow, TenantRow, CallRow } from '../store/types'
import { finalizeCall } from '../finalize'

// ── Normalized events ────────────────────────────────────────────────────────
export type NormalizedEvent =
  | { type: 'session.created' }
  | { type: 'user_transcript'; text: string; startedAtMs?: number; sourceEventId?: string }
  | { type: 'assistant_transcript'; text: string; sourceEventId?: string }
  | { type: 'function_call'; name: string; arguments: unknown; callId: string }
  | { type: 'rate_limits'; data?: Record<string, unknown> }
  | { type: 'error'; message: string }
  | { type: 'call.ended'; reason?: string }

/** Outbound sink — sends frames back to the model (real ws) or records them (mock). */
export interface RealtimeSink {
  sendFunctionOutput(toolCallId: string, outputJson: string): Promise<void>
  requestResponse(): Promise<void>
}

export class RecordingSink implements RealtimeSink {
  readonly functionOutputs: { toolCallId: string; outputJson: string }[] = []
  responseRequests = 0
  async sendFunctionOutput(toolCallId: string, outputJson: string) { this.functionOutputs.push({ toolCallId, outputJson }) }
  async requestResponse() { this.responseRequests += 1 }
}

export interface CallSessionInit {
  store: VoiceStore
  provider: RealtimeProvider
  sink: RealtimeSink
  call: CallRow
  tenant: TenantRow
  agent: AgentRow
  brain?: BusinessBrain
  requestId?: string
}

export class CallSession {
  private store: VoiceStore
  private provider: RealtimeProvider
  private sink: RealtimeSink
  private call: CallRow
  private tenant: TenantRow
  private agent: AgentRow
  private brain!: BusinessBrain
  private requestId?: string

  private seq = 0
  private leadId: string | null = null
  private contactId: string | null = null
  private ended = false
  private status: CallRow['status']

  constructor(init: CallSessionInit) {
    this.store = init.store
    this.provider = init.provider
    this.sink = init.sink
    this.call = init.call
    this.tenant = init.tenant
    this.agent = init.agent
    if (init.brain) this.brain = init.brain
    this.requestId = init.requestId
    this.leadId = init.call.lead_id
    this.contactId = init.call.contact_id
    this.status = init.call.status
  }

  private async setStatus(next: CallRow['status'], patch: Partial<CallRow> = {}): Promise<void> {
    assertTransition(this.status, next)
    this.status = next
    this.call = await this.store.updateCall(this.call.id, { status: next, ...patch })
  }

  private toolContext(): ToolExecutionContext {
    return {
      store: this.store, tenant: this.tenant, agent: this.agent, brain: this.brain,
      tenantId: this.tenant.id, clientId: this.tenant.client_id, agentId: this.agent.id,
      callId: this.call.id, contactId: this.contactId, leadId: this.leadId,
      locale: this.tenant.default_language, timezone: this.tenant.default_timezone,
      requestId: this.requestId,
    }
  }

  private async appendTranscript(speaker: Speaker, text: string, startedAtMs?: number, sourceEventId?: string): Promise<void> {
    if (!text?.trim()) return
    this.seq += 1
    await this.store.appendTranscript({
      tenant_id: this.tenant.id, call_id: this.call.id, sequence_no: this.seq, speaker, text,
      started_at_ms: startedAtMs ?? null, ended_at_ms: null, source_event_id: sourceEventId ?? null,
      is_final: true, metadata: {},
    })
  }

  /** Send the greeting and move the call into in_progress (spec §8.4). */
  async start(): Promise<void> {
    if (!this.brain) this.brain = await loadBusinessBrain(this.tenant)
    if (this.status === 'accepted') await this.setStatus('in_progress')
    const greeting = compileGreeting(this.agent, this.brain)
    await this.appendTranscript('assistant', greeting)
    await this.sink.requestResponse() // real: triggers the model to speak the greeting
  }

  async ingest(event: NormalizedEvent): Promise<void> {
    if (this.ended && event.type !== 'call.ended') return
    switch (event.type) {
      case 'session.created':
        return
      case 'user_transcript':
        await this.appendTranscript('user', event.text, event.startedAtMs, event.sourceEventId)
        return
      case 'assistant_transcript':
        await this.appendTranscript('assistant', event.text, undefined, event.sourceEventId)
        return
      case 'function_call':
        await this.handleFunctionCall(event.name, event.arguments, event.callId)
        return
      case 'rate_limits':
        return
      case 'error':
        await this.store.audit({
          tenant_id: this.tenant.id, actor_type: 'system', operation: 'realtime.error',
          resource_type: 'call', resource_id: this.call.id, changes: { message: event.message }, call_id: this.call.id,
        })
        return
      case 'call.ended':
        await this.end(event.reason ?? 'completed')
        return
    }
  }

  private async handleFunctionCall(name: string, args: unknown, toolCallId: string): Promise<void> {
    const registry = getToolRegistry()
    const result = await registry.run(this.toolContext(), name, args, toolCallId)

    // capture lead id so subsequent tool ctx carries it
    const leadId = (result.output as { lead_id?: string }).lead_id
    if (leadId) this.leadId = leadId

    await this.sink.sendFunctionOutput(toolCallId, JSON.stringify(result.output))

    if (result.control?.action === 'transfer') {
      await this.setStatus('transferring')
      try {
        await this.provider.refer(this.call.openai_call_id ?? this.call.id, result.control.targetUri!)
        await this.appendTranscript('system', `Transferred to human (${result.control.reason ?? 'requested'}).`)
        await this.setStatus('transferred')
        await this.end('transferred')
      } catch (err) {
        await this.store.updateCall(this.call.id, { error_code: 'TRANSFER_FAILED', error_message: (err as Error).message })
        await this.sink.requestResponse()
      }
      return
    }

    if (result.control?.action === 'hangup') {
      await this.provider.hangup(this.call.openai_call_id ?? this.call.id).catch(() => {})
      await this.end('completed')
      return
    }

    // normal tool → let the model continue
    await this.sink.requestResponse()
  }

  /** Finalize the call: status, duration, then summary/lead via finalizeCall. */
  async end(reason: string): Promise<void> {
    if (this.ended) return
    this.ended = true
    const endedAt = new Date()
    const startedAt = this.call.started_at ? new Date(this.call.started_at) : endedAt
    const durationSec = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000))

    if (this.status !== 'completed' && this.status !== 'transferred' && this.status !== 'failed') {
      await this.setStatus('completed', {})
    }
    await this.store.updateCall(this.call.id, {
      ended_at: endedAt.toISOString(), duration_seconds: durationSec,
      transcript_status: 'final', disposition: reason,
    })
    await finalizeCall(this.store, this.call.id, { requestId: this.requestId })
  }
}
