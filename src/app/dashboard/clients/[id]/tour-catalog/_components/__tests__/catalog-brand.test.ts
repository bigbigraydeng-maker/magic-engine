import { describe, it, expect } from 'vitest'
import {
  FEEDBACK_MAILTO,
  isHexColor,
  relativeLuminance,
  onBrandTextColor,
  brandTheme,
} from '../catalog-brand'

function readVar(style: unknown, name: string): string | undefined {
  return (style as Record<string, string>)[name]
}

describe('isHexColor', () => {
  it('accepts a six-digit hex colour in mixed case', () => {
    expect(isHexColor('#a1B2c3')).toBe(true)
  })

  it('rejects short, named, malformed and non-string values', () => {
    expect(isHexColor('#fff')).toBe(false)
    expect(isHexColor('red')).toBe(false)
    expect(isHexColor('#12345g')).toBe(false)
    expect(isHexColor('')).toBe(false)
    expect(isHexColor(null)).toBe(false)
    expect(isHexColor(123)).toBe(false)
    expect(isHexColor('#1234567')).toBe(false)
    expect(isHexColor('url(x)')).toBe(false)
  })
})

describe('relativeLuminance', () => {
  it('returns 0 for black', () => {
    expect(relativeLuminance('#000000')).toBe(0)
  })

  it('returns 1 for white', () => {
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1)
  })

  it('returns 0 for an invalid colour', () => {
    expect(relativeLuminance('not-a-colour')).toBe(0)
  })
})

describe('onBrandTextColor', () => {
  it('returns white text for a dark colour', () => {
    expect(onBrandTextColor('#336699')).toBe('#FFFFFF')
  })

  it('returns dark text for a very light colour', () => {
    expect(onBrandTextColor('#FFEE88')).toBe('#1A1A1A')
  })
})

describe('brandTheme', () => {
  it('is branded when both logo and primary colour are valid', () => {
    const theme = brandTheme({
      logoUrl: 'https://example.test/logo.png',
      brandPrimary: '#336699',
      brandSecondary: '#FFEE88',
    })
    expect(theme.branded).toBe(true)
    expect(theme.logoUrl).toBe('https://example.test/logo.png')
    expect(readVar(theme.style, '--tc-brand')).toBe('#336699')
    expect(readVar(theme.style, '--tc-accent')).toBe('#336699')
    expect(readVar(theme.style, '--tc-on-brand')).toBe('#FFFFFF')
    expect(readVar(theme.style, '--tc-brand-2')).toBe('#FFEE88')
  })

  it('falls back to the primary colour when the secondary is invalid', () => {
    const theme = brandTheme({
      logoUrl: 'https://example.test/logo.png',
      brandPrimary: '#336699',
      brandSecondary: 'not-a-colour',
    })
    expect(theme.branded).toBe(true)
    expect(readVar(theme.style, '--tc-brand-2')).toBe('#336699')
  })

  it('is neutral when the logo is missing', () => {
    const theme = brandTheme({
      logoUrl: null,
      brandPrimary: '#336699',
      brandSecondary: '#FFEE88',
    })
    expect(theme.branded).toBe(false)
    expect(theme.logoUrl).toBeNull()
    expect(theme.style).toEqual({})
  })

  it('is neutral when the logo is not https', () => {
    const theme = brandTheme({
      logoUrl: 'http://example.test/logo.png',
      brandPrimary: '#336699',
      brandSecondary: '#FFEE88',
    })
    expect(theme.branded).toBe(false)
    expect(theme.style).toEqual({})
  })

  it('is neutral and empty when the primary colour is unsafe', () => {
    const theme = brandTheme({
      logoUrl: 'https://example.test/logo.png',
      brandPrimary: 'red; background:url(x)',
      brandSecondary: '#FFEE88',
    })
    expect(theme.branded).toBe(false)
    expect(theme.style).toEqual({})
  })

  it('is neutral for null settings', () => {
    const theme = brandTheme(null)
    expect(theme.branded).toBe(false)
    expect(theme.logoUrl).toBeNull()
    expect(theme.style).toEqual({})
  })
})

describe('FEEDBACK_MAILTO', () => {
  it('starts with the feedback mailto prefix', () => {
    expect(FEEDBACK_MAILTO.startsWith('mailto:hello@magicengine.cloud?subject=')).toBe(true)
  })
})
