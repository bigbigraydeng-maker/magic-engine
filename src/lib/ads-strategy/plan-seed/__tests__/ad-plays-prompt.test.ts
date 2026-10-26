import { describe, it, expect } from 'vitest'
import { adPlaysPromptSection, adPlaysSchemaExample } from '../ad-plays-prompt'
import { PLAY_KEYS } from '../ad-plays'
import { PLAY_CATALOG } from '../../play-vocabulary'

describe('adPlaysPromptSection', () => {
  it('lists every PLAY_CATALOG key with label, what and successSignal', () => {
    const section = adPlaysPromptSection()
    for (const [key, def] of Object.entries(PLAY_CATALOG)) {
      expect(section).toContain(`\`${key}\``)
      expect(section).toContain(def.label)
      expect(section).toContain(def.what)
      expect(section).toContain(def.successSignal)
    }
  })

  it('tells the model to give structure only, no money/accounts', () => {
    const section = adPlaysPromptSection()
    expect(section).toContain('不要写账户、预算、人数、花费')
    expect(section).toContain('step_key')
    expect(section).toContain('最多 8 条')
    expect(section).toContain('拿不准要不要投广告 → 不填')
    expect(section).toContain('不是空数组')
  })

  it('contains no digits other than the cap of 8 and the phase1 example', () => {
    const section = adPlaysPromptSection()
    const stripped = section.split('8 条').join('').split('phase1').join('')
    expect(stripped).not.toMatch(/\d{2,}/)
    expect(stripped).not.toContain('$')
    expect(stripped).not.toContain('%')
  })
})

describe('adPlaysSchemaExample', () => {
  it('joins play keys from PLAY_KEYS', () => {
    expect(adPlaysSchemaExample()).toBe(
      `"ad_plays": [{ "step_key": "phase1-xxx", "play": "${PLAY_KEYS.join('|')}" }]`,
    )
  })

  it('mentions every PLAY_CATALOG key', () => {
    const example = adPlaysSchemaExample()
    for (const key of Object.keys(PLAY_CATALOG)) {
      expect(example).toContain(key)
    }
  })
})
