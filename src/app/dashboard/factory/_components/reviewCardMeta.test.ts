import { expect, it } from 'vitest'
import { formatDuration, groupCounts, OTHER_GROUP, parseAngle } from './reviewCardMeta'

it('splits angle into group / seq / hook and builds a readable title', () => {
  const p = parseAngle("Best of China #2: 'four cities, one trip'")
  expect(p.group).toBe('Best of China')
  expect(p.seq).toBe(2)
  expect(p.hook).toBe("'four cities, one trip'")
  expect(p.title).toBe("Best of China · 第2条 · 'four cities, one trip'")
})

it('handles ampersand groups and full-width colon', () => {
  expect(parseAngle('Shanghai & Surroundings #10：water towns').group).toBe('Shanghai & Surroundings')
})

it('falls back to 其它 with the raw angle as title', () => {
  const p = parseAngle('something free-form')
  expect(p.group).toBe(OTHER_GROUP)
  expect(p.title).toBe('something free-form')
  expect(parseAngle(null).title).toBe('(未命名角度)')
})

it('groupCounts keeps first-seen order and puts 其它 last', () => {
  expect(groupCounts(['x', 'A #1: a', 'B #1: b', 'A #2: c'])).toEqual([
    { group: 'A', count: 2 }, { group: 'B', count: 1 }, { group: OTHER_GROUP, count: 1 },
  ])
})

it('formatDuration', () => {
  expect(formatDuration(34.4)).toBe('0:34')
  expect(formatDuration(75)).toBe('1:15')
  expect(formatDuration(undefined)).toBe('--')
})
