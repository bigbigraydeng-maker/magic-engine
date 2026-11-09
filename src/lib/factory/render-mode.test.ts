import { describe, expect, it } from 'vitest'
import { isRemotionBrief, renderModeLabel, renderModeOf } from './render-mode'

describe('isRemotionBrief', () => {
  it('returns false for null and undefined', () => {
    expect(isRemotionBrief(null)).toBe(false)
    expect(isRemotionBrief(undefined)).toBe(false)
  })

  it('returns false for primitives', () => {
    expect(isRemotionBrief('x')).toBe(false)
    expect(isRemotionBrief(42)).toBe(false)
  })

  it('returns false for an empty object', () => {
    expect(isRemotionBrief({})).toBe(false)
  })

  it('returns false when remotion is null', () => {
    expect(isRemotionBrief({ remotion: null })).toBe(false)
  })

  it('returns false when remotion is a string', () => {
    expect(isRemotionBrief({ remotion: 'x' })).toBe(false)
  })

  it('returns false when remotion is an array', () => {
    expect(isRemotionBrief({ remotion: [] })).toBe(false)
  })

  it('returns true when remotion is a populated object', () => {
    expect(isRemotionBrief({ remotion: { template: 't', props: {} } })).toBe(true)
  })

  it('returns true when remotion is an empty object', () => {
    expect(isRemotionBrief({ remotion: {} })).toBe(true)
  })
})

describe('renderModeOf', () => {
  it('returns template for remotion briefs', () => {
    expect(renderModeOf({ remotion: { template: 't' } })).toBe('template')
  })

  it('returns recipe for non-remotion briefs', () => {
    expect(renderModeOf({})).toBe('recipe')
    expect(renderModeOf(null)).toBe('recipe')
  })
})

describe('renderModeLabel', () => {
  it('labels remotion briefs as template', () => {
    expect(renderModeLabel({ remotion: { template: 't' } })).toBe('模板出片(remotion)')
  })

  it('labels non-remotion briefs as recipe', () => {
    expect(renderModeLabel({})).toBe('配方出片')
    expect(renderModeLabel(null)).toBe('配方出片')
  })
})
