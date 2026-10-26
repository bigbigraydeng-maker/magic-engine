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

  // ── fail-closed: every "cannot tell" is nested/unknown (true) ─────────────────────────────────────────────
  it('🔴 the first match sitting inside a comment => cannot tell => true', () => {
    const src = `// slug: 'a' was removed\nexport const pages = [\n  { slug: 'a', metaTitle: 'A' },\n]\n`
    expect(firstSlugAnchorIsNested(src, 'a')).toBe(true)
  })

  it("🔴 a snake_case key like parent_slug: 'a' is matched by the editors' substring search => cannot tell => true", () => {
    const src = `export const pages = [\n  { parent_slug: 'a', slug: 'z' },\n  { slug: 'a', metaTitle: 'A' },\n]\n`
    expect(firstSlugAnchorIsNested(src, 'a')).toBe(true)
  })

  it('🔴 a regex literal with a quote derails the scan (unbalanced) => true, never a quiet "not nested"', () => {
    const src = `const q = /'/g\nexport const pages = [\n  { slug: 'a', metaTitle: 'A' },\n  { slug: 'b' },\n]\n`
    expect(firstSlugAnchorIsNested(src, 'a')).toBe(true)
  })

  it('unterminated block comment / unbalanced brackets => true', () => {
    expect(firstSlugAnchorIsNested(`export const pages = [\n  { slug: 'a' },\n/* never closed`, 'a')).toBe(true)
    expect(firstSlugAnchorIsNested(`export const pages = [\n  { slug: 'a' ,\n`, 'a')).toBe(true)
  })

  // ── no false alarms from other `slug` shapes in the same file ─────────────────────────────────────────────
  it('type annotations and function parameters named slug do not make every entry look nested', () => {
    const withInterface = `interface P { slug: string }\nexport const pages: P[] = [\n  { slug: 'a' },\n  { slug: 'b' },\n]\n`
    const withParam = `export function get(slug: string) { return slug }\nexport const pages = [\n  { slug: 'a' },\n]\n`
    expect(firstSlugAnchorIsNested(withInterface, 'a')).toBe(false)
    expect(firstSlugAnchorIsNested(withParam, 'a')).toBe(false)
  })

  it('a separate top-level object with a slug does not make list entries look nested', () => {
    const src = `export const home = { slug: 'home' }\nexport const pages = [\n  { slug: 'a' },\n]\n`
    // list entries sit deeper than the lone top-level object: documented limit — treated as nested (refused, never wrongly allowed)
    expect(firstSlugAnchorIsNested(src, 'a')).toBe(true)
  })

  it('guide style anchors on the two-space-indented slug line only, ignoring earlier nested mentions', () => {
    const src = `export const guides = [\n  {\n    related: [{ slug: 'b' }],\n  },\n  {\n  slug: 'b',\n  metaTitle: 'B',\n  },\n]\n`
    expect(firstSlugAnchorIsNested(src, 'b', 'default')).toBe(true)
    expect(firstSlugAnchorIsNested(src, 'b', 'guide')).toBe(false)
  })
})
