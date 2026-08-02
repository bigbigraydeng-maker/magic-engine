/**
 * 卡片上那个人叫什么。
 *
 * 这里钉的核心是一条**不能破的边界**：拿客人说的话当标题可以，但绝不能让它
 * 看起来像是他的名字 —— 销售照着卡片称呼客人「你好，有没有长城的团先生」，
 * 比显示「未留姓名」糟糕得多。
 */

import { describe, expect, it } from 'vitest'
import { contactCardTitle } from '../display-name'

describe('有名字就用名字', () => {
  it('正常姓名原样显示', () => {
    expect(contactCardTitle('Nikki Smith', '有长城的团吗')).toBe('Nikki Smith')
  })

  it('名字周围的空格不算名字', () => {
    expect(contactCardTitle('   ', '有长城的团吗')).toBe('问：有长城的团吗')
  })
})

describe('没名字时用他说的第一句话', () => {
  it('短句直接用', () => {
    expect(contactCardTitle(null, '有长城的团吗')).toBe('问：有长城的团吗')
  })

  /** 这条是整份测试的重点：标记不能少，少了就是在拿一句话冒充人名。 */
  it('永远带「问：」标记 —— 一眼看出这是他说的话，不是他的姓名', () => {
    expect(contactCardTitle(null, '想带父母去日本')).toMatch(/^问：/)
  })

  it('长句截断，并留一个省略号说明还有下文', () => {
    const t = contactCardTitle(null, '你好我想问一下十一月份去中国的团还有没有位置我们一家四口')
    expect(t.startsWith('问：')).toBe(true)
    expect(t.endsWith('…')).toBe(true)
    // 一列只有 260px，标题必须一行放得下
    expect(t.length).toBeLessThanOrEqual(21)
  })
})

describe('说了等于没说的内容，退回「未留姓名」', () => {
  it('只发了一条链接', () => {
    expect(contactCardTitle(null, 'https://example.com/a/b/c')).toBe('未留姓名')
  })

  it('只发了表情', () => {
    expect(contactCardTitle(null, '👍👍👍')).toBe('未留姓名')
  })

  it('压根没说过话（只有我们发的自动回复）', () => {
    expect(contactCardTitle(null, null)).toBe('未留姓名')
    expect(contactCardTitle(null, '   ')).toBe('未留姓名')
  })

  it('链接混在文字里 → 去掉链接，留下有用的那半句', () => {
    expect(contactCardTitle(null, '看了这个 https://x.co/1 请问多少钱')).toBe('问：看了这个 请问多少钱')
  })
})

describe('不会把卡片挤坏', () => {
  it('换行和连续空格压成一个空格', () => {
    expect(contactCardTitle(null, '你好\n\n  请问价格')).toBe('问：你好 请问价格')
  })

  it('零宽字符不占位置也不留残渣', () => {
    expect(contactCardTitle(null, '有​团​吗')).toBe('问：有团吗')
  })
})
