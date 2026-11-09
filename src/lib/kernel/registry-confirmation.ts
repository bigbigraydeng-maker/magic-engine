/**
 * P0 confirmation hold — a kernel action that only waits for a human click.
 *
 * Knives 11 and 12 attach real work later. This action's capability refuses
 * to run, so approving it cannot spend, publish, or write Meta.
 */

import type { ActionDefinition } from './types'

export const CONFIRMATION_ACTION_KEY = 'governance.p0_confirmation' as const

export const CONFIRMATION_HOLD_DEFINITION: ActionDefinition<typeof CONFIRMATION_ACTION_KEY> = {
  actionKey: CONFIRMATION_ACTION_KEY,
  version: 1,
  title: '记下有没有点过确认（不花钱、不发布、不改广告）',
  inputSchema: {
    type: 'object',
    required: [
      'subject_key',
      'content_fingerprint',
      'what',
      'account_label',
      'amount_label',
      'date_label',
      'scope_label',
      'issued_at',
      'hard_checks',
    ],
    properties: {
      subject_key: { type: 'string' },
      content_fingerprint: { type: 'string' },
      what: { type: 'string' },
      account_label: { type: 'string' },
      amount_label: { type: 'string' },
      date_label: { type: 'string' },
      scope_label: { type: 'string' },
      issued_at: { type: 'string' },
      hard_checks: { type: 'string' },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    required: ['executed'],
    properties: { executed: { type: 'boolean' } },
    additionalProperties: false,
  },
  capability: CONFIRMATION_ACTION_KEY,
  risk: 'low',
  sideEffect: 'none',
  reversible: true,
  outwardAuthorization: null,
  idempotency: { keyFields: ['subject_key', 'content_fingerprint'], scope: 'client' },
  costModel: { kind: 'fixed', estimate: () => 0 },
  providerIdempotency: 'not_applicable',
  retryPolicy: { maxAttempts: 1, backoff: 'fixed', baseMs: 0 },
  verification: null,
  requiredCapabilityTier: 'admin',
  steps: ['hold'],
  allowedPurposes: ['housekeeping'],
}
