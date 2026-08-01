import { describe, expect, it } from 'vitest'
import {
  alignPartsToSegments,
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
  it('超长无标点硬切', () => {
    expect(splitLine('一二三四五六七八九十一二三四五六', 14)).toEqual(['一二三四五六七八九十一二三四', '五六'])
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
