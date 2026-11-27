import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QualifiedEntry, qualifiedParts, sameStages } from '../QualifiedEntry'

const DATA = { stageKeys: ['quoted', 'deposit_paid'], waiting: 3, moved: 2, quiet: 5 }
const html = (stageFilter: string[], data: typeof DATA | null = DATA) =>
  renderToStaticMarkup(<QualifiedEntry data={data} stageFilter={stageFilter} onStageFilterChange={() => {}} />)

describe('QualifiedEntry', () => {
  it('says how many quoted guests are waiting, in plain words, and offers one button', () => {
    const out = html([])
    expect(out).toContain('已报价的客人：')
    expect(out).toContain('3 位说了话或到了回电时间，还没人回')
    expect(out).toContain('2 位点了我们的邮件或在看官网，还没人跟')
    expect(out).toContain('5 位聊过之后没了下文')
    expect(out).toContain('只看这批')
  })

  it('leaves out the parts that are zero; nothing waiting at all → no line', () => {
    expect(qualifiedParts({ ...DATA, moved: 0, quiet: 0 })).toEqual(['3 位说了话或到了回电时间，还没人回'])
    expect(html([], { ...DATA, waiting: 0, moved: 0, quiet: 0 })).toBe('')
  })

  it('while the list is filtered to exactly those stages it says so and offers the way back', () => {
    const out = html(['deposit_paid', 'quoted'])
    expect(out).toContain('正在只看已报价的客人')
    expect(out).toContain('看回全部客人')
    expect(out).not.toContain('只看这批')
  })

  it('another stage filter is on → stays out of the way; no data → nothing', () => {
    expect(html(['contacted'])).toBe('')
    expect(html([], null)).toBe('')
    expect(sameStages(['a'], ['a', 'b'])).toBe(false)
  })
})
