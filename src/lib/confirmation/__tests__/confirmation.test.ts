import { describe, it, expect } from 'vitest'
import { validateConfirmation, parseConfirmation, splitLines } from '@/lib/confirmation/validate'
import { emptyConfirmation, sampleConfirmation } from '@/lib/confirmation/defaults'

describe('validateConfirmation', () => {
  it('accepts the example', () => {
    expect(validateConfirmation(sampleConfirmation())).toEqual([])
  })

  it('rejects a tour code typed with a space, accepts other code styles', () => {
    const d = { ...sampleConfirmation(), tourCode: 'CTS 4270729' }
    expect(validateConfirmation(d).join()).toContain('团号格式')
    expect(validateConfirmation({ ...d, tourCode: '' }).join()).toContain('团号必填')
    expect(validateConfirmation({ ...sampleConfirmation(), tourCode: 'ABC-2027-01' })).toEqual([])
  })

  it('flags day rows with missing date or route so a half-filled itinerary cannot be sent to a client', () => {
    const d = sampleConfirmation()
    d.days[1] = { ...d.days[1], date: '', route: '' }
    const errs = validateConfirmation(d)
    expect(errs).toContain('第 2 天缺日期')
    expect(errs).toContain('第 2 天缺路线')
  })

  it('requires an emergency phone when a contact name is given', () => {
    const d = sampleConfirmation()
    d.emergencyContacts = [{ name: 'Lucy', mobile: '' }]
    expect(validateConfirmation(d).join()).toContain('缺电话')
  })

  it('blank template needs filling in before generating', () => {
    expect(validateConfirmation(emptyConfirmation()).length).toBeGreaterThan(0)
  })
})

describe('splitLines', () => {
  it('drops blank lines and trims', () => {
    expect(splitLines(' a \r\n\n b\n')).toEqual(['a', 'b'])
  })
})

describe('tenant-neutral defaults', () => {
  it('blank template carries no operator, phone numbers or dated claims from any one client', () => {
    const json = JSON.stringify(emptyConfirmation())
    expect(json).not.toMatch(/Wuxi|0086\d|86-510|Lucy|Summer Gao/)
    expect(json).not.toMatch(/until the end of 2026/)
    expect(json).not.toMatch(/Late July/)
  })

  it('tip amounts cannot contradict the exclusions line (no NZD figure in the defaults)', () => {
    expect(JSON.stringify(emptyConfirmation())).not.toMatch(/\d+ NZD/)
  })
})

describe('parseConfirmation', () => {
  it('accepts a full document', () => {
    expect(parseConfirmation(JSON.parse(JSON.stringify(sampleConfirmation()))).ok).toBe(true)
  })

  it.each([
    ['null', null],
    ['days containing null', { ...sampleConfirmation(), days: [null] }],
    ['tip without body', { ...sampleConfirmation(), tips: [{ title: 'x' }] }],
    ['inclusions not an array', { ...sampleConfirmation(), inclusions: 'a' }],
    ['missing contacts', { ...sampleConfirmation(), emergencyContacts: undefined }],
    ['huge text', { ...sampleConfirmation(), itineraryNote: 'x'.repeat(30_000) }],
  ])('rejects bad data instead of crashing: %s', (_n, input) => {
    expect(parseConfirmation(input).ok).toBe(false)
  })
})
