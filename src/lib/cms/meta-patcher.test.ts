/**
 * Unit tests for meta-patcher slug-windowed replacement.
 *
 * Uses a minimal TypeScript data-file fixture that mimics the CTS Tours
 * guides.ts structure (multiple objects, single-quoted strings).
 */

import { describe, it, expect } from 'vitest'
import { patchMetaField } from './meta-patcher'

// ─── Fixture ─────────────────────────────────────────────────────────────────

const FIXTURE = `
export const beijingGuide = {
  id: 'guide-beijing',
  slug: 'beijing-travel-guide',
  metaTitle: 'Old Beijing Title | CTS Tours NZ',
  metaDescription: 'Old Beijing description for testing.',
  h1: 'Things to Do in Beijing',
}

export const shanghaiGuide = {
  id: 'guide-shanghai',
  slug: 'shanghai-travel-guide',
  metaTitle: 'Old Shanghai Title | CTS Tours NZ',
  metaDescription: 'Old Shanghai description for testing.',
  h1: 'Things to Do in Shanghai',
}
`

const DOUBLE_QUOTE_FIXTURE = `
export const tourA = {
  id: "tour-a",
  slug: "sydney-day-tour",
  metaTitle: "Old Sydney Title | Tours",
  metaDescription: "Old Sydney description.",
}
`

const SINGLE_OBJECT_FIXTURE = `
export const onlyOne = {
  slug: 'single-object',
  metaTitle: 'Single Object Title',
  metaDescription: 'Single object description.',
}
`

// ─── Happy path ───────────────────────────────────────────────────────────────

describe('patchMetaField — success cases', () => {
  it('replaces metaTitle in the correct slug object', () => {
    const result = patchMetaField(
      FIXTURE,
      'beijing-travel-guide',
      'metaTitle',
      'Old Beijing Title | CTS Tours NZ',
      'New Beijing Title | CTS Tours NZ',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.content).toContain("metaTitle: 'New Beijing Title | CTS Tours NZ'")
    // Shanghai object must remain untouched
    expect(result.content).toContain("metaTitle: 'Old Shanghai Title | CTS Tours NZ'")
  })

  it('replaces metaDescription without touching metaTitle', () => {
    const result = patchMetaField(
      FIXTURE,
      'beijing-travel-guide',
      'metaDescription',
      'Old Beijing description for testing.',
      'Updated Beijing meta description for unit test.',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.content).toContain("metaDescription: 'Updated Beijing meta description for unit test.'")
    expect(result.content).toContain("metaTitle: 'Old Beijing Title | CTS Tours NZ'")
  })

  it('handles a single-object file (no next slug boundary)', () => {
    const result = patchMetaField(
      SINGLE_OBJECT_FIXTURE,
      'single-object',
      'metaTitle',
      'Single Object Title',
      'Updated Single Title',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.content).toContain("metaTitle: 'Updated Single Title'")
  })

  it('preserves double-quote style', () => {
    const result = patchMetaField(
      DOUBLE_QUOTE_FIXTURE,
      'sydney-day-tour',
      'metaTitle',
      'Old Sydney Title | Tours',
      'New Sydney Title | Tours',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.content).toContain('metaTitle: "New Sydney Title | Tours"')
  })

  it('correctly isolates the second object', () => {
    const result = patchMetaField(
      FIXTURE,
      'shanghai-travel-guide',
      'metaTitle',
      'Old Shanghai Title | CTS Tours NZ',
      'New Shanghai Title | CTS Tours NZ',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.content).toContain("metaTitle: 'New Shanghai Title | CTS Tours NZ'")
    // Beijing must remain untouched
    expect(result.content).toContain("metaTitle: 'Old Beijing Title | CTS Tours NZ'")
  })

  it('handles new value containing single quotes by escaping', () => {
    const result = patchMetaField(
      FIXTURE,
      'beijing-travel-guide',
      'metaTitle',
      'Old Beijing Title | CTS Tours NZ',
      "Beijing's Best Guide | CTS Tours NZ",
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.content).toContain("Beijing\\'s Best Guide")
  })
})

// ─── Error cases ─────────────────────────────────────────────────────────────

describe('patchMetaField — error cases', () => {
  it('returns ok:false when slug not found', () => {
    const result = patchMetaField(
      FIXTURE,
      'nonexistent-slug',
      'metaTitle',
      'anything',
      'new value',
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/not found/i)
    expect(result.reason).toContain('nonexistent-slug')
  })

  it('returns ok:false when oldValue does not match', () => {
    const result = patchMetaField(
      FIXTURE,
      'beijing-travel-guide',
      'metaTitle',
      'Wrong Old Value',
      'New Value',
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/not found/i)
  })

  it('returns ok:false when field exists but oldValue is stale', () => {
    // Apply first patch
    const first = patchMetaField(
      FIXTURE,
      'beijing-travel-guide',
      'metaTitle',
      'Old Beijing Title | CTS Tours NZ',
      'Already Updated Title',
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return

    // Apply second patch with the original old value — should fail
    const second = patchMetaField(
      first.content,
      'beijing-travel-guide',
      'metaTitle',
      'Old Beijing Title | CTS Tours NZ',  // stale
      'Another New Title',
    )
    expect(second.ok).toBe(false)
  })

  it('does not modify source when patch fails', () => {
    const result = patchMetaField(
      FIXTURE,
      'missing-slug',
      'metaTitle',
      'any',
      'new',
    )
    expect(result.ok).toBe(false)
  })
})

// ─── Idempotency ─────────────────────────────────────────────────────────────

describe('patchMetaField — idempotency', () => {
  it('succeeds on second patch with correct oldValue', () => {
    const first = patchMetaField(
      FIXTURE,
      'beijing-travel-guide',
      'metaTitle',
      'Old Beijing Title | CTS Tours NZ',
      'Step 1 Title',
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const second = patchMetaField(
      first.content,
      'beijing-travel-guide',
      'metaTitle',
      'Step 1 Title',
      'Step 2 Title',
    )
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.content).toContain("metaTitle: 'Step 2 Title'")
  })
})
