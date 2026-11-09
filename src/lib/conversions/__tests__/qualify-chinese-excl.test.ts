import { describe, it, expect } from 'vitest'
import { qualifyByNotes, qualifyByConversation } from '@/lib/conversions/cts-crm-sheet-sync'

/**
 * G2b — 中文排除词必须压倒中文兴趣词。
 *
 * 这几条样例都是「同一句话里既有兴趣词又有否定词」：员工记录里常见
 * "感兴趣，但暂时不去" 这种写法。排除词（不感兴趣 / 暂时不去 / 暂不 /
 * 不考虑 / 不打算 …）必须压倒兴趣词，否则会把一个明确说不去的人当成
 * 合格线索发给 Meta——发出去撤不回。
 */

const EXCLUDED_SAMPLES: readonly string[] = [
  '感兴趣，但暂时不去',
  '没兴趣想去明年',
  '客人说暂不考虑',
  '不打算去了',
]

describe('qualifyByNotes — 中文排除词压倒兴趣词', () => {
  for (const sample of EXCLUDED_SAMPLES) {
    it(`excluded: ${sample}`, () => {
      expect(qualifyByNotes(sample)).toBe('excluded')
    })
  }

  it('qualified: 客人很感兴趣，明年想去', () => {
    expect(qualifyByNotes('客人很感兴趣，明年想去')).toBe('qualified')
  })
})

describe('qualifyByConversation — 中文排除词压倒兴趣词', () => {
  for (const sample of EXCLUDED_SAMPLES) {
    it(`excluded: ${sample}`, () => {
      expect(qualifyByConversation(sample)).toBe('excluded')
    })
  }
})
