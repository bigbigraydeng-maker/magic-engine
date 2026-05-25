import { describe, expect, it } from 'vitest'
import { sanitizeHtml, stripLeadingH1, prepareCmsContent } from './html-sanitizer'

// ─── sanitizeHtml — JSON-LD preservation (Bug 3 regression) ─────────────────

describe('sanitizeHtml — JSON-LD preservation', () => {
  it('preserves <script type="application/ld+json"> blocks', () => {
    const html = `<p>Hello</p><script type="application/ld+json">{"@type":"BlogPosting"}</script>`
    expect(sanitizeHtml(html)).toContain('application/ld+json')
    expect(sanitizeHtml(html)).toContain('@type')
  })

  it('strips regular <script> blocks', () => {
    const html = `<p>Hello</p><script>alert(1)</script>`
    expect(sanitizeHtml(html)).not.toContain('<script')
    expect(sanitizeHtml(html)).not.toContain('alert')
  })

  it('strips <script type="text/javascript"> blocks', () => {
    const html = `<p>Hello</p><script type="text/javascript">alert(1)</script>`
    expect(sanitizeHtml(html)).not.toContain('<script')
  })

  it('preserves JSON-LD alongside other safe content', () => {
    const schema = `{"@context":"https://schema.org","@type":"BlogPosting","headline":"Test"}`
    const html = `<h1>Test</h1><p>Body</p><script type="application/ld+json">${schema}</script>`
    const result = sanitizeHtml(html)
    expect(result).toContain('<h1>Test</h1>')
    expect(result).toContain('<p>Body</p>')
    expect(result).toContain('application/ld+json')
  })
})

// ─── stripLeadingH1 (Bug 2 — H1 duplicate prevention) ───────────────────────

describe('stripLeadingH1', () => {
  it('removes the first H1 tag', () => {
    const html = '<h1>My Title</h1><p>Body</p>'
    expect(stripLeadingH1(html)).toBe('<p>Body</p>')
  })

  it('removes H1 with attributes', () => {
    const html = '<h1 class="hero-title">My Title</h1><p>Body</p>'
    expect(stripLeadingH1(html)).toBe('<p>Body</p>')
  })

  it('removes multi-line H1', () => {
    const html = '<h1>My\nTitle</h1><p>Body</p>'
    expect(stripLeadingH1(html)).toBe('<p>Body</p>')
  })

  it('does not touch H2 or other headings', () => {
    const html = '<h2>Section</h2><p>Body</p>'
    expect(stripLeadingH1(html)).toBe('<h2>Section</h2><p>Body</p>')
  })

  it('leaves content unchanged if no H1 present', () => {
    const html = '<p>No heading here</p>'
    expect(stripLeadingH1(html)).toBe('<p>No heading here</p>')
  })

  it('only removes the first H1 if multiple exist', () => {
    const html = '<h1>First</h1><p>Body</p><h1>Second</h1>'
    const result = stripLeadingH1(html)
    expect(result).not.toContain('First')
    expect(result).toContain('Second')
  })

  it('trims leading whitespace after stripping H1', () => {
    const html = '<h1>Title</h1>\n\n<p>Body</p>'
    expect(stripLeadingH1(html)).toBe('<p>Body</p>')
  })
})

// ─── prepareCmsContent — Layer-2 pipeline (Bug 4) ───────────────────────────

describe('prepareCmsContent', () => {
  it('strips H1 and sanitizes in one call', () => {
    const html = '<h1>Title</h1><script>alert(1)</script><p>Safe body</p>'
    const result = prepareCmsContent(html)
    expect(result).not.toContain('<h1>')
    expect(result).not.toContain('<script')
    expect(result).toContain('<p>Safe body</p>')
  })

  it('preserves JSON-LD after stripping H1', () => {
    const html = `<h1>Title</h1><p>Body</p><script type="application/ld+json">{"@type":"BlogPosting"}</script>`
    const result = prepareCmsContent(html)
    expect(result).not.toContain('<h1>')
    expect(result).toContain('application/ld+json')
  })

  it('handles empty string without throwing', () => {
    expect(() => prepareCmsContent('')).not.toThrow()
    expect(prepareCmsContent('')).toBe('')
  })

  it('preserves all safe HTML elements', () => {
    const html = '<h1>Drop me</h1><h2>Keep</h2><ul><li>Item</li></ul><p>Para</p>'
    const result = prepareCmsContent(html)
    expect(result).toContain('<h2>Keep</h2>')
    expect(result).toContain('<ul>')
    expect(result).toContain('<p>Para</p>')
    expect(result).not.toContain('<h1>')
  })
})
