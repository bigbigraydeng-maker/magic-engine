/**
 * Tests for normaliseContentTargets() — the JS-side guard that mirrors the DB
 * CHECK constraint on cms_connections.content_targets.
 *
 * Two purposes:
 *  - Catch bad input at the API boundary so the FDE sees a 400 + clean message
 *    instead of a Postgres CHECK violation.
 *  - Lock the MVP whitelist (html|php × global_head) so adding support for
 *    jsx/vue/page_head/etc later requires updating both the DB function and
 *    these tests together.
 */

import { describe, it, expect } from 'vitest'
import { normaliseContentTargets } from './connection-store'

describe('normaliseContentTargets', () => {
  it('returns [] for undefined/null', () => {
    expect(normaliseContentTargets(undefined)).toEqual([])
    expect(normaliseContentTargets(null)).toEqual([])
  })

  it('accepts an empty array', () => {
    expect(normaliseContentTargets([])).toEqual([])
  })

  it('accepts a valid html target without label', () => {
    const result = normaliseContentTargets([
      { path: 'layouts/main.html', syntax: 'html', role: 'global_head' },
    ])
    expect(result).toEqual([
      { path: 'layouts/main.html', syntax: 'html', role: 'global_head' },
    ])
  })

  it('accepts a valid php target with label', () => {
    const result = normaliseContentTargets([
      { path: 'header.php', syntax: 'php', role: 'global_head', label: 'Site header' },
    ])
    expect(result).toEqual([
      { path: 'header.php', syntax: 'php', role: 'global_head', label: 'Site header' },
    ])
  })

  it('trims whitespace from path', () => {
    const result = normaliseContentTargets([
      { path: '  header.php  ', syntax: 'php', role: 'global_head' },
    ])
    expect(result[0]?.path).toBe('header.php')
  })

  it('rejects non-array input', () => {
    expect(() => normaliseContentTargets('foo' as unknown)).toThrow(/must be an array/)
    expect(() => normaliseContentTargets({} as unknown)).toThrow(/must be an array/)
  })

  it('rejects empty path', () => {
    expect(() =>
      normaliseContentTargets([{ path: '', syntax: 'html', role: 'global_head' }]),
    ).toThrow(/Invalid content target/)
  })

  it('rejects whitespace-only path (M4 — was passing JS but failing DB CHECK as 500)', () => {
    expect(() =>
      normaliseContentTargets([{ path: '   ', syntax: 'html', role: 'global_head' }]),
    ).toThrow(/path cannot be blank/)
  })

  it('rejects tab/newline-only path', () => {
    expect(() =>
      normaliseContentTargets([{ path: '\t\n', syntax: 'php', role: 'global_head' }]),
    ).toThrow(/path cannot be blank/)
  })

  it('rejects missing path', () => {
    expect(() =>
      normaliseContentTargets([{ syntax: 'html', role: 'global_head' }]),
    ).toThrow(/Invalid content target/)
  })

  it('rejects unsupported syntax (jsx) — MVP whitelist enforcement', () => {
    expect(() =>
      normaliseContentTargets([
        { path: 'app/layout.tsx', syntax: 'jsx', role: 'global_head' },
      ]),
    ).toThrow(/Invalid content target/)
  })

  it('rejects unsupported syntax (vue)', () => {
    expect(() =>
      normaliseContentTargets([
        { path: 'app.vue', syntax: 'vue', role: 'global_head' },
      ]),
    ).toThrow(/Invalid content target/)
  })

  it('rejects unsupported role (body_end)', () => {
    expect(() =>
      normaliseContentTargets([
        { path: 'header.php', syntax: 'php', role: 'body_end' },
      ]),
    ).toThrow(/Invalid content target/)
  })

  it('rejects non-string label', () => {
    expect(() =>
      normaliseContentTargets([
        { path: 'header.php', syntax: 'php', role: 'global_head', label: 123 },
      ]),
    ).toThrow(/Invalid content target/)
  })

  it('rejects mixed valid/invalid (fails on first bad element)', () => {
    expect(() =>
      normaliseContentTargets([
        { path: 'header.php', syntax: 'php', role: 'global_head' },
        { path: 'bad.tsx',    syntax: 'jsx', role: 'global_head' },
      ]),
    ).toThrow(/Invalid content target/)
  })

  it('accepts multiple valid targets in one call', () => {
    const result = normaliseContentTargets([
      { path: 'header.php',         syntax: 'php',  role: 'global_head', label: 'PHP header' },
      { path: 'layouts/main.html',  syntax: 'html', role: 'global_head' },
    ])
    expect(result).toHaveLength(2)
    expect(result[0]?.syntax).toBe('php')
    expect(result[1]?.syntax).toBe('html')
  })
})
