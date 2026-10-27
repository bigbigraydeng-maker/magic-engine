import { describe, expect, it } from 'vitest'
import { classifyLesson } from '../classify'
import { checkHtmlText, checkStructuredData, countJsonLd, runSiteCheck } from '../checks'
import { buildExperimentCard } from '../experiment-card'

function reply(o: { text: string; url?: string; type?: string }) {
  return (async () => ({
    ok: true,
    status: 200,
    text: o.text,
    url: o.url ?? 'https://example.com/',
    headers: new Headers({ 'content-type': o.type ?? 'text/html; charset=utf-8' }),
  })) as never
}

describe('classifyLesson', () => {
  it('falls back to none for broad or unsupported wording', () => {
    expect(classifyLesson('Improve meta descriptions for product pages')).toBe('none')
    expect(classifyLesson('Allow GPTBot in robots.txt so crawlers can access the site')).toBe('none')
    expect(classifyLesson('Submit a sitemap and let crawlers in')).toBe('none')
    expect(classifyLesson('Add schema markup and a sitemap')).toBe('structured_data')
    expect(classifyLesson('Meta ads work better with short videos')).toBe('ad_experiment')
  })
  it('routes by keywords', () => {
    expect(classifyLesson('Make content visible in raw HTML, not JavaScript')).toBe('html_visible')
    expect(classifyLesson('Add schema markup to product pages')).toBe('structured_data')
    expect(classifyLesson('Use JSON-LD rendered server-side')).toBe('structured_data')
    expect(classifyLesson('Raise Meta ad budget slowly')).toBe('ad_experiment')
    expect(classifyLesson('Write good headlines')).toBe('none')
  })
})

describe('site checks', () => {
  const longText = 'word '.repeat(100)
  it('html text', () => {
    expect(checkHtmlText(`<body>${longText}</body>`).pass).toBe(true)
    expect(checkHtmlText('<body><div id="root"></div><script>x()</script></body>').pass).toBe(false)
  })
  it('json-ld', () => {
    const html = '<script type="application/ld+json">{}</script><script>1</script>'
    expect(countJsonLd(html)).toBe(1)
    expect(checkStructuredData(html).pass).toBe(true)
    expect(checkStructuredData('<p>x</p>').pass).toBe(false)
  })
  it('rejects invalid address and maps fetch errors', async () => {
    expect((await runSiteCheck('html_visible', 'localhost')).ok).toBe(false)
    const boom = (async () => {
      throw new Error('x')
    }) as never
    expect((await runSiteCheck('html_visible', 'example.com', boom)).ok).toBe(false)
    const r = await runSiteCheck('html_visible', 'example.com', reply({ text: `<p>${longText}</p>` }))
    expect(r.ok && r.result.pass).toBe(true)
  })
  it('returns cannot-check when response is not the chosen site, not HTML, or a challenge page', async () => {
    const page = `<p>${longText}</p>`
    const moved = await runSiteCheck('html_visible', 'example.com', reply({ text: page, url: 'https://other.example.net/' }))
    expect(moved.ok).toBe(false)
    const plain = await runSiteCheck('html_visible', 'example.com', reply({ text: page, type: 'text/plain' }))
    expect(plain.ok).toBe(false)
    const challenge = `<html><head><title>Just a moment...</title></head><body>${longText}</body></html>`
    const blocked = await runSiteCheck('structured_data', 'example.com', reply({ text: challenge }))
    expect(blocked.ok).toBe(false)
  })
})

describe('experiment card', () => {
  it('states limits and has no execution field', () => {
    const c = buildExperimentCard('x')
    expect(c.budgetCapNzd).toBeGreaterThan(0)
    expect(Object.keys(c)).not.toContain('execute')
  })
})
