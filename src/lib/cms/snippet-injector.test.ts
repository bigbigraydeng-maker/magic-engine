/**
 * Tests for the GEO snippet injector.
 *
 * Coverage targets (魏征 B1 carryover #B2-7 + #B2 own slice):
 *   - HTML happy path: snippet injected before </head>, hashed correctly
 *   - PHP happy path: same behaviour for .php templates with WP-style header
 *   - Idempotent replace: second call replaces inner content, doesn't duplicate
 *   - Drift detection: previousHash returned from existing block reflects the
 *     hash of what was actually on disk (not what we want to write)
 *   - Indent preservation: matches the existing </head> indentation
 *   - HEAD missing: throws HeadTagNotFoundError, file untouched
 *   - readExistingInjectedHash: returns null on virgin file, hash on injected
 */

import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'
import {
  injectGeoSnippet,
  readExistingInjectedHash,
  HeadTagNotFoundError,
  SnippetContainsMarkerError,
  ME_GEO_START_MARKER,
  ME_GEO_END_MARKER,
} from './snippet-injector'

const SNIPPET = '<script type="application/ld+json">{"@context":"https://schema.org"}</script>'

function sha256(s: string): string {
  return createHash('sha256').update(s.trim(), 'utf8').digest('hex')
}

describe('injectGeoSnippet — first injection', () => {
  it('inserts the marker block immediately before </head> in HTML', () => {
    const tpl =
`<!DOCTYPE html>
<html>
<head>
  <title>Acme</title>
</head>
<body>Hello</body>
</html>`

    const { newContent, injectedHash, previousHash } = injectGeoSnippet(tpl, SNIPPET, 'html', 'layouts/main.html')

    expect(previousHash).toBeNull()
    expect(injectedHash).toBe(sha256(SNIPPET))
    expect(newContent).toContain(ME_GEO_START_MARKER)
    expect(newContent).toContain(ME_GEO_END_MARKER)
    expect(newContent).toContain(SNIPPET)
    // Marker block must come before </head>
    expect(newContent.indexOf(ME_GEO_START_MARKER)).toBeLessThan(newContent.indexOf('</head>'))
    // Title still present
    expect(newContent).toContain('<title>Acme</title>')
  })

  it('inserts in PHP templates the same way', () => {
    const tpl =
`<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
  <meta charset="<?php bloginfo('charset'); ?>" />
  <?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>`

    const { newContent, injectedHash } = injectGeoSnippet(tpl, SNIPPET, 'php', 'header.php')

    expect(injectedHash).toBe(sha256(SNIPPET))
    expect(newContent).toContain(ME_GEO_START_MARKER)
    expect(newContent).toContain(SNIPPET)
    // wp_head() preserved
    expect(newContent).toContain('<?php wp_head(); ?>')
  })

  it('preserves the </head> indentation when rendering the block', () => {
    const tpl = '<html>\n<head>\n  <title>x</title>\n    </head>\n<body></body></html>'
    const { newContent } = injectGeoSnippet(tpl, SNIPPET, 'html', 'x.html')
    // Indent matches the spaces before </head> (4 spaces here)
    expect(newContent).toContain(`    ${ME_GEO_START_MARKER}`)
    expect(newContent).toContain(`    ${ME_GEO_END_MARKER}`)
  })
})

describe('injectGeoSnippet — idempotent replace', () => {
  it('replaces inner content on second call, does not duplicate the block', () => {
    const tpl = '<html><head><title>x</title></head><body></body></html>'
    const first  = injectGeoSnippet(tpl, SNIPPET, 'html', 'x.html')
    const SNIPPET_V2 = '<script>console.log("v2")</script>'
    const second = injectGeoSnippet(first.newContent, SNIPPET_V2, 'html', 'x.html')

    // Only one START marker after two passes
    const startCount = (second.newContent.match(/ME-GEO-START/g) || []).length
    expect(startCount).toBe(1)

    // New snippet present, old snippet gone
    expect(second.newContent).toContain(SNIPPET_V2)
    expect(second.newContent).not.toContain(SNIPPET)

    // previousHash reflects what was on disk (the v1 snippet hash)
    expect(second.previousHash).toBe(sha256(SNIPPET))
    expect(second.injectedHash).toBe(sha256(SNIPPET_V2))
  })

  it('previousHash matches even when human edited inside markers (drift scenario)', () => {
    const tpl = '<html><head></head><body></body></html>'
    const first = injectGeoSnippet(tpl, SNIPPET, 'html', 'x.html')

    // Simulate someone hand-editing the inner content
    const tampered = first.newContent.replace(SNIPPET, '<script>EVIL</script>')

    const drift = injectGeoSnippet(tampered, SNIPPET, 'html', 'x.html')
    // previousHash now reflects the tampered content, NOT what ME originally wrote
    expect(drift.previousHash).toBe(sha256('<script>EVIL</script>'))
    expect(drift.previousHash).not.toBe(first.injectedHash)
  })
})

describe('injectGeoSnippet — failure modes', () => {
  it('throws HeadTagNotFoundError when template lacks </head>', () => {
    const tpl = '<html><body>No head here</body></html>'
    expect(() => injectGeoSnippet(tpl, SNIPPET, 'html', 'no-head.html'))
      .toThrow(HeadTagNotFoundError)
  })

  it('error message names the target path', () => {
    expect(() => injectGeoSnippet('<html></html>', SNIPPET, 'html', 'layouts/broken.html'))
      .toThrow(/layouts\/broken\.html/)
  })

  it('matches </head> case-insensitively (</HEAD>, </Head>, etc)', () => {
    const tpl = '<html><HEAD></HEAD><body></body></html>'
    const { newContent } = injectGeoSnippet(tpl, SNIPPET, 'html', 'x.html')
    expect(newContent).toContain(ME_GEO_START_MARKER)
  })

  it('MF1: rejects snippet containing the START marker literally (injection attempt)', () => {
    const tpl = '<html><head></head><body></body></html>'
    const evil = `<script>console.log("smuggle")</script>${ME_GEO_START_MARKER}`
    expect(() => injectGeoSnippet(tpl, evil, 'html', 'x.html'))
      .toThrow(SnippetContainsMarkerError)
  })

  it('MF1: rejects snippet containing the END marker literally (injection attempt)', () => {
    const tpl = '<html><head></head><body></body></html>'
    const evil = `${ME_GEO_END_MARKER}<script>console.log("after")</script>`
    expect(() => injectGeoSnippet(tpl, evil, 'html', 'x.html'))
      .toThrow(SnippetContainsMarkerError)
  })
})

describe('readExistingInjectedHash', () => {
  it('returns null for a virgin template', () => {
    expect(readExistingInjectedHash('<html><head></head><body></body></html>')).toBeNull()
  })

  it('returns the hash of the inner content when block exists', () => {
    const tpl = '<html><head></head><body></body></html>'
    const { newContent, injectedHash } = injectGeoSnippet(tpl, SNIPPET, 'html', 'x.html')
    expect(readExistingInjectedHash(newContent)).toBe(injectedHash)
  })

  it('returns the LIVE hash (not the original) after tampering', () => {
    const tpl = '<html><head></head><body></body></html>'
    const { newContent, injectedHash } = injectGeoSnippet(tpl, SNIPPET, 'html', 'x.html')
    const tampered = newContent.replace(SNIPPET, '<script>EVIL</script>')
    const liveHash = readExistingInjectedHash(tampered)
    expect(liveHash).not.toBe(injectedHash)
    expect(liveHash).toBe(sha256('<script>EVIL</script>'))
  })
})
