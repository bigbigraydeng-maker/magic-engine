import { describe, expect, it } from 'vitest'

import {
  CTR_EXPLAINER,
  SELF_SERVE_FOOTER,
  renderRuleSection,
  type ClientRuleFinding,
  type RuleSectionInput,
} from '@/lib/ads-strategy/rules/client-copy'
import { buildRuleCards } from '@/lib/meta/ai/rule-cards'

function finding(overrides: Partial<ClientRuleFinding> = {}): ClientRuleFinding {
  return {
    kind: 'fatigue',
    adName: 'Ad A',
    headline: '「Ad A」最近 3 天，点击率从之前两周的 3.0% 降到了 1.0%（数据截至 9月25日）',
    detail: '细节文字。',
    action: '如果你最近自己改过这条广告的图片或视频，请告诉我们。',
    spend: 10,
    explainsCtr: false,
    ...overrides,
  }
}

function section(
  findings: ClientRuleFinding[],
  overrides: Partial<Extract<RuleSectionInput, { source: 'patrol' }>> = {},
): Extract<RuleSectionInput, { source: 'patrol' }> {
  return { source: 'patrol', dataDate: '2026-09-25', adsChecked: 40, findings, ...overrides }
}

function storedReport(sec: Extract<RuleSectionInput, { source: 'patrol' }>): string {
  return `一、总体结果\n花费 NZ$100。\n\n${renderRuleSection(sec)}\n\n四、广告出现的位置\nFacebook 动态最多。\n\n八、三条可以考虑的方向\n1. 方向一`
}

const TODAY = '2026-09-27'

describe('buildRuleCards', () => {
  it('happy path: sorts by spend, builds title/intro, drops spend', () => {
    const sec = section([
      finding({ adName: 'Ad A', spend: 5 }),
      finding({ adName: 'Ad B', spend: 30 }),
      finding({ adName: 'Ad C', spend: 10 }),
    ])
    const result = buildRuleCards(sec, null, TODAY)
    expect(result.cards).not.toBeNull()
    const cards = result.cards!
    expect(cards.cards.map((c) => c.adLabel)).toEqual(['Ad B', 'Ad C', 'Ad A'])
    expect(cards.title).toBe('我们正在跟进的广告（3 条）')
    expect(cards.intro).toBe(
      '这次检查了 40 条正在投放的广告，下面这 3 条有变化，其余没发现明显变差。',
    )
    for (const c of cards.cards) {
      expect(Object.prototype.hasOwnProperty.call(c, 'spend')).toBe(false)
    }
    const json = JSON.stringify(result.cards)
    expect(json).not.toContain('D2')
    expect(json).not.toContain('D10')
    expect(json).not.toContain('spend')
  })

  it('shortens headline by removing name prefix and date suffix', () => {
    const sec = section([finding({ adName: 'Ad A' })])
    const result = buildRuleCards(sec, null, TODAY)
    expect(result.cards!.cards[0].headline).toBe(
      '最近 3 天，点击率从之前两周的 3.0% 降到了 1.0%。',
    )
  })

  it('keeps headline not starting with the name (minus date suffix)', () => {
    const sec = section([
      finding({
        adName: 'Ad A',
        headline: '最近 3 天，点击率从之前两周的 3.0% 降到了 1.0%（数据截至 9月25日）',
      }),
    ])
    const result = buildRuleCards(sec, null, TODAY)
    expect(result.cards!.cards[0].headline).toBe(
      '最近 3 天，点击率从之前两周的 3.0% 降到了 1.0%。',
    )
  })

  it('adds CTR explainer only to the first explainsCtr card', () => {
    const sec = section([
      finding({ adName: 'Ad A', spend: 5, explainsCtr: true, detail: '低花费细节。' }),
      finding({ adName: 'Ad B', spend: 30, explainsCtr: true, detail: '高花费细节。' }),
    ])
    const result = buildRuleCards(sec, null, TODAY)
    const cards = result.cards!.cards
    expect(cards[0].adLabel).toBe('Ad B')
    expect(cards[0].detail).toBe(CTR_EXPLAINER + '高花费细节。')
    expect(cards[1].detail).toBe('低花费细节。')
  })

  it('uses singular wording for one finding', () => {
    const sec = section([finding({ adName: 'Ad A' })])
    const report = storedReport(sec)
    const result = buildRuleCards(sec, report, TODAY)
    expect(result.cards!.intro).toContain('下面这条有变化')
    expect(result.cards!.promise).toContain('已经看到这条')
    expect(result.report).toContain('这条已经放在上面「我们正在跟进的广告」里，这里不再重复。')
  })

  it('promise on review day uses the scheduled wording', () => {
    const sec = section([finding()])
    const result = buildRuleCards(sec, null, '2026-10-02')
    expect(result.cards!.promise).toBe(
      '我们的广告团队已经看到这条，会在10月2日前后复查并处理，你不用动手。',
    )
  })

  it('promise after review day uses the follow-up wording', () => {
    const sec = section([finding()])
    const result = buildRuleCards(sec, null, '2026-10-03')
    expect(result.cards!.promise).toBe(
      '这是9月25日的数据，我们原定10月2日前后复查，你不用动手；想知道最新进展可以直接问我们的团队。',
    )
  })

  it('replaces the body section exactly once', () => {
    const sec = section([
      finding({ adName: 'Ad A', spend: 5, detail: '细节甲。' }),
      finding({ adName: 'Ad B', spend: 30, detail: '细节乙。' }),
      finding({ adName: 'Ad C', spend: 10, detail: '细节丙。' }),
    ])
    const report = storedReport(sec)
    const result = buildRuleCards(sec, report, TODAY)
    expect(result.cards!.bodyReplaced).toBe(true)
    expect(result.report).toContain(
      '三、需要留意的广告\n这 3 条已经放在上面「我们正在跟进的广告」里，这里不再重复。',
    )
    expect(result.report).toContain('四、广告出现的位置\nFacebook 动态最多。')
    expect(result.report).toContain('八、三条可以考虑的方向\n1. 方向一')
    expect(result.report).not.toContain('细节甲。')
    expect(result.report).not.toContain('细节乙。')
    expect(result.report).not.toContain('细节丙。')
  })

  it('keeps later headings verbatim when AI used Arabic numerals', () => {
    const sec = section([finding()])
    const report = `一、总体结果\n花费 NZ$100。\n\n${renderRuleSection(sec)}\n\n4. 广告出现的位置\nFacebook 动态最多。`
    const result = buildRuleCards(sec, report, TODAY)
    expect(result.cards!.bodyReplaced).toBe(true)
    expect(result.report).toContain('4. 广告出现的位置\nFacebook 动态最多。')
  })

  it('leaves report unchanged when the original section is not found', () => {
    const sec = section([finding()])
    const report = '一、总体结果\n花费 NZ$100。\n\n四、广告出现的位置\nFacebook 动态最多。'
    const result = buildRuleCards(sec, report, TODAY)
    expect(result.cards).not.toBeNull()
    expect(result.cards!.bodyReplaced).toBe(false)
    expect(result.report).toBe(report)
  })

  it('leaves report unchanged when the original section appears twice', () => {
    const sec = section([finding()])
    const original = renderRuleSection(sec)
    const report = `${original}\n\n${original}`
    const result = buildRuleCards(sec, report, TODAY)
    expect(result.cards).not.toBeNull()
    expect(result.cards!.bodyReplaced).toBe(false)
    expect(result.report).toBe(report)
  })

  it('returns cards with null report when report is null', () => {
    const sec = section([finding()])
    const result = buildRuleCards(sec, null, TODAY)
    expect(result.cards).not.toBeNull()
    expect(result.cards!.bodyReplaced).toBe(false)
    expect(result.report).toBeNull()
  })

  it('returns null cards and unchanged report for invalid inputs', () => {
    const report = '一、总体结果\n花费 NZ$100。'
    const invalid: unknown[] = [
      null,
      { source: 'none' },
      section([finding()], { dataDate: 'bad' }),
      // 能被 Date.parse 读懂、但不是 YYYY-MM-DD 的扩展年份写法：只有格式检查能挡住（formatDay 按 '-' 切会出错）
      section([finding()], { dataDate: '+002026-09-25' }),
      section([]),
      section([finding({ kind: 'other' as unknown as ClientRuleFinding['kind'] })]),
      section([finding({ spend: Number.NaN })]),
      section([finding({ headline: 123 as unknown as string })]),
    ]
    for (const input of invalid) {
      const result = buildRuleCards(input, report, TODAY)
      expect(result.cards).toBeNull()
      expect(result.report).toBe(report)
    }
  })

  it('truncates a long adName to 120 chars plus ellipsis', () => {
    const longName = 'A'.repeat(150)
    const sec = section([finding({ adName: longName })])
    const result = buildRuleCards(sec, null, TODAY)
    const label = result.cards!.cards[0].adLabel
    expect(label.length).toBe(121)
    expect(label.endsWith('…')).toBe(true)
  })
})

function liveSection(
  findings: ClientRuleFinding[],
  overrides: Partial<Extract<RuleSectionInput, { source: 'live' }>> = {},
): Extract<RuleSectionInput, { source: 'live' }> {
  return { source: 'live', dataDate: '2026-09-25', adsChecked: 40, findings, ...overrides }
}

describe('buildRuleCards — live source', () => {
  it('builds self-serve title, empty promise, footer and live body replacement', () => {
    const sec = liveSection([finding({ adName: 'Ad A' })])
    const report = `一、总体结果\n花费 NZ$100。\n\n${renderRuleSection(sec)}\n\n四、广告出现的位置\nFacebook 动态最多。`
    const result = buildRuleCards(sec, report, TODAY)
    expect(result.cards).not.toBeNull()
    const cards = result.cards!
    expect(cards.title).toBe('值得你看一眼的广告（1 条）')
    expect(cards.promise).toBe('')
    expect(cards.footer).toBe(SELF_SERVE_FOOTER)
    expect(cards.bodyReplaced).toBe(true)
    expect(result.report).toContain(
      '三、需要留意的广告\n这条已经放在上面「值得你看一眼的广告」里，这里不再重复。',
    )
    expect(result.report).toContain('四、广告出现的位置\nFacebook 动态最多。')
    expect(JSON.stringify(cards)).not.toContain('你不用动手')
  })
})
