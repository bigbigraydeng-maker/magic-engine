import { describe, expect, it } from 'vitest'
import { classifyLesson } from '../classify'
import { checkHtmlText, checkStructuredData, countJsonLd, runSiteCheck } from '../checks'
import { buildExperimentCard } from '../experiment-card'

describe('classifyLesson', () => {
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
    const ok = (async () => ({ ok: true, status: 200, text: `<p>${longText}</p>` })) as never
    const r = await runSiteCheck('html_visible', 'example.com', ok)
    expect(r.ok && r.result.pass).toBe(true)
  })
})

describe('experiment card', () => {
  it('states limits and has no execution field', () => {
    const c = buildExperimentCard('x')
    expect(c.budgetCapNzd).toBeGreaterThan(0)
    expect(Object.keys(c)).not.toContain('execute')
  })
})
