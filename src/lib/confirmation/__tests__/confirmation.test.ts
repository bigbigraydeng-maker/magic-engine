import { describe, it, expect } from 'vitest'
import { validateConfirmation, splitLines } from '@/lib/confirmation/validate'
import { emptyConfirmation, sampleConfirmation } from '@/lib/confirmation/defaults'

describe('validateConfirmation', () => {
  it('accepts the real CTS4270729 example', () => {
    expect(validateConfirmation(sampleConfirmation())).toEqual([])
  })

  it('rejects a tour code typed with a space or wrong prefix (source file once carried two codes)', () => {
    const d = { ...sampleConfirmation(), tourCode: 'CTS 4270729' }
    expect(validateConfirmation(d).join()).toContain('团号格式')
    expect(validateConfirmation({ ...d, tourCode: '' }).join()).toContain('团号必填')
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
