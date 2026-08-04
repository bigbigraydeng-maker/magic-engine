import { describe, expect, it } from 'vitest'
import {
  applyClientGlossary,
  extractTermEdits,
  mergeGlossary,
  recordRedoReason,
  type GlossaryEntry,
} from './lecture-learning'

describe('extractTermEdits(从客户校准里学术语)', () => {
  it('真实场景:客户把 thruplay 改成 ThruPlay', () => {
    const edits = extractTermEdits(
      ['简单来说的thruplay是', '出价策略那也来选thruplay就对了'],
      ['简单来说的ThruPlay是', '出价策略那也来选ThruPlay就对了'],
    )
    expect(edits).toEqual([
      { from: 'thruplay', to: 'ThruPlay' },
      { from: 'thruplay', to: 'ThruPlay' },
    ])
  })

  it('中文措辞改动不学(那是个人偏好，学了会把客户的话改乱)', () => {
    expect(extractTermEdits(['这样做效果更好'], ['这么做效果更好'])).toEqual([])
  })

  it('整句重写不学(学不出可靠规律)', () => {
    expect(extractTermEdits(['完全不同的一句话'], ['另外一种表达方式在这'])).toEqual([])
  })

  it('太短的词不学(容易误伤)', () => {
    expect(extractTermEdits(['用ai做'], ['用AI做'])).toEqual([])
  })

  it('没改的不学 / 条数对不上也不崩', () => {
    expect(extractTermEdits(['一样的'], ['一样的'])).toEqual([])
    expect(extractTermEdits(['只有一条'], [])).toEqual([])
  })
})

describe('mergeGlossary + applyClientGlossary(学到才用)', () => {
  const NOW = '2026-08-04T00:00:00.000Z'

  it('只出现一次不生效(可能只是手滑)', () => {
    const g = mergeGlossary({}, [{ from: 'geo', to: 'GEO' }], NOW)
    expect(applyClientGlossary('讲一下 geo 怎么做', g)).toBe('讲一下 geo 怎么做')
  })

  it('出现两次才进词表并自动纠正', () => {
    let g = mergeGlossary({}, [{ from: 'geo', to: 'GEO' }], NOW)
    g = mergeGlossary(g, [{ from: 'geo', to: 'GEO' }], NOW)
    expect(g['geo'].hits).toBe(2)
    expect(applyClientGlossary('讲一下 geo 怎么做', g)).toBe('讲一下 GEO 怎么做')
  })

  it('被更长英文词包住的不动', () => {
    const g: Record<string, GlossaryEntry> = { geo: { to: 'GEO', hits: 5, updatedAt: NOW } }
    expect(applyClientGlossary('geography 不是 geo', g)).toBe('geography 不是 GEO')
  })

  it('已经写对的不重复替换', () => {
    const g: Record<string, GlossaryEntry> = { geo: { to: 'GEO', hits: 5, updatedAt: NOW } }
    expect(applyClientGlossary('GEO 已经对了', g)).toBe('GEO 已经对了')
  })
})

describe('recordRedoReason(打回原因统计)', () => {
  const NOW = '2026-08-04T00:00:00.000Z'

  it('同一原因第 3 次出现时提示固化成规则', () => {
    let r = recordRedoReason([], '课件太挤', NOW)
    expect(r.suggestRule).toBe(false)
    r = recordRedoReason(r.reasons, '课件太挤', NOW)
    expect(r.suggestRule).toBe(false)
    r = recordRedoReason(r.reasons, '课件太挤', NOW)
    expect(r.suggestRule).toBe(true)
    expect(r.reasons.find((x) => x.reason === '课件太挤')?.count).toBe(3)
  })

  it('不同原因分开计数', () => {
    let r = recordRedoReason([], '课件太挤', NOW)
    r = recordRedoReason(r.reasons, '字幕太快', NOW)
    expect(r.reasons).toHaveLength(2)
    expect(r.suggestRule).toBe(false)
  })

  it('空原因不记(允许客户不填)', () => {
    expect(recordRedoReason([], '   ', NOW)).toEqual({ reasons: [], suggestRule: false })
  })

  it('只留最近 30 条，不会无限长', () => {
    let reasons = Array.from({ length: 35 }, (_, i) => ({ reason: `r${i}`, count: 1, lastAt: NOW }))
    reasons = recordRedoReason(reasons, '新原因', NOW).reasons
    expect(reasons.length).toBe(30)
    expect(reasons.at(-1)?.reason).toBe('新原因')
  })
})
