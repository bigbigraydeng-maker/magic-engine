import { describe, it, expect } from 'vitest'
import { cloudFunctions } from '../functions'
import { CLOUD_FN_PREFIX, WORKER_OWNED_EVENTS } from '../client'
import {
  FACTORY_REEL_AD_DRAFT_FN_ID,
  factoryReelAdDraft,
  throwIfSilentFailure,
} from '../functions/factory-reel-ad-draft'
import { FACTORY_REEL_PUBLISHED_EVENT } from '@/lib/factory/publish/reel-published-event'
import type { RunOutcome } from '@/lib/ads-strategy/factory-reel-draft/run'

describe('factory reel ad draft registration', () => {
  it('the auto-draft function is registered in cloudFunctions with the cloud- prefix', () => {
    expect(cloudFunctions).toContain(factoryReelAdDraft)
    expect(factoryReelAdDraft.id()).toBe(FACTORY_REEL_AD_DRAFT_FN_ID)
    expect(FACTORY_REEL_AD_DRAFT_FN_ID.startsWith(CLOUD_FN_PREFIX)).toBe(true)
  })

  it('its id is unique among all registered functions', () => {
    const ids = cloudFunctions.map((f) => f.id())
    const matches = ids.filter((id) => id === FACTORY_REEL_AD_DRAFT_FN_ID)
    expect(matches).toHaveLength(1)
  })

  it('it listens to the Reel-published event and that event is not owned by the local worker', () => {
    expect((WORKER_OWNED_EVENTS as readonly string[]).includes(FACTORY_REEL_PUBLISHED_EVENT)).toBe(false)
  })
})

describe('throwIfSilentFailure', () => {
  it('throws when failed before the intent row was claimed', () => {
    const outcome: RunOutcome = { status: 'failed', intentActionId: null, blockCode: 'db_error' }
    expect(() => throwIfSilentFailure(outcome)).toThrow(/db_error/)
  })

  it('does not throw when failed but the intent row was claimed', () => {
    const outcome: RunOutcome = { status: 'failed', intentActionId: 'row-1' }
    expect(() => throwIfSilentFailure(outcome)).not.toThrow()
  })

  it('does not throw for non-failed statuses regardless of intentActionId', () => {
    const statuses = [
      'blocked',
      'duplicate',
      'skipped_off',
      'invalid_event',
      'dry_run_ok',
      'drafted',
      'draft_blocked',
    ] as const
    for (const status of statuses) {
      expect(() => throwIfSilentFailure({ status, intentActionId: null })).not.toThrow()
      expect(() => throwIfSilentFailure({ status, intentActionId: 'row-1' })).not.toThrow()
    }
  })
})
