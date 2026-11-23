import { describe, expect, it } from 'vitest'
import { analyzeDocuments, linkedResources } from '../analyze'

const base = {
  sourceUrl: 'https://factory.example/', scannedAt: '2026-09-20T00:00:00.000Z', https: true,
  status: 200, incomplete: false, ad: 'omitted' as const, utm: 'absent' as const,
}
const fixture = `<html><head><script>gtag('config','G-ABCDEF1234');fbq('init','12345678901234');fbq('init','98765432109876');gtag('config','AW-1234567890')</script></head><body>
  <a href="https://wa.me/8613800000000">Chat</a><a href="mailto:sales@factory.example">Email</a>
  <a href="tel:+8613800000000">Call</a><form id="contact"><input type="email" value="PERSONAL_SECRET"><input name="product"><textarea>PRIVATE MESSAGE</textarea><input type="hidden" value="SECRET_TOKEN"></form>
  <div id="cookie-banner"><button>Accept cookies</button></div></body></html>`

describe('evidence-based Chinese report', () => {
  it('detects tracking and contact structure while keeping private values out of reports', () => {
    const report = analyzeDocuments({ ...base, documents: [{ text: fixture, source: base.sourceUrl, kind: 'page' }] })
    expect(report.checks.find(c => c.id === 'pixel')).toMatchObject({ state: 'detected', evidence: ['公开代码编号：12345678901234', '公开代码编号：98765432109876'] })
    expect(report.checks.find(c => c.id === 'ga4')?.state).toBe('detected')
    expect(report.checks.find(c => c.id === 'contact')?.detail).toContain('WhatsApp')
    expect(report.suggestions[0].title).toContain('归属')
    const json = JSON.stringify(report)
    for (const privateText of ['PERSONAL_SECRET', 'PRIVATE MESSAGE', 'SECRET_TOKEN', 'sales@factory.example', '8613800000000', '<html>']) expect(json).not.toContain(privateText)
    expect(report.checks.find(c => c.id === 'capi')?.state).toBe('needs_connection')
    expect(report.checks.find(c => c.id === 'ad')?.state).toBe('unknown')
    expect(report.checks.find(c => c.id === 'quality')?.state).toBe('unknown')
  })

  it('does not infer broken tracking or missing live contacts from an app shell', () => {
    const report = analyzeDocuments({ ...base, incomplete: true, documents: [{ text: '<html><body><div id="app"></div></body></html>', source: base.sourceUrl, kind: 'page' }] })
    expect(report.checks.find(c => c.id === 'pixel')?.detail).toContain('不能据此断定未安装')
    expect(report.checks.find(c => c.id === 'form')?.state).toBe('unknown')
    expect(report.coverage.incomplete).toBe(true)
    expect(report.suggestions[0].title).toContain('先确认')
  })

  it('ignores template contacts, chat lookalike hosts and newsletter qualification values', () => {
    const text = '<html><template><a href="https://wa.me/8613800000000">Chat</a></template><a href="https://wa.me.evil.example/12345678">fake</a><script>const s = \'<form id="contact">\'</script><form><input type="email" value="product country budget"></form></html>'
    const report = analyzeDocuments({ ...base, documents: [{ text, source: base.sourceUrl, kind: 'page' }] })
    expect(report.checks.find(c => c.id === 'contact')?.detail).not.toContain('WhatsApp')
    expect(report.checks.find(c => c.id === 'form')?.detail).toContain('未识别到')
  })

  it('limits discovered scripts and contact pages without fetching external trackers', () => {
    const resources = linkedResources('<html><script src="/1.js"></script><script src="/2.js"></script><script src="/layout.js"></script><script src="/main.js"></script><script src="https://other.example/tag.js"></script><script src="/api/remove.js?key=secret"></script><a href="https://other.example/contact">Contact</a><a href="/contact-us">Contact</a></html>', new URL(base.sourceUrl))
    expect(resources.scripts).toEqual(['https://factory.example/layout.js', 'https://factory.example/main.js', 'https://factory.example/1.js'])
    expect(resources.contact).toBe('https://factory.example/contact-us')
  })

  it('a readable Facebook page does not establish the ad destination or content match', () => {
    const report = analyzeDocuments({ ...base, ad: 'readable', documents: [{ text: fixture, source: base.sourceUrl, kind: 'page' }] })
    expect(report.checks.find(c => c.id === 'alignment')?.state).toBe('unknown')
    expect(report.path[0].confirmed).toBe(false)
  })

  it.each([
    '<script>'.repeat(90_000),
    '<form>'.repeat(120_000),
    'a'.repeat(720_000),
    '<!--'.repeat(150_000),
    '<a href="'.repeat(60_000),
    'connect.facebook.net/'.repeat(30_000),
  ])('keeps malformed markup and long tokens within the parser CPU budget (%#)', text => {
    const html = `<html><body>${text}</body></html>`
    const start = performance.now()
    linkedResources(html, new URL(base.sourceUrl))
    const report = analyzeDocuments({ ...base, documents: [{ text: html, source: base.sourceUrl, kind: 'page' }] })
    expect(performance.now() - start).toBeLessThan(1000)
    expect(report.checks.find(c => c.id === 'contact')?.state).toBe('not_detected')
  })
})
