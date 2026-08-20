import { describe, it, expect } from 'vitest'
import { highlightSpans } from './caption-highlight'

/** 拼回原文，用来断言「只是分段，没改一个字」。 */
const rejoin = (spans: ReturnType<typeof highlightSpans>) => spans.map((s) => s.text).join('')
const highlighted = (spans: ReturnType<typeof highlightSpans>) =>
  spans.filter((s) => s.highlight).map((s) => s.text)

const highlightZh = (text: string) => highlightSpans(text, 'zh')
const highlightEn = (text: string) => highlightSpans(text, 'en')

describe('highlightSpans — 真实脚本文本（2026-08-19 大瑞「所见所闻」两条已发布脚本，language="zh"）', () => {
  it('"Facebook 一个月就带来五十个访问，占不到百分之五" —— 高亮"五十"和"百分之五"', () => {
    const spans = highlightZh('Facebook 一个月就带来五十个访问，占不到百分之五')
    expect(highlighted(spans)).toEqual(['五十', '百分之五'])
    expect(rejoin(spans)).toBe('Facebook 一个月就带来五十个访问，占不到百分之五')
  })

  it('"搜索带来六百多" —— "多"跟着一起高亮', () => {
    expect(highlighted(highlightZh('搜索带来六百多'))).toEqual(['六百多'])
  })

  it('"Facebook 带来一百零六条客资" —— 含"零"的连续数字整段高亮', () => {
    expect(highlighted(highlightZh('Facebook 带来一百零六条客资'))).toEqual(['一百零六'])
  })

  it('"一条不到十块钱" —— 高亮"十"', () => {
    expect(highlighted(highlightZh('一条不到十块钱'))).toEqual(['十'])
  })

  it('🔴 "第一步，把增强型衡量关掉" —— 序数词"第一"不高亮（不是数据事实）', () => {
    expect(highlighted(highlightZh('第一步，把增强型衡量关掉'))).toEqual([])
  })

  it('🔴 "第二步，用 Tag Manager" —— 同上，"第二"不高亮', () => {
    expect(highlighted(highlightZh('第二步，用 Tag Manager'))).toEqual([])
  })

  it('"三十秒你可以先自查" —— 高亮"三十"', () => {
    expect(highlighted(highlightZh('三十秒你可以先自查'))).toEqual(['三十'])
  })

  it('🔴 "问题出在 GA4 那个「增强型衡量」上" —— GA4 里的数字不高亮（紧贴字母）', () => {
    expect(highlighted(highlightZh('问题出在 GA4 那个「增强型衡量」上'))).toEqual([])
  })

  it('"这两个数字永远不能相加" —— "两"单独也算数字', () => {
    expect(highlighted(highlightZh('这两个数字永远不能相加'))).toEqual(['两'])
  })

  it('没有数字的句子返回单个不高亮片段，原样返回', () => {
    const spans = highlightZh('没数据不可怕')
    expect(spans).toEqual([{ text: '没数据不可怕', highlight: false }])
  })
})

describe('highlightSpans — 阿拉伯数字/货币（给未来带真实数字的脚本用，如 Google Ads 候选，language="zh"）', () => {
  it('"$9.51/条" —— 货币高亮，斜杠后的"条"不高亮', () => {
    const spans = highlightZh('$9.51/条')
    expect(highlighted(spans)).toEqual(['$9.51'])
    expect(rejoin(spans)).toBe('$9.51/条')
  })

  it('🔴 "GA4" 和 "GTM2" 这类字母挨着数字的不高亮', () => {
    expect(highlighted(highlightZh('打开 GA4 和 GTM2 看一眼'))).toEqual([])
  })

  it('"106条客资" —— 纯阿拉伯数字也认', () => {
    expect(highlighted(highlightZh('106条客资'))).toEqual(['106'])
  })
})

describe('highlightSpans — 边界情况（language="zh"）', () => {
  it('空字符串不报错', () => {
    expect(highlightZh('')).toEqual([{ text: '', highlight: false }])
  })

  it('整句全是数字', () => {
    const spans = highlightZh('五十')
    expect(spans).toEqual([{ text: '五十', highlight: true }])
  })

  it('连续两个高亮段中间夹普通字（"五十到一百之间"）分段正确、可拼回原文', () => {
    const spans = highlightZh('五十到一百之间')
    expect(rejoin(spans)).toBe('五十到一百之间')
    expect(highlighted(spans)).toEqual(['五十', '一百'])
  })
})

describe('highlightSpans — 英语听写文本（Whisper 自动检测语种后 language="en"，非真实客户数据，覆盖常见口语数字表达）', () => {
  it('"Facebook brought in fifty visits last month" —— 高亮"fifty"', () => {
    const spans = highlightEn('Facebook brought in fifty visits last month')
    expect(highlighted(spans)).toEqual(['fifty'])
    expect(rejoin(spans)).toBe('Facebook brought in fifty visits last month')
  })

  it('"That is about five percent of total traffic" —— "percent"跟数字一起整段高亮', () => {
    expect(highlighted(highlightEn('That is about five percent of total traffic'))).toEqual(['five percent'])
  })

  it('"Facebook brought in a hundred and six leads" —— "a hundred and six"整段高亮', () => {
    expect(highlighted(highlightEn('Facebook brought in a hundred and six leads'))).toEqual(['a hundred and six'])
  })

  it('"One hundred and six leads came from search" —— "one"打头同样成立(句首大写)', () => {
    expect(highlighted(highlightEn('One hundred and six leads came from search'))).toEqual(['One hundred and six'])
  })

  it('"It costs twenty three dollars per lead" —— 十位+个位两个词连成一段高亮', () => {
    expect(highlighted(highlightEn('It costs twenty three dollars per lead'))).toEqual(['twenty three'])
  })

  it('"fifty-two clicks this week" —— 连字符写法同样识别', () => {
    expect(highlighted(highlightEn('fifty-two clicks this week'))).toEqual(['fifty-two'])
  })

  it('🔴 "Check GA4 and GTM2 before turning off enhanced measurement" —— 字母挨着的数字不高亮', () => {
    expect(highlighted(highlightEn('Check GA4 and GTM2 before turning off enhanced measurement'))).toEqual([])
  })

  it('"$9.51 per lead is what we are paying" —— 阿拉伯数字/货币规则英语一样适用', () => {
    const spans = highlightEn('$9.51 per lead is what we are paying')
    expect(highlighted(spans)).toEqual(['$9.51'])
    expect(rejoin(spans)).toBe('$9.51 per lead is what we are paying')
  })

  it('"we got 106 leads from Facebook" —— 纯阿拉伯数字也认', () => {
    expect(highlighted(highlightEn('we got 106 leads from Facebook'))).toEqual(['106'])
  })

  it('"fifty to a hundred visits" —— 两个高亮段中间夹普通字，分段正确、可拼回原文', () => {
    const spans = highlightEn('fifty to a hundred visits')
    expect(rejoin(spans)).toBe('fifty to a hundred visits')
    expect(highlighted(spans)).toEqual(['fifty', 'a hundred'])
  })

  it('没有数字的句子返回单个不高亮片段，原样返回', () => {
    expect(highlightEn('No data is scary')).toEqual([{ text: 'No data is scary', highlight: false }])
  })
})

describe('highlightSpans — 未适配语种兜底（既不是"zh"也不是"en"，只认语言无关的阿拉伯数字/货币）', () => {
  it('"50 leads today" language="fr" —— 阿拉伯数字仍高亮，不猜法语文字数字', () => {
    expect(highlighted(highlightSpans('50 leads today', 'fr'))).toEqual(['50'])
  })

  it('空字符串 language —— 缓存里没留档语种时的兜底，不报错、不当中文处理', () => {
    expect(highlighted(highlightSpans('106 leads', ''))).toEqual(['106'])
  })
})
