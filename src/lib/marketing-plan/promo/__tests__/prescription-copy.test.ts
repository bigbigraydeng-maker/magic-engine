import { describe, expect, it } from 'vitest'
import { describeReview, isStandingRule, spendFromStored, whySentences } from '../prescription-copy'

describe('处方大白话', () => {
  it('规矩看标记或标题，建成暂停系列仍是要做的事', () => {
    expect(isStandingRule('建成暂停的系列', null)).toBe(false)
    expect(isStandingRule('到了暂停线就停', null)).toBe(true)
    expect(isStandingRule('保护期内先别改', null)).toBe(true)
    expect(isStandingRule('加预算前先看三天', 'rule')).toBe(true)
    expect(isStandingRule('到了暂停线就停', 'todo')).toBe(false)
  })

  it('为什么最多三句，有叙述就不用摘要', () => {
    const narrative = '第一句。第二句。第三句。第四句不要出现。'
    expect(whySentences(narrative, '摘要不该出现。')).toEqual(['第一句。', '第二句。', '第三句。'])
    expect(whySentences('  ', '只有摘要这一句')).toEqual(['只有摘要这一句'])
    expect(whySentences('', '')).toEqual([])
  })

  it('花费只读已经写下的每天、总共、配速，不拿预算分配里的金额字段凑', () => {
    const spend = spendFromStored({
      spend: { daily_cents: 1250, currency: 'nzd', pacing: '匀着花' },
      budget_allocation: [{ dimension: 'ads', amount_aud: 999, percentage: 100 }],
    }, [
      { metric: '日预算', current_value: null, target_value: 40, unit: 'NZD' },
      { metric: '总预算', current_value: null, target_value: 80, unit: 'NZD' },
    ], null)
    expect(spend).toEqual({ daily: '12.5 NZD', total: '80 NZD', pacing: '匀着花' })
    expect(JSON.stringify(spend)).not.toMatch(/999/)
    expect(JSON.stringify(spend)).not.toMatch(/AUD/)
  })

  it('正文没写花费对象时，用指标里对得上的三项', () => {
    expect(spendFromStored(null, [
      { metric: '线索', current_value: 0, target_value: 3, unit: '条' },
    ], 'NZD')).toEqual({ daily: null, total: null, pacing: null })
  })

  it('第 7 天和第 14 天从写下当天起算，并说出还剩几天', () => {
    expect(describeReview('2026-10-01', '2026-10-01')).toEqual({
      day7: '10月7日', day14: '10月14日', note: '距第 7 天还有 6 天',
    })
    expect(describeReview('2026-10-01', '2026-10-07').note).toBe('第 7 天就是今天')
    expect(describeReview('2026-10-01', '2026-10-08').note).toBe('第 7 天已经过了，距第 14 天还有 6 天')
    expect(describeReview('2026-10-01', '2026-10-14').note).toBe('第 14 天就是今天')
    expect(describeReview('2026-10-01', '2026-10-20').note).toBe('第 7 天和第 14 天都已经过了')
    expect(describeReview(null, '2026-10-01').note).toBe('还没写下从哪天起算，所以算不出还剩几天。')
    expect(describeReview('2025-12-20', '2026-01-02').day7).toBe('2025年12月26日')
  })
})
