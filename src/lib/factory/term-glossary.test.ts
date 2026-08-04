import { describe, expect, it } from 'vitest'
import { normalizeTerms } from './term-glossary'

describe('normalizeTerms', () => {
  it('真实事故:听写把 ThruPlay 写成各种样子', () => {
    expect(normalizeTerms('简单来说的throughplay是')).toBe('简单来说的ThruPlay是')
    expect(normalizeTerms('出价策略那也来选thruplay就对了')).toBe('出价策略那也来选ThruPlay就对了')
    expect(normalizeTerms('开了through play你的视频')).toBe('开了ThruPlay你的视频')
  })

  it('ChatGPT 各种错法都能纠', () => {
    expect(normalizeTerms('打开ChadGBT直接输入')).toBe('打开ChatGPT直接输入')
    expect(normalizeTerms('打开chat gpt')).toBe('打开ChatGPT')
  })

  it('大小写不规范的品牌名统一', () => {
    expect(normalizeTerms('你进那个ads manager里面')).toBe('你进那个Ads Manager里面')
    expect(normalizeTerms('在facebook上投放')).toBe('在Facebook上投放')
    expect(normalizeTerms('发到tiktok和youtube')).toBe('发到TikTok和YouTube')
  })

  it('已经写对的不动', () => {
    const ok = '打开 ChatGPT，出价选 ThruPlay'
    expect(normalizeTerms(ok)).toBe(ok)
  })

  it('被更长英文词包住的不动(不能把词切一半改)', () => {
    expect(normalizeTerms('googleplex 是总部')).toBe('googleplex 是总部')
    expect(normalizeTerms('seosystem 不是 SEO')).toBe('seosystem 不是 SEO')
  })

  it('空文本不崩', () => {
    expect(normalizeTerms('')).toBe('')
  })
})
