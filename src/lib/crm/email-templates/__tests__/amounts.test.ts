import { describe, expect, it } from 'vitest'
import { extractAmounts } from '@/lib/crm/email-templates/amounts'

describe('extractAmounts', () => {
  it('reads the formats used on the website and in sales emails', () => {
    expect(extractAmounts('From NZD $4,080 per person')).toEqual(['4080'])
    expect(extractAmounts('NZ$7,188 per person from Auckland')).toEqual(['7188'])
    expect(extractAmounts('only $2,699.50 now, was $3,399')).toEqual(['2699.50', '3399'])
  })

  it('drops ".00" and pads one decimal digit', () => {
    expect(extractAmounts('$100.00')).toEqual(['100'])
    expect(extractAmounts('$100.5')).toEqual(['100.50'])
  })

  it('ignores numbers without a dollar marker', () => {
    expect(extractAmounts('15 days, 4 star hotels, 4080 km')).toEqual([])
  })

  it('handles an amount with a space after the dollar sign and several in one line', () => {
    expect(extractAmounts('$ 1,999 or $1999')).toEqual(['1999', '1999'])
  })
})
