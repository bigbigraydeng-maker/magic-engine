import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, currencyRuleFor } from '../brief'

describe('brief currency rule', () => {
  it('NZ business: amounts default to NZD, never USD', () => {
    const p = buildSystemPrompt({ name: 'Acme', industry: null, country: 'NZ' }, [])
    expect(p).toContain('NZD')
    expect(p).toMatch(/NEVER write "美元"/)
  })
  it('AU business uses AUD; unknown country states no rule', () => {
    expect(currencyRuleFor('au')).toContain('AUD')
    expect(currencyRuleFor(null)).toBe('')
    expect(currencyRuleFor('FR')).toBe('')
    expect(buildSystemPrompt({ name: 'Acme', industry: null }, [])).not.toContain('CURRENCY')
  })
})
