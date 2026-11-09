import type { StoryAttemptStatus, StoryItemSpec, StoryReceipt } from './types'

/**
 * Statuses that mean a provider actually accepted a story for publication.
 * Only these two may carry a provider receipt and report provider impact.
 */
const PUBLISHED_STATUSES: ReadonlySet<StoryAttemptStatus> = new Set([
  'PUBLISHED_UNVERIFIED',
  'PUBLISHED',
])

const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/

/**
 * Provider impact implied by an attempt status. A story is only considered
 * published for the two published statuses; everything else has no impact.
 */
export function providerImpactFor(status: StoryAttemptStatus): 'NONE' | 'STORY_PUBLISHED' {
  return PUBLISHED_STATUSES.has(status) ? 'STORY_PUBLISHED' : 'NONE'
}

function requireNonEmpty(value: string, field: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new Error(`buildStoryReceipt: ${field} must be a non-empty string`)
  }
  return trimmed
}

/**
 * Build a machine-readable receipt for one attempt. The receipt must never
 * lie: a provider receipt is only recorded for a published status, and no
 * other status may carry one.
 */
export function buildStoryReceipt(input: {
  requestId: string
  item: Pick<StoryItemSpec, 'client_id' | 'pack_id' | 'item_id' | 'channel'>
  status: StoryAttemptStatus
  reasonCode: string | null
  providerReceipt: string | null
  authorizationId: string | null
  authorizationState: string
  contentHash: string
  mode: 'DRY_RUN' | 'LIVE'
  now: Date
}): StoryReceipt {
  const requestId = requireNonEmpty(input.requestId, 'requestId')
  const clientId = requireNonEmpty(input.item.client_id, 'item.client_id')
  const packId = requireNonEmpty(input.item.pack_id, 'item.pack_id')
  const itemId = requireNonEmpty(input.item.item_id, 'item.item_id')

  if (!CONTENT_HASH_PATTERN.test(input.contentHash)) {
    throw new Error(
      'buildStoryReceipt: contentHash must be 64 lowercase hex characters',
    )
  }

  const isPublished = PUBLISHED_STATUSES.has(input.status)
  const trimmedProviderReceipt =
    input.providerReceipt === null ? null : input.providerReceipt.trim()

  if (isPublished) {
    if (trimmedProviderReceipt === null || trimmedProviderReceipt.length === 0) {
      throw new Error(
        `buildStoryReceipt: status ${input.status} requires a non-empty providerReceipt`,
      )
    }
  } else if (input.providerReceipt !== null) {
    throw new Error(
      `buildStoryReceipt: status ${input.status} must not carry a providerReceipt`,
    )
  }

  if (isPublished) {
    // A published story must be traceable to a live authorisation.
    if (input.authorizationState !== 'ACTIVE' || !input.authorizationId || input.authorizationId.trim() === '') {
      throw new Error(`buildStoryReceipt: status ${input.status} requires an ACTIVE authorization with an id`)
    }
  }

  if (input.status === 'DRY_RUN' && input.mode !== 'DRY_RUN') {
    throw new Error('buildStoryReceipt: status DRY_RUN requires mode DRY_RUN')
  }

  if (input.mode === 'DRY_RUN' && isPublished) {
    throw new Error(
      `buildStoryReceipt: mode DRY_RUN must not have status ${input.status}`,
    )
  }

  return {
    request_id: requestId,
    client_id: clientId,
    pack_id: packId,
    item_id: itemId,
    channel: input.item.channel,
    status: input.status,
    reason_code: input.reasonCode,
    provider_receipt: trimmedProviderReceipt,
    authorization_id: input.authorizationId,
    authorization_state: input.authorizationState,
    content_hash: input.contentHash,
    mode: input.mode,
    provider_impact: providerImpactFor(input.status),
    cost_usd: 0,
    created_at: input.now.toISOString(),
  }
}
