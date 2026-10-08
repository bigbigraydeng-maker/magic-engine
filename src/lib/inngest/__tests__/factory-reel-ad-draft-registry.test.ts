import { describe, it, expect } from 'vitest'
import { cloudFunctions } from '../functions'
import { CLOUD_FN_PREFIX, WORKER_OWNED_EVENTS } from '../client'
import { FACTORY_REEL_AD_DRAFT_FN_ID, factoryReelAdDraft } from '../functions/factory-reel-ad-draft'
import { FACTORY_REEL_PUBLISHED_EVENT } from '@/lib/factory/publish/reel-published-event'

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
