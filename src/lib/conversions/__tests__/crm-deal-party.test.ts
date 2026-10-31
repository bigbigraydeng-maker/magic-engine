import { describe, expect, it } from 'vitest'
import { choosePartySize, legalPartySize, partySizeFromFacts, partySizesInText } from '../crm-deal-party'

describe('stored party size', () => {
  it('accepts a whole number from 1 to 60 and nothing else', () => {
    expect(legalPartySize(2)).toBe(2)
    expect(legalPartySize(1)).toBe(1)
    expect(legalPartySize(60)).toBe(60)
    expect(legalPartySize(0)).toBeNull()
    expect(legalPartySize(61)).toBeNull()
    expect(legalPartySize(2.5)).toBeNull()
    expect(legalPartySize('2')).toBeNull()
  })

  it('reads one headcount from a follow-up or a short mail preview', () => {
    expect(partySizesInText('Deposit received for 4 pax')).toEqual([4])
    expect(partySizesInText('party of 2, departing March')).toEqual([2])
    expect(partySizesInText('一共 3 位客人')).toEqual([3])
    expect(partySizesInText('2人同行')).toEqual([2])
    expect(partySizesInText('thanks')).toEqual([])
  })

  it('does not guess when one note names two counts or two notes disagree', () => {
    expect(partySizesInText('2 adults and 1 child, 3 pax')).toEqual([2, 1, 3])
    expect(choosePartySize(null, [[2], [4]])).toBeNull()
    expect(choosePartySize(null, [[2, 4]])).toBeNull()
    expect(choosePartySize(null, [[], []])).toBeNull()
    expect(choosePartySize(2, [[4]])).toBe(2)
    expect(choosePartySize(null, [[3], [3]])).toBe(3)
  })

  it('does not treat an adult and child split as the total headcount', () => {
    expect(partySizesInText('2 adults')).toEqual([2])
    expect(partySizesInText('2 adults and 1 child')).toEqual([2, 1])
    expect(partySizesInText('2 adults and 2 children')).toEqual([2, 2])
    expect(choosePartySize(null, [partySizesInText('2 adults and 1 child')])).toBeNull()
    expect(choosePartySize(null, [partySizesInText('2 adults and 2 children')])).toBeNull()
    expect(choosePartySize(null, [partySizesInText('2 adults and 1 child'), [4]])).toBeNull()
  })

  it('reads party_size from a call fact and ignores other keys', () => {
    expect(partySizeFromFacts({ party_size: 5 })).toBe(5)
    expect(partySizeFromFacts({ party_size: 0 })).toBeNull()
    expect(partySizeFromFacts({ guests: 5 })).toBeNull()
    expect(partySizeFromFacts(null)).toBeNull()
    const stored = [
      { key: 'travel_window', value: 'March', quote: 'in March', confidence: 0.9 },
      { key: 'party_size', value: '4', quote: 'about four people', confidence: 0.8 },
    ]
    expect(partySizeFromFacts(stored)).toBe(4)
    expect(partySizeFromFacts([{ key: 'party_size', value: '4' }, { key: 'party_size', value: '5' }])).toBeNull()
    expect(partySizeFromFacts([{ key: 'budget', value: '200' }])).toBeNull()
    expect(partySizeFromFacts([])).toBeNull()
    expect(partySizeFromFacts([{ key: 'party_size', value: '三个人' }])).toBeNull()
  })
})
