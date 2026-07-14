/**
 * OpenAIRealtimeProvider — real OpenAI SIP control plane over the documented REST
 * endpoints (spec §8.3/§8.6). We call REST directly with fetch rather than guessing
 * the installed SDK's realtime.calls surface (rule #24: 不为匹配说明书绕过 SDK 类型).
 *
 * Endpoints:
 *   POST /v1/realtime/calls/{call_id}/accept
 *   POST /v1/realtime/calls/{call_id}/reject
 *   POST /v1/realtime/calls/{call_id}/refer   { target_uri }
 *   POST /v1/realtime/calls/{call_id}/hangup
 */
import { getVoiceConfig } from '../config'
import { VoiceError } from '../domain'
import { verifyWebhookSignature } from './webhook-sign'
import type { AcceptCallParams, OriginateParams, RealtimeProvider, WebhookVerifyResult } from './types'

const BASE = 'https://api.openai.com/v1/realtime/calls'

export class OpenAIRealtimeProvider implements RealtimeProvider {
  readonly name = 'openai'
  readonly simulated = false

  private get apiKey(): string {
    const key = getVoiceConfig().env.OPENAI_API_KEY
    if (!key) throw new VoiceError('PROVIDER_UNAVAILABLE', 'OPENAI_API_KEY not set')
    return key
  }

  private async post(path: string, body?: unknown): Promise<void> {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new VoiceError('OPENAI_ACCEPT_FAILED', `OpenAI ${path} ${res.status}: ${text.slice(0, 200)}`)
    }
  }

  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>): WebhookVerifyResult {
    const cfg = getVoiceConfig()
    if (!cfg.env.OPENAI_WEBHOOK_SECRET) {
      return { valid: false, eventId: null, eventType: null, payload: null, reason: 'OPENAI_WEBHOOK_SECRET not set' }
    }
    const v = verifyWebhookSignature(
      rawBody, headers, cfg.env.OPENAI_WEBHOOK_SECRET, cfg.env.WEBHOOK_REPLAY_WINDOW_SECONDS,
    )
    let payload: Record<string, unknown> | null = null
    try { payload = JSON.parse(rawBody) } catch { /* noop */ }
    return {
      valid: v.valid,
      eventId: v.id ?? (payload?.id as string | undefined) ?? null,
      eventType: (payload?.type as string | undefined) ?? null,
      payload,
      reason: v.reason,
    }
  }

  async accept(params: AcceptCallParams): Promise<void> {
    // Field shape per spec §8.3; keep aligned with the OpenAI Realtime SIP guide.
    await this.post(`/${params.callId}/accept`, {
      type: 'realtime',
      model: params.model,
      instructions: params.instructions,
      tools: params.tools,
      audio: {
        input: { turn_detection: { type: 'server_vad' } },
        output: params.voice ? { voice: params.voice } : undefined,
      },
      reasoning: { effort: params.reasoningEffort ?? 'low' },
    })
  }
  async reject(callId: string, reason: string): Promise<void> {
    await this.post(`/${callId}/reject`, { reason })
  }
  async refer(callId: string, targetUri: string): Promise<void> {
    await this.post(`/${callId}/refer`, { target_uri: targetUri })
  }
  async hangup(callId: string): Promise<void> {
    await this.post(`/${callId}/hangup`)
  }
  async originate(_params: OriginateParams): Promise<{ openaiCallId: string }> {
    // Outbound origination via SIP provider is a P0-out-of-scope real integration.
    throw new VoiceError('PROVIDER_UNAVAILABLE', 'real outbound originate not enabled in P0 (mock only)')
  }
}
