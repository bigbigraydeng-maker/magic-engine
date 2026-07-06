import { describe, it, expect } from 'vitest'
import { detectTrackingSignals } from '../tracking-detector'

const MODERN_SITE = `
<html><head>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123XYZ"></script>
<script>gtag('config', 'G-ABC123XYZ');</script>
<script src="https://www.googletagmanager.com/gtm.js?id=GTM-ABCD123"></script>
<script>fbq('init', '1234567890');</script>
<script src="https://www.clarity.ms/tag/abcdef"></script>
</head><body>
<form action="/contact" id="contact-form"><input type="email" name="email"></form>
<a href="mailto:hello@ozflooring.com.au">Email us</a>
</body></html>`

const LEGACY_SITE = `
<html><head>
<script>ga('create', 'UA-12345678-1', 'auto');</script>
</head><body>
<p>Call us today for a free quote on 02 9999 9999.</p>
<img src="photo@2x.png">
</body></html>`

describe('detectTrackingSignals', () => {
  it('detects all signals on a fully instrumented site', () => {
    const s = detectTrackingSignals(MODERN_SITE)
    expect(s.ga4).toBe(true)
    expect(s.gtm).toBe(true)
    expect(s.meta_pixel).toBe(true)
    expect(s.clarity).toBe(true)
    expect(s.contact_form).toBe(true)
    expect(s.legacy_ua).toBe(false)
    expect(s.emails).toEqual(['hello@ozflooring.com.au'])
  })

  it('flags a legacy UA-only site with nothing else', () => {
    const s = detectTrackingSignals(LEGACY_SITE)
    expect(s.ga4).toBe(false)
    expect(s.gtm).toBe(false)
    expect(s.meta_pixel).toBe(false)
    expect(s.clarity).toBe(false)
    expect(s.contact_form).toBe(false)
    expect(s.legacy_ua).toBe(true)
  })

  it('filters asset-filename junk from email extraction', () => {
    const s = detectTrackingSignals(LEGACY_SITE)
    expect(s.emails).toEqual([])
  })

  it('detects a contact form named by attribute without email input', () => {
    const s = detectTrackingSignals('<form class="enquiry-form"><input type="text"></form>')
    expect(s.contact_form).toBe(true)
  })

  it('does not cross a </form> boundary to a footer newsletter input', () => {
    const html = '<form action="/search"><input type="text" name="q"></form>' +
      '<footer><input type="email" name="newsletter"></footer>'
    expect(detectTrackingSignals(html).contact_form).toBe(false)
  })

  it('does not mistake a gtm-* class name for a GTM container id', () => {
    expect(detectTrackingSignals('<div class="gtm-track-click">x</div>').gtm).toBe(false)
  })

  it('returns all-false on empty html', () => {
    const s = detectTrackingSignals('')
    expect(Object.values(s).every(v => v === false || v === null || (Array.isArray(v) && v.length === 0))).toBe(true)
  })

  it('extracts the first Facebook page and Instagram profile links', () => {
    const html = `
      <a href="https://www.facebook.com/sharer/sharer.php?u=x">share</a>
      <a href="https://www.facebook.com/ozflooringco">FB</a>
      <a href="https://www.instagram.com/p/Cxyz/">a post</a>
      <a href="https://www.instagram.com/ozflooringco/">IG</a>`
    const s = detectTrackingSignals(html)
    expect(s.facebook_url).toBe('https://www.facebook.com/ozflooringco')
    expect(s.instagram_url).toBe('https://www.instagram.com/ozflooringco/')
  })

  it('skips facebook paths whose identity lives past the first segment', () => {
    const html = `
      <a href="https://www.facebook.com/profile.php?id=61551234">profile</a>
      <a href="https://www.facebook.com/pages/Foo-Bar/123456">page</a>
      <a href="https://www.facebook.com/groups/tradies">group</a>`
    expect(detectTrackingSignals(html).facebook_url).toBeNull()
  })
})
