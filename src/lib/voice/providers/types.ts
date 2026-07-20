/** Realtime telephony provider abstraction (spec §3.1, §13.3). */

export interface AcceptCallParams {
  callId: string
  model: string
  instructions: string
  tools: Record<string, unknown>[]
  voice?: string | null
  reasoningEffort?: string
}

export interface OriginateParams {
  toNumber: string
  fromNumber?: string | null
  sipUri?: string | null
}

export interface WebhookVerifyResult {
  valid: boolean
  eventId: string | null
  eventType: string | null
  payload: Record<string, unknown> | null
  reason?: string
}

export interface RealtimeProvider {
  readonly name: string
  /** true when this provider only simulates (writes provider='mock', is_simulated=true) */
  readonly simulated: boolean
  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>): WebhookVerifyResult
  accept(params: AcceptCallParams): Promise<void>
  reject(callId: string, reason: string): Promise<void>
  refer(callId: string, targetUri: string): Promise<void>
  hangup(callId: string): Promise<void>
  /** Outbound originate — P0: mock only. */
  originate(params: OriginateParams): Promise<{ openaiCallId: string }>
}
