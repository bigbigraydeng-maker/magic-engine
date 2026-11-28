import { describe, expect, it } from 'vitest'
import { maskChinaPhone, normalizeChinaPhone } from '../china-phone'

describe('China phone normalization', () => {
  it.each([
    ['13800001380', '+8613800001380'],
    ['+86 138 0000 1380', '+8613800001380'],
    ['0086-138-0000-1380', '+8613800001380'],
    ['8613800001380', '+8613800001380'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeChinaPhone(input)).toBe(expected)
  })

  it.each(['', '+1 202 555 0123', '12800001380', '1380000138', '138000013800'])('rejects %s', input => {
    expect(normalizeChinaPhone(input)).toBeNull()
  })

  it('masks a linked phone for display', () => {
    expect(maskChinaPhone('+8613800001380')).toBe('+86 138****1380')
  })
})
