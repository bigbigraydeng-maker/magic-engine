import { afterEach, describe, expect, it, vi } from 'vitest'
import { INSTAGRAM_PUBLISH_SCOPES, INSTAGRAM_SCOPES, isInstagramPublishEnabled, requiredInstagramScopes } from '../identity'

afterEach(() => vi.unstubAllEnvs())

describe('Instagram publish switch and scope sets', () => {
  it('read-only scopes stay exactly basic; publish adds only content_publish', () => {
    expect([...INSTAGRAM_SCOPES]).toEqual(['instagram_business_basic'])
    expect([...INSTAGRAM_PUBLISH_SCOPES]).toEqual(['instagram_business_basic', 'instagram_business_content_publish'])
  })
  it.each([undefined, '', 'false', 'TRUE', '1', ' true'])('is OFF unless the value is exactly "true" (%s)', value => {
    if (value !== undefined) vi.stubEnv('INSTAGRAM_PUBLISH_ENABLED', value)
    expect(isInstagramPublishEnabled()).toBe(false)
    expect([...requiredInstagramScopes()]).toEqual(['instagram_business_basic'])
  })
  it('is ON only for "true", and then requires the publish scope set', () => {
    vi.stubEnv('INSTAGRAM_PUBLISH_ENABLED', 'true')
    expect(isInstagramPublishEnabled()).toBe(true)
    expect([...requiredInstagramScopes()]).toEqual([...INSTAGRAM_PUBLISH_SCOPES])
  })
})
