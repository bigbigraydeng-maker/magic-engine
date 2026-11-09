import { describe, expect, it } from 'vitest'
import { computeOutcomeVerdict } from '../job'
import {
  OBJECT_WINDOW_REASON,
  expectedForDirection,
  judgeObjectWindow,
  objectWindowDates,
  type ObjectDay,
} from '../object-window'

const base = {
  metric: 'ads.account.cpa',
  direction: 'down' as const,
  expectedDelta: -1,
  pair: 'clear' as const,
  executedAt: '2026-01-01T00:00:00.000Z',
  windowDays: 7,
  beforeCents: 2000,
  afterCents: 2400,
  beforeStatus: null,
  afterStatus: null,
  basis: null,
  verdictOf: computeOutcomeVerdict,
}

function row(insight_date: string, spend: number, results: number): ObjectDay {
  return {
    insight_date, spend, results, impressions: 100, clicks: 10, leads: results, messaging_conversations: 0,
  }
}

describe('same object, same window', () => {
  it('uses only the days inside the card window', () => {
    expect(objectWindowDates('2026-01-01T15:00:00.000Z', 7)).toEqual({
      from: '2025-12-25', start: '2026-01-01', to: '2026-01-08',
    })
    const judged = judgeObjectWindow({
      ...base,
      rows: [row('2025-12-20', 999, 1), row('2025-12-28', 70, 7), row('2026-01-03', 36, 9), row('2026-01-20', 1, 9)],
    })
    expect(judged).toMatchObject({ storedVerdict: 'confirmed', baseline: 10, after: 4 })
    expect(judged.case.verdict).toBe('improved')
    expect(judged.case.text).toContain('希望获客成本下降')
    expect(judged.case.text).not.toContain('ads.account')
  })

  it('says it cannot judge when the object has no rows, or the cost cannot be divided', () => {
    const missing = judgeObjectWindow({ ...base, rows: [] })
    expect(missing.case.reason).toBe(OBJECT_WINDOW_REASON.missing)
    expect(missing.baseline).toBeNull()

    const zero = judgeObjectWindow({ ...base, rows: [row('2025-12-28', 40, 0), row('2026-01-03', 10, 0)] })
    expect(zero.case.reason).toBe(OBJECT_WINDOW_REASON.unreadable)
    expect(zero.case.text).toContain('算不出来')
    expect(zero.storedVerdict).toBe('inconclusive')
  })

  it('does not score a direction that disagrees with the stored expectation', () => {
    expect(expectedForDirection('down', 1)).toBe('conflict')
    expect(expectedForDirection('pause', null)).toBeNull()
    const judged = judgeObjectWindow({ ...base, expectedDelta: 1, rows: [row('2025-12-28', 70, 7), row('2026-01-03', 20, 10)] })
    expect(judged.case.reason).toBe(OBJECT_WINDOW_REASON.conflict)
    expect(judged.storedVerdict).toBe('inconclusive')
  })

  it('scores a pause from the metric itself, without treating the pause as success', () => {
    const judged = judgeObjectWindow({
      ...base,
      direction: 'pause',
      expectedDelta: null,
      beforeCents: null,
      afterCents: null,
      beforeStatus: 'ACTIVE',
      afterStatus: 'PAUSED',
      basis: '这一组太贵',
      rows: [row('2025-12-28', 70, 7), row('2026-01-03', 20, 10)],
    })
    expect(judged.case.verdict).toBe('improved')
    expect(judged.case.text).toContain('从在投改成已暂停')
    expect(judged.case.text).toContain('原因是：这一组太贵。')
  })

  it('calls a small move too small, and a reversed move worse', () => {
    const noise = judgeObjectWindow({ ...base, rows: [row('2025-12-28', 100, 10), row('2026-01-03', 101, 10)] })
    expect(noise.case.reason).toBe(OBJECT_WINDOW_REASON.noise)

    const worse = judgeObjectWindow({ ...base, rows: [row('2025-12-28', 20, 10), row('2026-01-03', 80, 10)] })
    expect(worse.case.verdict).toBe('worse')
    expect(worse.storedVerdict).toBe('reversed')
    expect(worse.case.text).toContain('结论：变差了。')
  })
})
