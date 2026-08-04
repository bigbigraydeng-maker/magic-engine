import { describe, expect, it } from 'vitest'
import { assertBrandMatches, encodeIdemTag } from './facebook-reel-adapter'

describe('assertBrandMatches(防把 A 客户的片发到 B 客户主页)', () => {
  it('页名包含品牌 → 放行', () => {
    expect(() => assertBrandMatches('MagicLab Academy', 'MagicLab')).not.toThrow()
    expect(() => assertBrandMatches('CTS Tours', 'CTS Tours')).not.toThrow()
  })

  it('忽略 Pty Ltd / 大小写 / 符号', () => {
    expect(() => assertBrandMatches('Oztop Building Supplies Pty Ltd', 'oztop building supplies')).not.toThrow()
  })

  it('页名跟品牌完全对不上 → 拦住,绝不发', () => {
    expect(() => assertBrandMatches('CTS Tours', 'MagicLab')).toThrow(/防误发/)
  })

  it('没配期望品牌 / 页名取不到 → 不拦(这道闸是加分项,不该因为缺配置就发不出去)', () => {
    expect(() => assertBrandMatches('CTS Tours', undefined)).not.toThrow()
    expect(() => assertBrandMatches('', 'MagicLab')).not.toThrow()
  })
})

describe('encodeIdemTag(幂等标记必须不可见)', () => {
  it('只产出零宽字符 —— 混进正文不能被客户看见', () => {
    const tag = encodeIdemTag('9d38d511-3e3e-432d-8106-b5a9086409de')
    expect(tag).toMatch(/^[⁣​‌]+$/)
    expect(tag.trim().length).toBeGreaterThan(0)
  })

  it('同一条片每次编出来一样,不同片不一样', () => {
    const a = encodeIdemTag('9d38d511-3e3e-432d-8106-b5a9086409de')
    expect(encodeIdemTag('9d38d511-3e3e-432d-8106-b5a9086409de')).toBe(a)
    expect(encodeIdemTag('3cc6d68d-13d1-4713-85dc-4fbd0e59c815')).not.toBe(a)
  })
})
