import { describe, expect, it } from 'vitest'
import { firstSlugAnchorIsNested } from '../slug-anchor'

const FLAT = `export const pages = [\n  { slug: 'a', metaTitle: 'A' },\n  { slug: 'b', metaTitle: 'B' },\n]\n`

describe('firstSlugAnchorIsNested', () => {
  it('a plain top-level entry is not nested', () => {
    expect(firstSlugAnchorIsNested(FLAT, 'a')).toBe(false)
    expect(firstSlugAnchorIsNested(FLAT, 'b')).toBe(false)
  })

  it('🔴 a slug that first appears as a reference inside another entry IS nested (edit would land in that other entry)', () => {
    const src = `export const pages = [\n  { slug: 'a', metaTitle: 'A', related: [{ slug: 'b' }] },\n  { slug: 'b', metaTitle: 'B' },\n]\n`
    expect(firstSlugAnchorIsNested(src, 'b')).toBe(true)
    expect(firstSlugAnchorIsNested(src, 'a')).toBe(false)
  })

  it('a later nested reference does not matter when the FIRST anchor is the entry itself (that is where the patcher edits)', () => {
    const src = `export const pages = [\n  { slug: 'b', metaTitle: 'B' },\n  { slug: 'a', related: [{ slug: 'b' }] },\n]\n`
    expect(firstSlugAnchorIsNested(src, 'b')).toBe(false)
  })

  it('a slug referenced only from a nested position, defined nowhere in this file, is nested', () => {
    const src = `export const pages = [\n  { slug: 'a', related: [{ slug: 'ext' }] },\n]\n`
    expect(firstSlugAnchorIsNested(src, 'ext')).toBe(true)
  })

  it('brackets inside strings and comments do not confuse the depth count', () => {
    const src = `// [ [ {\nexport const pages = [\n  { slug: 'a', note: "}}}]]]", other: 'x[' },\n  /* { { { */ { slug: 'b' },\n]\n`
    expect(firstSlugAnchorIsNested(src, 'a')).toBe(false)
    expect(firstSlugAnchorIsNested(src, 'b')).toBe(false)
  })

  it('unknown slug => false (the "not found" case is reported elsewhere)', () => {
    expect(firstSlugAnchorIsNested(FLAT, 'nope')).toBe(false)
  })

  it('works for a wrapper object around the list (every entry one level deeper is still top-level)', () => {
    const src = `export const data = { pages: [\n  { slug: 'a' },\n  { slug: 'b' },\n] }\n`
    expect(firstSlugAnchorIsNested(src, 'a')).toBe(false)
  })
})
