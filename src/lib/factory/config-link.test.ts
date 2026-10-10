import { describe, expect, it } from 'vitest'
import { FACTORY_CONFIG_SECTION, factoryConfigHref } from './config-link'

describe('FACTORY_CONFIG_SECTION', () => {
  it('equals factory-config', () => {
    expect(FACTORY_CONFIG_SECTION).toBe('factory-config')
  })
})

describe('factoryConfigHref', () => {
  it('returns the exact href for a normal uuid', () => {
    const clientId = '123e4567-e89b-12d3-a456-426614174000'
    expect(factoryConfigHref(clientId)).toBe(
      '/dashboard/clients/123e4567-e89b-12d3-a456-426614174000/settings?tab=content&section=factory-config'
    )
  })

  it('encodes unusual characters in the id', () => {
    const clientId = 'a b/c?d&e=f#g'
    expect(factoryConfigHref(clientId)).toBe(
      '/dashboard/clients/a%20b%2Fc%3Fd%26e%3Df%23g/settings?tab=content&section=factory-config'
    )
  })

  it('always contains tab=content and section=factory-config', () => {
    const href = factoryConfigHref('some-client-id')
    expect(href).toContain('tab=content')
    expect(href).toContain('section=factory-config')
  })
})
