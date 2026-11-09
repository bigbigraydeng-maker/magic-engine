import { describe, expect, it } from 'vitest'
import { LETTER_REASON_TEXT, UNKNOWN_REASON_TEXT, reasonTextFor } from '../reasons'

describe('reasonTextFor', () => {
  it('translates every code in the contract table', () => {
    expect(reasonTextFor('frequency_full')).toBe('他最近 7 天已收 2 封')
    expect(reasonTextFor('dnc')).toBe('他要求别再联系')
    expect(reasonTextFor('mailchimp_suppressed')).toBe('他已在 Mailchimp 退订或邮箱无效')
    expect(reasonTextFor('email_unsubscribed')).toBe('他点过退订')
    expect(reasonTextFor('no_consent_basis')).toBe('查不到他同意收信的依据')
    expect(reasonTextFor('sales_email_exists')).toBe('销售已经给他写过信')
    expect(reasonTextFor('bad_email')).toBe('邮箱地址有问题')
    expect(reasonTextFor('system_address')).toBe('邮箱地址有问题')
    expect(reasonTextFor('not_in_allowlist')).toBe('不在试发名单里')
    expect(reasonTextFor('excluded_tag')).toBe('他带着不发信的标记')
    expect(reasonTextFor('render_failed')).toBe('缺少名字，这封信排不出来')
    expect(reasonTextFor('stale')).toBe('超过 3 天没发出去，已作废')
    expect(reasonTextFor('bounced')).toBe('邮箱退回')
  })

  it('says 系统出错 for anything it does not know, and never shows the raw code', () => {
    for (const code of ['totally_new_code', '', 'constructor', '__proto__', 'toString', null, undefined]) {
      const text = reasonTextFor(code)
      expect(text).toBe(UNKNOWN_REASON_TEXT)
      expect(text).toBe('系统出错')
    }
  })

  it('every shown text is plain Chinese: no underscores, no code-like words', () => {
    for (const text of Object.values(LETTER_REASON_TEXT)) {
      expect(text).toMatch(/[一-鿿]/)
      expect(text).not.toMatch(/_/)
    }
  })
})
