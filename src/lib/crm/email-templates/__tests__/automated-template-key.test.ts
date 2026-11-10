import { describe, expect, it } from 'vitest'
import { AUTOMATED_TEMPLATE_KEY_PREFIX, isAutomatedTemplateKey } from '../automated-template-key'
import { TEMPLATE_KEY_RE } from '../template-store'

describe('isAutomatedTemplateKey', () => {
  it('the welcome letter and the countdown letters are automated', () => {
    expect(isAutomatedTemplateKey('auto-welcome')).toBe(true)
    expect(isAutomatedTemplateKey('auto-countdown-20270106-cn15-2')).toBe(true)
  })

  it('ignores case and surrounding spaces, because a request key comes from the browser', () => {
    expect(isAutomatedTemplateKey('AUTO-Welcome')).toBe(true)
    expect(isAutomatedTemplateKey('  auto-welcome ')).toBe(true)
  })

  it('staff templates are not, even when "auto" appears inside the key', () => {
    for (const key of ['post-call-single-tour', 'autumn-tours', 'post-call-auto-reply', 'catalogue-send', '', null, undefined])
      expect(isAutomatedTemplateKey(key)).toBe(false)
  })

  it('the prefix itself is a legal start of a template key', () => {
    expect(TEMPLATE_KEY_RE.test(`${AUTOMATED_TEMPLATE_KEY_PREFIX}welcome`)).toBe(true)
  })
})
