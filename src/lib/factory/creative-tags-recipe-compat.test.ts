// New brief keys (platform / creative_tags) must not disturb the existing recipe gate,
// and a legacy brief (no platform) must keep passing it: only NEW orders are stamped.
import { describe, expect, it } from 'vitest'
import { assertRecipeBriefComplete, buildFullRecipeBrief, resolveRecipe } from './recipe'
import { readBriefPlatform, stampPlatformAndTags } from './creative-tags'

const RECIPE = resolveRecipe('single_image_i2v_pullback_12s')!

function recipeBrief() {
  return buildFullRecipeBrief({
    recipe: RECIPE,
    angle: 'brand story',
    sourceImageUrl: 'https://cdn.example.com/hero.jpg',
    creativeProfile: { look: 'golden_hour' },
    copy: { hook: 'Small group', cta: 'Book now' },
    keyNamespace: 'sig_compat',
  })
}

describe('recipe gate vs new brief keys', () => {
  it('legacy brief without platform still passes assertRecipeBriefComplete and reads as unknown', () => {
    const brief = recipeBrief()
    expect(() => assertRecipeBriefComplete(brief, RECIPE)).not.toThrow()
    expect(readBriefPlatform(brief)).toBe('unknown')
  })

  it('a stamped brief (platform + creative_tags) passes the same gate unchanged', () => {
    const stamped = stampPlatformAndTags(recipeBrief(), {
      platform: 'facebook',
      creative_tags: { opening_type: 'question', topic_source: 'evergreen' },
    })
    expect(stamped.ok).toBe(true)
    if (!stamped.ok) return
    expect(() => assertRecipeBriefComplete(stamped.brief, RECIPE)).not.toThrow()
    expect(readBriefPlatform(stamped.brief)).toBe('facebook')
  })

  it('stamping after the gate keeps every recipe key (spread does not drop fields)', () => {
    const brief = recipeBrief()
    const stamped = stampPlatformAndTags(brief, { platform: 'tiktok' })
    expect(stamped.ok).toBe(true)
    if (!stamped.ok) return
    for (const key of Object.keys(brief)) {
      expect(stamped.brief).toHaveProperty(key)
    }
  })
})
