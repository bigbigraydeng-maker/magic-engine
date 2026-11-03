import { describe, it, expect } from 'vitest'
import {
  parsePromoWindow,
  nzToday,
  promoVerdict,
  matchPoolEntry,
  videoVerdicts,
  worstVerdict,
  endOfNzDayMs,
  promoEndCapMs,
  type PoolEntryLike,
  type PromoWindow,
} from '../promo-window'

describe('parsePromoWindow', () => {
  it('接受合法 dated', () => {
    expect(parsePromoWindow({ kind: 'dated', start: '2026-11-01', end: '2026-11-30' })).toEqual({
      kind: 'dated',
      start: '2026-11-01',
      end: '2026-11-30',
    })
  })

  it('接受合法 evergreen', () => {
    expect(parsePromoWindow({ kind: 'evergreen' })).toEqual({ kind: 'evergreen' })
  })

  it('缺 kind → null', () => {
    expect(parsePromoWindow({ start: '2026-11-01', end: '2026-11-30' })).toBeNull()
  })

  it('start > end → null', () => {
    expect(parsePromoWindow({ kind: 'dated', start: '2026-11-30', end: '2026-11-01' })).toBeNull()
  })

  it('2026-02-30 非法 → null', () => {
    expect(parsePromoWindow({ kind: 'dated', start: '2026-02-30', end: '2026-03-01' })).toBeNull()
  })

  it('dated 多余键 → null', () => {
    expect(
      parsePromoWindow({ kind: 'dated', start: '2026-11-01', end: '2026-11-30', extra: 1 }),
    ).toBeNull()
  })

  it('evergreen 带多余键 → null', () => {
    expect(parsePromoWindow({ kind: 'evergreen', start: '2026-11-01' })).toBeNull()
  })

  it('null → null', () => {
    expect(parsePromoWindow(null)).toBeNull()
  })

  it('字符串 → null', () => {
    expect(parsePromoWindow('evergreen')).toBeNull()
  })
})

describe('promoVerdict', () => {
  const dated: PromoWindow = { kind: 'dated', start: '2026-11-01', end: '2026-11-30' }

  it('undeclared', () => {
    expect(promoVerdict(null, '2026-11-15')).toBe('undeclared')
    expect(promoVerdict(undefined, '2026-11-15')).toBe('undeclared')
  })

  it('evergreen → ok', () => {
    expect(promoVerdict({ kind: 'evergreen' }, '2026-11-15')).toBe('ok')
  })

  it('expired（today 在 end 后一天）', () => {
    expect(promoVerdict(dated, '2026-12-01')).toBe('expired')
  })

  it('today == end 仍 ok', () => {
    expect(promoVerdict(dated, '2026-11-30')).toBe('ok')
  })

  it('not_started', () => {
    expect(promoVerdict(dated, '2026-10-15')).toBe('not_started')
  })

  it('use 起点早于 start → not_started', () => {
    expect(promoVerdict(dated, '2026-11-15', { start: '2026-10-20', end: '2026-11-20' })).toBe(
      'not_started',
    )
  })

  it('use.end > end → expires_before_use_end', () => {
    expect(promoVerdict(dated, '2026-11-15', { start: '2026-11-10', end: '2026-12-05' })).toBe(
      'expires_before_use_end',
    )
  })

  it('use 完全落在窗口内 → ok', () => {
    expect(promoVerdict(dated, '2026-11-15', { start: '2026-11-10', end: '2026-11-20' })).toBe('ok')
  })

  it('顺序：同时过期与 use 超出 → expired', () => {
    expect(promoVerdict(dated, '2026-12-10', { start: '2026-11-10', end: '2026-12-20' })).toBe(
      'expired',
    )
  })
})

describe('matchPoolEntry', () => {
  it('ref 命中', () => {
    const pool: PoolEntryLike[] = [{ ref: 'v1' }]
    expect(matchPoolEntry(pool, 'v1')).toEqual({ kind: 'found', entry: pool[0] })
  })

  it('alias 命中', () => {
    const pool: PoolEntryLike[] = [{ ref: 'v1', alias_refs: ['v2', 'v3'] }]
    expect(matchPoolEntry(pool, 'v3')).toEqual({ kind: 'found', entry: pool[0] })
  })

  it('两条不同条目都含同一别名 → ambiguous', () => {
    const pool: PoolEntryLike[] = [
      { ref: 'v1', alias_refs: ['shared'] },
      { ref: 'v2', alias_refs: ['shared'] },
    ]
    expect(matchPoolEntry(pool, 'shared')).toEqual({ kind: 'ambiguous' })
  })

  it('同一条目 ref 与 alias 都等于 id 不算 ambiguous', () => {
    const pool: PoolEntryLike[] = [{ ref: 'v1', alias_refs: ['v1'] }]
    expect(matchPoolEntry(pool, 'v1')).toEqual({ kind: 'found', entry: pool[0] })
  })

  it('未命中 → none', () => {
    expect(matchPoolEntry([{ ref: 'v1' }], 'v9')).toEqual({ kind: 'none' })
  })

  it('名字/部分相等不命中', () => {
    expect(matchPoolEntry([{ ref: '1234' }], '123')).toEqual({ kind: 'none' })
  })
})

describe('videoVerdicts', () => {
  it('none / ambiguous → undeclared 且 entryRef null', () => {
    const pool: PoolEntryLike[] = [
      { ref: 'v1', alias_refs: ['shared'] },
      { ref: 'v2', alias_refs: ['shared'] },
    ]
    const result = videoVerdicts(pool, ['missing', 'shared'], '2026-11-15')
    expect(result).toEqual([
      { videoId: 'missing', verdict: 'undeclared', entryRef: null },
      { videoId: 'shared', verdict: 'undeclared', entryRef: null },
    ])
  })
})

describe('worstVerdict', () => {
  it('优先级从坏到好', () => {
    expect(worstVerdict(['ok', 'not_started', 'expires_before_use_end', 'undeclared', 'expired'])).toBe(
      'expired',
    )
    expect(worstVerdict(['ok', 'not_started'])).toBe('not_started')
    expect(worstVerdict(['ok', 'expires_before_use_end'])).toBe('expires_before_use_end')
    expect(worstVerdict(['ok', 'undeclared'])).toBe('undeclared')
  })

  it('空数组 → ok', () => {
    expect(worstVerdict([])).toBe('ok')
  })
})

describe('endOfNzDayMs', () => {
  it('2026-11-30 → NZDT +13', () => {
    expect(endOfNzDayMs('2026-11-30')).toBe(Date.UTC(2026, 10, 30, 10, 59, 59))
  })

  it('2026-07-01 → NZST +12', () => {
    expect(endOfNzDayMs('2026-07-01')).toBe(Date.UTC(2026, 6, 1, 11, 59, 59))
  })
})

describe('promoEndCapMs', () => {
  it('两条 dated 取最早', () => {
    const pool: PoolEntryLike[] = [
      { ref: 'v1', promo_window: { kind: 'dated', start: '2026-11-01', end: '2026-11-30' } },
      { ref: 'v2', promo_window: { kind: 'dated', start: '2026-11-01', end: '2026-11-15' } },
    ]
    expect(promoEndCapMs(pool, ['v1', 'v2'])).toBe(endOfNzDayMs('2026-11-15'))
  })

  it('含 evergreen 与未命中的忽略', () => {
    const pool: PoolEntryLike[] = [
      { ref: 'v1', promo_window: { kind: 'evergreen' } },
      { ref: 'v2', promo_window: { kind: 'dated', start: '2026-11-01', end: '2026-11-20' } },
    ]
    expect(promoEndCapMs(pool, ['v1', 'v2', 'missing'])).toBe(endOfNzDayMs('2026-11-20'))
  })

  it('全无 dated → null', () => {
    const pool: PoolEntryLike[] = [{ ref: 'v1', promo_window: { kind: 'evergreen' } }]
    expect(promoEndCapMs(pool, ['v1'])).toBeNull()
  })
})

describe('nzToday', () => {
  it('UTC 11/29 12:00 = 新西兰 11/30 01:00', () => {
    expect(nzToday(Date.UTC(2026, 10, 29, 12, 0, 0))).toBe('2026-11-30')
  })

  it('endOfNzDayMs 夏令时切换日也是当天 23:59:59（新西兰本地）', () => {
    // 2026-09-27 02:00 夏令时开始；2027-04-04 03:00 夏令时结束
    expect(endOfNzDayMs('2026-09-26')).toBe(Date.UTC(2026, 8, 26, 11, 59, 59)) // 仍是 +12
    expect(endOfNzDayMs('2026-09-27')).toBe(Date.UTC(2026, 8, 27, 10, 59, 59)) // 已是 +13
    expect(endOfNzDayMs('2027-04-03')).toBe(Date.UTC(2027, 3, 3, 10, 59, 59))  // 仍是 +13
    expect(endOfNzDayMs('2027-04-04')).toBe(Date.UTC(2027, 3, 4, 11, 59, 59))  // 已是 +12
    for (const day of ['2026-09-26', '2026-09-27', '2027-04-03', '2027-04-04']) {
      const ms = endOfNzDayMs(day)
      expect(nzToday(ms)).toBe(day)          // 这一刻还在当天
      expect(nzToday(ms + 1000)).not.toBe(day) // 再过一秒就是第二天
    }
  })
})
