import { describe, expect, it } from 'vitest'

import { buildWeekPackTodoItems, pushWeekPackItems, readHandledPack, type WeekPackTodoSource } from '../week-pack-items'
import { weekPackSubject } from '@/lib/social/week-pack/facts'

const CLIENT = '11111111-1111-4111-8111-111111111111'
const FRIDAY_NZ = new Date('2026-11-05T21:00:00.000Z')
const MONDAY_NZ = new Date('2026-11-08T21:00:00.000Z')

function source(overrides: Partial<WeekPackTodoSource> = {}): WeekPackTodoSource {
  return {
    configs: [{ id: CLIENT, name: '示例客户', config: null }],
    pending: [],
    handled: [],
    held: [],
    ...overrides,
  }
}

describe('week pack todos', () => {
  it('stays quiet while the switch is off', () => {
    expect(buildWeekPackTodoItems(source(), FRIDAY_NZ, false)).toEqual([])
  })

  it('asks for the pack on the approve day, and says unreadable instead of nothing', () => {
    const due = buildWeekPackTodoItems(source(), FRIDAY_NZ, true)
    expect(due.map((item) => item.kind)).toEqual(['week_pack_needs_approval'])
    expect(due[0].href).toContain('#approve-week')
    expect(due[0].what).toContain('还没批')
    const quiet = buildWeekPackTodoItems(source(), MONDAY_NZ, true)
    expect(quiet).toEqual([])
    const unread = buildWeekPackTodoItems(source({ pending: 'unread' }), MONDAY_NZ, true)
    expect(unread[0].what).toContain('读不到')
    expect(unread[0].what).not.toContain('没有人待批的 0')
  })

  it('surfaces held rows without rolling the pack back in the wording', () => {
    const items = buildWeekPackTodoItems(source({
      held: [{ clientId: CLIENT, stories: 2, reels: 1 }],
    }), MONDAY_NZ, true)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('week_pack_items_held')
    expect(items[0].what).toContain('单独拦下 3 条')
    expect(items[0].how).toContain('视频工厂')
    expect(items[0].href).toContain('/story')
  })

  it('does not remind when this week was already approved or turned down', () => {
    const subject = weekPackSubject(CLIENT, '2026-11-09')
    const approved = buildWeekPackTodoItems(source({
      handled: [{ clientId: CLIENT, subjectKey: subject }],
    }), FRIDAY_NZ, true)
    expect(approved.filter((item) => item.kind === 'week_pack_needs_approval')).toEqual([])
    const otherWeek = buildWeekPackTodoItems(source({
      handled: [{ clientId: CLIENT, subjectKey: weekPackSubject(CLIENT, '2026-11-02') }],
    }), FRIDAY_NZ, true)
    expect(otherWeek.map((item) => item.kind)).toEqual(['week_pack_needs_approval'])
    expect(readHandledPack({
      clientId: CLIENT, status: 'authorized', subjectKey: subject, reason: '',
    })?.subjectKey).toBe(subject)
    expect(readHandledPack({
      clientId: CLIENT, status: 'denied', subjectKey: subject, reason: 'OPC不做',
    })).not.toBeNull()
    expect(readHandledPack({
      clientId: CLIENT, status: 'denied', subjectKey: subject, reason: '过了 30 分钟没人点，这张卡作废了',
    })).toBeNull()
    expect(readHandledPack({
      clientId: CLIENT, status: 'denied', subjectKey: subject, reason: '要确认的内容变了，这张旧卡作废',
    })).toBeNull()
  })

  it('does not touch the database when the switch is off', async () => {
    const supabase = { from: () => { throw new Error('should not query') } }
    const bucket: unknown[] = []
    await pushWeekPackItems(supabase as never, bucket as never, FRIDAY_NZ, () => '示例客户', {}, [CLIENT])
    expect(bucket).toEqual([])
  })
})
