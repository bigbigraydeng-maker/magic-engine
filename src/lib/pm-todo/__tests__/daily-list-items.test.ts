import { describe, expect, it } from 'vitest'
import { buildDailyListItems, DAILY_LIST_TODO_KIND } from '../daily-list-items'

const from = '2026-11-06'
const to = '2026-11-08'

const dated = (id: string, client: string, day: string, extra: Record<string, unknown> = {}) => ({
  id,
  client_id: client,
  brief: { weekly_pack: { publish_on: day, ...extra } },
})

const nameOf = (id: string) => `客户 ${id}`

describe('buildDailyListItems', () => {
  it('groups two pending orders for one client into a single item', () => {
    const items = buildDailyListItems({
      orders: [dated('o1', 'c1', '2026-11-06'), dated('o2', 'c1', '2026-11-07')],
      grantStatus: new Map(),
      expiredYesterday: new Map(),
      nameOf,
      from,
      to,
    })
    expect(items).toHaveLength(1)
    const item = items[0]
    expect(item.kind).toBe(DAILY_LIST_TODO_KIND)
    expect(item.what).toContain('2 条')
    expect(item.what).toContain('最早 2026-11-06')
    expect(item.href).toContain('/dashboard/clients/c1')
  })

  it('skips orders already handled (armed) but counts missed ones', () => {
    const items = buildDailyListItems({
      orders: [dated('o1', 'c1', '2026-11-06'), dated('o2', 'c1', '2026-11-07')],
      grantStatus: new Map([
        ['o1', 'armed'],
        ['o2', 'missed'],
      ]),
      expiredYesterday: new Map(),
      nameOf,
      from,
      to,
    })
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('1 条')
    expect(items[0].what).toContain('最早 2026-11-07')
  })

  it('skips orders excluded by card', () => {
    const items = buildDailyListItems({
      orders: [
        dated('o1', 'c1', '2026-11-06', {
          excluded_by_card: { at: 'x', by: 'y', reason: 'z' },
        }),
      ],
      grantStatus: new Map(),
      expiredYesterday: new Map(),
      nameOf,
      from,
      to,
    })
    expect(items).toHaveLength(0)
  })

  it('skips orders outside the window or with an invalid date', () => {
    const items = buildDailyListItems({
      orders: [dated('o1', 'c1', '2026-11-09'), dated('o2', 'c1', '11/06')],
      grantStatus: new Map(),
      expiredYesterday: new Map(),
      nameOf,
      from,
      to,
    })
    expect(items).toHaveLength(0)
  })

  it('emits an item for a client with only expired orders', () => {
    const items = buildDailyListItems({
      orders: [],
      grantStatus: new Map(),
      expiredYesterday: new Map([['c2', 3]]),
      nameOf,
      from,
      to,
    })
    expect(items).toHaveLength(1)
    expect(items[0].client_id).toBe('c2')
    expect(items[0].what).toContain('3 条')
    expect(items[0].what).toContain('退回内容池')
  })

  it('mentions both pending and expired counts for the same client', () => {
    const items = buildDailyListItems({
      orders: [dated('o1', 'c1', '2026-11-06')],
      grantStatus: new Map(),
      expiredYesterday: new Map([['c1', 2]]),
      nameOf,
      from,
      to,
    })
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('1 条')
    expect(items[0].what).toContain('另有 2 条')
  })

  it('a revoked version is not counted as waiting (the list blocks that same content)', () => {
    const items = buildDailyListItems({
      orders: [{ id: 'o1', client_id: 'c1', brief: { weekly_pack: { publish_on: '2026-11-06' } } }],
      grantStatus: new Map([['o1', 'revoked']]),
      expiredYesterday: new Map(),
      nameOf: () => 'CTS',
      from: '2026-11-06',
      to: '2026-11-08',
    })
    expect(items).toEqual([])
  })
})

