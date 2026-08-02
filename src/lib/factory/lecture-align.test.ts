import { describe, expect, it } from 'vitest'
import {
  alignPartsToSegments,
  findHeadStart,
  bigramSimilarity,
  normalizeZh,
  splitLine,
  splitSubtitleChunks,
  type TranscriptSegment,
} from './lecture-align'

describe('normalizeZh', () => {
  it('去空白标点、转小写', () => {
    expect(normalizeZh('你好，World！ 123')).toBe('你好world123')
  })
})

describe('bigramSimilarity', () => {
  it('相同文本 = 1', () => {
    expect(bigramSimilarity('打开谷歌地图', '打开谷歌地图')).toBe(1)
  })
  it('完全不同 ≈ 0', () => {
    expect(bigramSimilarity('打开谷歌地图', '关注主页合集')).toBe(0)
  })
  it('部分相似在中间', () => {
    const s = bigramSimilarity('打开谷歌地图搜索', '打开谷歌地图查找')
    expect(s).toBeGreaterThan(0.4)
    expect(s).toBeLessThan(1)
  })
})

function segs(texts: string[], secEach = 5): TranscriptSegment[] {
  return texts.map((text, i) => ({ start: i * secEach, end: (i + 1) * secEach, text }))
}

describe('alignPartsToSegments', () => {
  it('单部分 = 整条录像', () => {
    const r = alignPartsToSegments(['随便'], segs(['a', 'b']))
    expect(r).toEqual([{ start: 0, end: 10 }])
  })

  it('照稿念(逐字一致)时边界踩在段开头', () => {
    const parts = ['今天讲怎么用AI找客户', '第一步打开谷歌地图搜索你的行业', '关注我主页合集看全系列']
    const r = alignPartsToSegments(parts, segs(parts))
    expect(r).toEqual([
      { start: 0, end: 5 },
      { start: 5, end: 10 },
      { start: 10, end: 15 },
    ])
  })

  it('自由发挥(文本对不上)时退回按比例切，且每部分至少一段', () => {
    const parts = ['开场白开场白开场白', '中间内容中间内容中间内容', '结尾结尾结尾']
    const transcript = segs(['嗯大家好啊', '我今天想聊聊', '一个很有意思的事', '就这样吧'])
    const r = alignPartsToSegments(parts, transcript)
    expect(r).toHaveLength(3)
    expect(r[0].start).toBe(0)
    expect(r[2].end).toBe(20)
    // 无缝衔接
    expect(r[0].end).toBe(r[1].start)
    expect(r[1].end).toBe(r[2].start)
    // 每部分时长 > 0
    for (const p of r) expect(p.end).toBeGreaterThan(p.start)
  })

  it('部分数多于段数以外的极端：段不够时也不崩、边界单调', () => {
    const parts = ['一', '二', '三']
    const r = alignPartsToSegments(parts, segs(['一二三']))
    // 只有一段却要切三部分：数学上切不动，但绝不能崩——收缩到可用边界
    expect(r).toHaveLength(3)
    expect(r[0].start).toBeLessThanOrEqual(r[2].end)
  })

  it('空输入报错', () => {
    expect(() => alignPartsToSegments([], segs(['a']))).toThrow()
    expect(() => alignPartsToSegments(['a'], [])).toThrow()
  })
})

describe('splitLine', () => {
  it('短句原样保留(去掉标点分隔)', () => {
    expect(splitLine('第一步，打开谷歌地图。')).toEqual(['第一步', '打开谷歌地图'])
  })
  it('超长无标点按上限切(尾巴太短会并进上一行)', () => {
    expect(splitLine('一二三四五六七八九十甲乙丙丁戊己庚辛', 14))
      .toEqual(['一二三四五六七八九十甲乙丙丁', '戊己庚辛'])
  })

  it('英文单词绝不从中间切断(真实事故:business profile → siness profile)', () => {
    const lines = splitLine('打开你的 business profile 页面看一下', 14)
    expect(lines.join('')).toContain('business')
    // 每个英文词都必须完整出现，不能被切成半截
    for (const w of ['business', 'profile']) {
      expect(lines.some((l) => l.includes(w))).toBe(true)
    }
  })

  it('网址不被切断', () => {
    const lines = splitLine('打开 business.google.com 这个网址', 14)
    expect(lines.some((l) => l.includes('business.google.com'))).toBe(true)
  })

  it('整段就是一个超长英文串:宁可这一行长一点也不切成乱码', () => {
    const lines = splitLine('abcdefghijklmnopqrstuvwxyz0123456789', 14)
    expect(lines).toEqual(['abcdefghijklmnopqrstuvwxyz0123456789'])
  })
  it('空文本返回空数组', () => {
    expect(splitLine('   ')).toEqual([])
  })
})

describe('splitSubtitleChunks', () => {
  it('每块 ≤14 字、时间按字数比例分、覆盖原段', () => {
    const chunks = splitSubtitleChunks([
      { start: 0, end: 6, text: '第一步打开谷歌地图，搜索你所在城市的行业关键词' },
    ])
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(14)
      expect(c.end).toBeGreaterThan(c.start)
    }
    expect(chunks[0].start).toBe(0)
    expect(chunks[chunks.length - 1].end).toBeCloseTo(6, 5)
  })

  it('跳过空段', () => {
    expect(splitSubtitleChunks([{ start: 0, end: 1, text: '  ' }])).toEqual([])
  })
})

describe('findHeadStart', () => {
  const HOOK = '你有没有试过在Google上搜你自己的生意'

  it('开头有寒暄/清嗓时，从真正讲开场白那一段起片', () => {
    const segs = [
      { start: 0.5, end: 2.0, text: '好 那我开始了啊' },
      { start: 2.1, end: 3.4, text: '等一下 我调一下' },
      { start: 3.6, end: 8.0, text: '你有没有试过在Google上搜你自己的生意' },
    ]
    expect(findHeadStart(HOOK, segs)).toBe(3.6)
  })

  it('一上来就进正题:不跳，从第一句起', () => {
    const segs = [
      { start: 1.2, end: 6.0, text: '你有没有试过在Google上搜你自己的生意' },
      { start: 6.1, end: 9.0, text: '结果根本找不到' },
    ]
    expect(findHeadStart(HOOK, segs)).toBe(1.2)
  })

  it('完全对不上(自由发挥)时退回第一句，不乱切', () => {
    const segs = [
      { start: 0.8, end: 4.0, text: '今天我们聊点别的东西' },
      { start: 4.1, end: 9.0, text: '完全不一样的内容在这里' },
    ]
    expect(findHeadStart(HOOK, segs)).toBe(0.8)
  })

  it('开场白出现得太晚(超过 25 秒)不跳，防判错切掉正片', () => {
    const segs = [
      { start: 0.5, end: 3.0, text: '随便说点什么东西' },
      { start: 40, end: 46, text: '你有没有试过在Google上搜你自己的生意' },
    ]
    expect(findHeadStart(HOOK, segs)).toBe(0.5)
  })

  it('空输入不崩', () => {
    expect(findHeadStart(HOOK, [])).toBe(0)
    expect(findHeadStart('', [{ start: 2, end: 5, text: '随便' }])).toBe(2)
  })
})
