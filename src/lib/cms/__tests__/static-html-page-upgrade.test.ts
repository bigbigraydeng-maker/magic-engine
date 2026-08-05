import { describe, expect, it } from 'vitest'
import {
  MANAGED_CONTENT_END,
  MANAGED_CONTENT_START,
  patchStaticHtmlPage,
  resolveStaticHtmlPath,
} from '../static-html-page-upgrade'

describe('resolveStaticHtmlPath', () => {
  const paths = [
    'website/index.html',
    'website/about.html',
    'website/solutions/travel.html',
  ]

  it('maps the homepage and nested routes to configured files', () => {
    expect(resolveStaticHtmlPath('https://magicengine.com.au/', paths))
      .toEqual({ ok: true, filePath: 'website/index.html' })
    expect(resolveStaticHtmlPath('https://magicengine.com.au/about/', paths))
      .toEqual({ ok: true, filePath: 'website/about.html' })
    expect(resolveStaticHtmlPath('https://magicengine.com.au/solutions/travel', paths))
      .toEqual({ ok: true, filePath: 'website/solutions/travel.html' })
  })

  it('rejects missing, ambiguous and unsafe targets', () => {
    expect(resolveStaticHtmlPath('https://example.com/travel', [])).toMatchObject({ ok: false })
    expect(resolveStaticHtmlPath('https://example.com/', ['a/index.html', 'b/index.html']))
      .toMatchObject({ ok: false })
    expect(resolveStaticHtmlPath('https://example.com/private', ['../private.html']))
      .toMatchObject({ ok: false })
  })
})

describe('patchStaticHtmlPage', () => {
  const source = `<!doctype html>
<html><head>
<title>Old title</title>
<meta content="Old description" name="description">
</head><body>
${MANAGED_CONTENT_START}
<main><h1>Old</h1></main>
${MANAGED_CONTENT_END}
</body></html>`

  it('patches title, description and an explicitly managed body region', () => {
    const result = patchStaticHtmlPage(source, {
      metaTitle: 'New & better',
      metaDescription: 'A "better" description',
      htmlBody: '<main><h1>New</h1></main>',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bodyApplied).toBe(true)
    expect(result.updatedFields).toEqual(['meta_title', 'meta_description', 'content_html'])
    expect(result.content).toContain('<title>New &amp; better</title>')
    expect(result.content).toContain('content="A &quot;better&quot; description"')
    expect(result.content).toContain('<main><h1>New</h1></main>')
  })

  it('updates metadata only when the page has no managed body markers', () => {
    const unmarked = source
      .replace(MANAGED_CONTENT_START, '')
      .replace(MANAGED_CONTENT_END, '')
    const result = patchStaticHtmlPage(unmarked, {
      metaTitle: 'New title',
      metaDescription: 'New description',
      htmlBody: '<main>Do not insert me</main>',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bodyApplied).toBe(false)
    expect(result.content).not.toContain('Do not insert me')
  })

  it('inserts a missing meta description and refuses incomplete markers', () => {
    const missingMeta = source.replace(/<meta[^>]+>\n/, '')
    const inserted = patchStaticHtmlPage(missingMeta, {
      metaTitle: 'New title',
      metaDescription: 'Added description',
    })
    expect(inserted.ok).toBe(true)
    if (inserted.ok) expect(inserted.content).toContain('name="description" content="Added description"')

    const broken = source.replace(MANAGED_CONTENT_END, '')
    expect(patchStaticHtmlPage(broken, {
      metaTitle: 'New title',
      metaDescription: 'New description',
      htmlBody: '<main>New</main>',
    })).toMatchObject({ ok: false })
  })
})
