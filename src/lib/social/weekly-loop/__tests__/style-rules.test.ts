import { describe, expect, it } from 'vitest'
import { styleOf, styleViolation, stylePenalty, type EntryStyle } from '../style-rules'

const st = (over: Partial<EntryStyle> = {}): EntryStyle => ({ template: 'postcard', music: 'a', variantGroup: 'g1', signature: 'postcard|#B61E2E|3', ...over })
const at = (publishOn: string, style: Partial<EntryStyle> = {}) => ({ publishOn, style: st({ variantGroup: `o${publishOn}`, music: `m${publishOn}`, ...style }) })

describe('styleOf', () => {
  it('normalises the track, uses the original id as variant group, builds the visual signature', () => {
    expect(styleOf({ id: 'abcdef12-xx', template: 'list', music: 'music/Jade_River.mp3', scenes: 3, brandColor: '#B61E2E', variantOf: null })).toEqual({
      template: 'list', music: 'jade-river', variantGroup: 'abcdef12', signature: 'list|#B61E2E|3',
    })
    expect(styleOf({ id: 'abcdef12-xx', template: 'list', music: null, scenes: null, brandColor: null, variantOf: 'base0001' })).toMatchObject({ music: null, variantGroup: 'base0001', signature: null })
  })
})

describe('styleViolation', () => {
  it('the same track within 7 days is refused, 7 or more days apart is fine', () => {
    expect(styleViolation(st({ music: 'a' }), '2026-11-10', [at('2026-11-05', { music: 'a', template: 'x' })])).toBe('music_repeat')
    expect(styleViolation(st({ music: 'a' }), '2026-11-12', [at('2026-11-05', { music: 'a', template: 'x' })])).toBeNull()
  })

  it('a variant of the same original within 7 days is refused (either side), a week later is fine', () => {
    const placed = [{ publishOn: '2026-11-10', style: st({ variantGroup: 'base', music: 'z', template: 'x' }) }]
    expect(styleViolation(st({ variantGroup: 'base', music: 'q' }), '2026-11-06', placed)).toBe('variant_crowd')
    expect(styleViolation(st({ variantGroup: 'base', music: 'q' }), '2026-11-17', placed)).toBe('variant_crowd')
    expect(styleViolation(st({ variantGroup: 'base', music: 'q' }), '2026-11-18', placed)).toBeNull()
  })

  it('a third same-template reel in a row is refused, counting both sides of the slot', () => {
    const run = [at('2026-11-05'), at('2026-11-06')]
    expect(styleViolation(st({ music: 'n', variantGroup: 'n' }), '2026-11-07', run)).toBe('template_run')
    const around = [at('2026-11-05'), at('2026-11-07')]
    expect(styleViolation(st({ music: 'n', variantGroup: 'n' }), '2026-11-06', around)).toBe('template_run')
    expect(styleViolation(st({ music: 'n', variantGroup: 'n', template: 'list' }), '2026-11-07', run)).toBeNull()
  })

  it('a gap of more than 2 days ends a run; a placement with unknown template breaks it', () => {
    const far = [at('2026-11-01'), at('2026-11-02')]
    expect(styleViolation(st({ music: 'n', variantGroup: 'n' }), '2026-11-06', far)).toBeNull()
    const unknownBetween = [at('2026-11-05'), { publishOn: '2026-11-06', style: st({ template: null, music: 'u', variantGroup: 'u' }) }]
    expect(styleViolation(st({ music: 'n', variantGroup: 'n' }), '2026-11-07', unknownBetween)).toBeNull()
  })

  it('same track 6 days apart is refused', () => {
    expect(styleViolation(st({ music: 'a' }), '2026-11-11', [at('2026-11-05', { music: 'a', template: 'x' })])).toBe('music_repeat')
  })

  it('a reel with no style data is never held back', () => {
    expect(styleViolation(null, '2026-11-07', [at('2026-11-06')])).toBeNull()
    expect(styleViolation(st({ template: null, music: null, variantGroup: null }), '2026-11-07', [at('2026-11-06')])).toBeNull()
  })

  it('placements without style data do not count as repeats', () => {
    expect(styleViolation(st(), '2026-11-07', [{ publishOn: '2026-11-06' }, { publishOn: '2026-11-05', style: null }])).toBeNull()
  })
})

describe('stylePenalty', () => {
  it('prefers a different template from both neighbours, then a different visual signature', () => {
    const placed = [at('2026-11-06', { template: 'postcard' })]
    expect(stylePenalty(st({ template: 'postcard' }), '2026-11-07', placed)).toBeGreaterThan(stylePenalty(st({ template: 'list' }), '2026-11-07', placed))
    const same = [{ publishOn: '2026-11-06', style: st({ template: 'list', signature: 'list|#B61E2E|3' }) }]
    expect(stylePenalty(st({ template: 'postcard', signature: 'list|#B61E2E|3' }), '2026-11-07', same)).toBe(1)
    expect(stylePenalty(null, '2026-11-07', placed)).toBe(0)
  })
})
