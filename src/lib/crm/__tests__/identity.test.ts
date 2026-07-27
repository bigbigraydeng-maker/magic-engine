/**
 * 电话/邮箱规范化 —— 四个渠道能不能合成一个人，全看这里。
 *
 * 用例全部取自 CTS 真实数据（Meta 即时表单导出、官网表单邮件、手工 CRM），
 * 不是编的格式。
 */

import { describe, expect, it } from 'vitest'
import { normalisePhone, normaliseEmail, buildIdentities } from '../identity'

describe('normalisePhone', () => {
  it('剥掉 Meta 导出的 p: 前缀', () => {
    // Sheet1 里 347 个电话全是这个格式
    expect(normalisePhone('p:+6421363598')).toBe('+6421363598')
  })

  it('已经是 E.164 的原样保留 —— 官网表单就是这样给的', () => {
    expect(normalisePhone('+64225478028')).toBe('+64225478028')
  })

  it('人手打的本地号码补上国码，这样才和外呼对得上', () => {
    expect(normalisePhone('021 363 598')).toBe('+6421363598')
    expect(normalisePhone('021-363-598')).toBe('+6421363598')
  })

  it('00 开头的国际前缀换成 +', () => {
    expect(normalisePhone('006421363598')).toBe('+6421363598')
  })

  it('澳洲客户按 AU 补国码', () => {
    expect(normalisePhone('0412 345 678', 'AU')).toBe('+61412345678')
  })

  it('认不出来的返回 null —— 存错号码将来会打给陌生人', () => {
    expect(normalisePhone('12345')).toBeNull()
    expect(normalisePhone('n/a')).toBeNull()
    expect(normalisePhone('')).toBeNull()
    expect(normalisePhone(null)).toBeNull()
  })

  it('超出 E.164 长度上限的丢掉', () => {
    expect(normalisePhone('+6421363598123456789')).toBeNull()
  })

  it('同一个人的两种写法要归一到同一个值', () => {
    // 这条是整套合并的地基：Sheet 写本地格式、外呼写国际格式，必须相等
    expect(normalisePhone('021 363 598')).toBe(normalisePhone('p:+6421363598'))
  })
})

describe('normaliseEmail', () => {
  it('去空格转小写', () => {
    expect(normaliseEmail('  Dave.Attwell@Outlook.com ')).toBe('dave.attwell@outlook.com')
  })

  it('大小写不同的同一个邮箱要相等', () => {
    expect(normaliseEmail('KAM@x.co.nz')).toBe(normaliseEmail('kam@x.co.nz'))
  })

  it('不是邮箱的返回 null', () => {
    expect(normaliseEmail('not an email')).toBeNull()
    expect(normaliseEmail('a@b')).toBeNull()
    expect(normaliseEmail(null)).toBeNull()
  })
})

describe('buildIdentities', () => {
  it('电话和邮箱都留下，用于跨渠道合并', () => {
    expect(
      buildIdentities({ phone: 'p:+6421363598', email: 'Dave@Outlook.com' }),
    ).toEqual([
      { kind: 'phone', value: '+6421363598' },
      { kind: 'email', value: 'dave@outlook.com' },
    ])
  })

  it('脏号码被丢掉，但邮箱仍然能合并 —— 不能因为一个坏字段丢掉整个人', () => {
    expect(buildIdentities({ phone: 'invalid', email: 'kam@x.co.nz' })).toEqual([
      { kind: 'email', value: 'kam@x.co.nz' },
    ])
  })

  it('只有 Facebook 身份的人照样成立，只是合并不到别的渠道', () => {
    expect(buildIdentities({ fbPsid: '123456' })).toEqual([
      { kind: 'fb_psid', value: '123456' },
    ])
  })

  it('什么都认不出来时返回空数组，由调用方决定怎么办', () => {
    expect(buildIdentities({ phone: 'x', email: 'y' })).toEqual([])
  })
})
