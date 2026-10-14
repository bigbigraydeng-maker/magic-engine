import { expect, it } from 'vitest'
import { cardDetails, cardLabel } from './cardLabel'

it('builds 客户｜团名｜第N条｜版本', () => {
  expect(cardLabel('CTS', 'Grand Tour #3: 开头钩子', 'v2 loudness 74 window')).toBe('CTS｜Grand Tour｜第3条｜v2')
})
it('omits missing seq and version', () => {
  expect(cardLabel('CTS', '随便一个角度', 'why')).toBe('CTS｜随便一个角度')
})
it('details keep hook and note, deduped', () => {
  expect(cardDetails('G #1: hook', 'note')).toEqual(['hook', 'note'])
  expect(cardDetails('plain', 'plain')).toEqual(['plain'])
})
