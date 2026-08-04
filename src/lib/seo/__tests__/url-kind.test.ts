import { describe, it, expect } from 'vitest'
import { isHtmlPageUrl } from '../url-kind'

describe('isHtmlPageUrl', () => {
  it('content pages (with or without trailing slash, extension-less) are pages', () => {
    expect(isHtmlPageUrl('https://site.com/')).toBe(true)
    expect(isHtmlPageUrl('https://site.com/china-tours')).toBe(true)
    expect(isHtmlPageUrl('https://site.com/blog/how-many-days/')).toBe(true)
    expect(isHtmlPageUrl('https://site.com/page?utm=x#top')).toBe(true)
  })

  it('the exact asset that produced a false alarm is rejected (Oztop 首跑回归)', () => {
    expect(
      isHtmlPageUrl('https://oztopbuildingsupplies.com.au/wp-content/uploads/2025/05/DIY-Tiles-Norcia-Travertine-750x900-1.jpg'),
    ).toBe(false)
  })

  it('other assets and downloads are rejected', () => {
    for (const u of [
      'https://s.com/a.PDF', 'https://s.com/x.png', 'https://s.com/f.webp',
      'https://s.com/b.css', 'https://s.com/c.js', 'https://s.com/d.mp4',
      'https://s.com/e.zip', 'https://s.com/sitemap.xml',
    ]) {
      expect(isHtmlPageUrl(u), u).toBe(false)
    }
  })

  it('dotted path segments that are not extensions still count as pages', () => {
    expect(isHtmlPageUrl('https://site.com/v1.5-release-notes')).toBe(true)
  })

  it('malformed input is rejected rather than throwing', () => {
    expect(isHtmlPageUrl('not a url')).toBe(false)
  })
})
