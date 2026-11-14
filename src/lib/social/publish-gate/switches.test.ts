import { describe, expect, it } from 'vitest'
import { publishLiveEnabled } from './switches'

describe('publishLiveEnabled', () => {
  it('is off unless the kind is exactly boolean true', () => {
    expect(publishLiveEnabled(undefined, 'story_register')).toBe(false)
    expect(publishLiveEnabled({}, 'image_post')).toBe(false)
    expect(publishLiveEnabled({ publish_live: { reel_public: 'true' } }, 'reel_public')).toBe(false)
    expect(publishLiveEnabled({ publish_live: { reel_public: 1 } }, 'reel_public')).toBe(false)
    expect(publishLiveEnabled({ publish_live: { image_post: false } }, 'image_post')).toBe(false)
    expect(publishLiveEnabled({ publish_live: { story_register: true } }, 'image_post')).toBe(false)
  })

  it('is on only for the kind that is boolean true', () => {
    const config = { publish_live: { story_register: true, image_post: true, reel_public: true } }
    expect(publishLiveEnabled(config, 'story_register')).toBe(true)
    expect(publishLiveEnabled(config, 'image_post')).toBe(true)
    expect(publishLiveEnabled(config, 'reel_public')).toBe(true)
  })
})
