import { describe, it, expect } from 'vitest'
import { highlightSpans } from './caption-highlight'

/** 拼回原文，用来断言「只是分段，没改一个字」。 */
const rejoin = (spans: ReturnType<typeof highlightSpans>) => spans.map((s) => s.text).join('')
const highlighted = (spans: ReturnType<typeof highlightSpans>) =>
  spans.filter((s) => s.highlight).map((s) => s.text)

describe('highlightSpans — 真实脚本文本（2026-08-19 大瑞「所见所闻」两条已发布脚本）', () => {
  it('"Facebook 一个月就带来五十个访问，占不到百分之五" —— 高亮"五十"和"百分之五"', () => {
    const spans = highlightSpans('Facebook 一个月就带来五十个访问，占不到百分之五')
    expect(highlighted(spans)).toEqual(['五十', '百分之五'])
    expect(rejoin(spans)).toBe('Facebook 一个月就带来五十个访问，占不到百分之五')
  })

  it('"搜索带来六百多" —— "多"跟着一起高亮', () => {
    expect(highlighted(highlightSpans('搜索带来六百多'))).toEqual(['六百多'])
  })

  it('"Facebook 带来一百零六条客资" —— 含"零"的连续数字整段高亮', () => {
    expect(highlighted(highlightSpans('Facebook 带来一百零六条客资'))).toEqual(['一百零六'])
  })

  it('"一条不到十块钱" —— 高亮"十"', () => {
    expect(highlighted(highlightSpans('一条不到十块钱'))).toEqual(['十'])
  })

  it('🔴 "第一步，把增强型衡量关掉" —— 序数词"第一"不高亮（不是数据事实）', () => {
    expect(highlighted(highlightSpans('第一步，把增强型衡量关掉'))).toEqual([])
  })

  it('🔴 "第二步，用 Tag Manager" —— 同上，"第二"不高亮', () => {
    expect(highlighted(highlightSpans('第二步，用 Tag Manager'))).toEqual([])
  })

  it('"三十秒你可以先自查" —— 高亮"三十"', () => {
    expect(highlighted(highlightSpans('三十秒你可以先自查'))).toEqual(['三十'])
  })

  it('🔴 "问题出在 GA4 那个「增强型衡量」上" —— GA4 里的数字不高亮（紧贴字母）', () => {
    expect(highlighted(highlightSpans('问题出在 GA4 那个「增强型衡量」上'))).toEqual([])
  })

  it('"这两个数字永远不能相加" —— "两"单独也算数字', () => {
    expect(highlighted(highlightSpans('这两个数字永远不能相加'))).toEqual(['两'])
  })

  it('没有数字的句子返回单个不高亮片段，原样返回', () => {
    const spans = highlightSpans('没数据不可怕')
    expect(spans).toEqual([{ text: '没数据不可怕', highlight: false }])
  })
})

describe('highlightSpans — 阿拉伯数字/货币（给未来带真实数字的脚本用，如 Google Ads 候选）', () => {
  it('"$9.51/条" —— 货币高亮，斜杠后的"条"不高亮', () => {
    const spans = highlightSpans('$9.51/条')
    expect(highlighted(spans)).toEqual(['$9.51'])
    expect(rejoin(spans)).toBe('$9.51/条')
  })

  it('🔴 "GA4" 和 "GTM2" 这类字母挨着数字的不高亮', () => {
    expect(highlighted(highlightSpans('打开 GA4 和 GTM2 看一眼'))).toEqual([])
  })

  it('"106条客资" —— 纯阿拉伯数字也认', () => {
    expect(highlighted(highlightSpans('106条客资'))).toEqual(['106'])
  })
})

describe('highlightSpans — 边界情况', () => {
  it('空字符串不报错', () => {
    expect(highlightSpans('')).toEqual([{ text: '', highlight: false }])
  })

  it('整句全是数字', () => {
    const spans = highlightSpans('五十')
    expect(spans).toEqual([{ text: '五十', highlight: true }])
  })

  it('连续两个高亮段中间夹普通字（"五十到一百之间"）分段正确、可拼回原文', () => {
    const spans = highlightSpans('五十到一百之间')
    expect(rejoin(spans)).toBe('五十到一百之间')
    expect(highlighted(spans)).toEqual(['五十', '一百'])
  })
})
