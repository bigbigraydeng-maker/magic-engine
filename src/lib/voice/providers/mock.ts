/**
 * MockRealtimeProvider — simulates OpenAI SIP control plane so the closed loop
 * runs with no external services. Records provider='mock' + is_simulated=true so
 * simulated data never pollutes real attribution (魏征 #5).
 */
import { randomUUID } from 'crypto'
import { getVoiceConfig } from '../config'
import { verifyWebhookSignature } from './webhook-sign'
import type { AcceptCallParams, OriginateParams, RealtimeProvider, WebhookVerifyResult } from './types'

export interface MockProviderLog {
  accepted: AcceptCallParams[]
  rejected: { callId: string; reason: string }[]
  referred: { callId: string; targetUri: string }[]
  hungup: string[]
  originated: OriginateParams[]
}

export class MockRealtimeProvider implements RealtimeProvider {
  readonly name = 'mock'
  readonly simulated = true
  readonly log: MockProviderLog = { accepted: [], rejected: [], referred: [], hungup: [], originated: [] }

  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>): WebhookVerifyResult {
    const cfg = getVoiceConfig()
    let valid = true
    // If a secret + signature headers are present, verify them even in mock mode
    // (lets the simulate script exercise the real verification path).
    if (cfg.env.OPENAI_WEBHOOK_SECRET && headers['webhook-signature']) {
      valid = verifyWebhookSignature(rawBody, headers, cfg.env.OPENAI_WEBHOOK_SECRET, cfg.env.WEBHOOK_REPLAY_WINDOW_SECONDS).valid
    }
    let payload: Record<string, unknown> | null = null
    try { payload = JSON.parse(rawBody) } catch { /* noop */ }
    const eventId =
      (headers['webhook-id'] as string | undefined) ??
      (payload?.id as string | undefined) ??
      null
    return {
      valid,
      eventId,
      eventType: (payload?.type as string | undefined) ?? null,
      payload,
      reason: valid ? undefined : 'mock signature check failed',
    }
  }

  async accept(params: AcceptCallParams): Promise<void> { this.log.accepted.push(params) }
  async reject(callId: string, reason: string): Promise<void> { this.log.rejected.push({ callId, reason }) }
  async refer(callId: string, targetUri: string): Promise<void> { this.log.referred.push({ callId, targetUri }) }
  async hangup(callId: string): Promise<void> { this.log.hungup.push(callId) }
  async originate(params: OriginateParams): Promise<{ openaiCallId: string }> {
    this.log.originated.push(params)
    return { openaiCallId: `mockcall_${randomUUID()}` }
  }
}
