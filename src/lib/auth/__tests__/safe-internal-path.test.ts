/**
 * Open-redirect regression tests for the shared post-auth `next` sanitiser.
 * Found by the 狄仁杰 attack review of PR 2123: `/\evil.com` passed the old
 * `startsWith('/') && !startsWith('//')` check and browsers turn it into
 * `//evil.com`.
 */

import { describe, it, expect } from 'vitest'
import { isSafeInternalPath, safeInternalPath } from '../safe-internal-path'

const FALLBACK = '/dashboard'

describe('safeInternalPath — rejects off-site redirects', () => {
  it.each([
    ['/\\evil.com'],
    ['/%5Cevil.com'],
    ['/%5cevil.com'],
    ['//evil.com'],
    ['/%2Fevil.com'],
    ['/%2F/evil.com'],
    ['https://evil.com'],
    ['http://evil.com/dashboard'],
    ['javascript:alert(1)'],
    ['evil.com'],
    ['\\\\evil.com'],
    ['/\t/evil.com'],
    ['/\n/evil.com'],
    ['/%09/evil.com'],
    ['/%0A/evil.com'],
    ['/dashboard\\..\\evil'],
    ['/%E0%A4%A'],
    [''],
  ])('%j → fallback', (input) => {
    expect(safeInternalPath(input, FALLBACK)).toBe(FALLBACK)
    expect(isSafeInternalPath(input)).toBe(false)
  })

  it('non-string input → fallback', () => {
    expect(safeInternalPath(undefined, FALLBACK)).toBe(FALLBACK)
    expect(safeInternalPath(null, FALLBACK)).toBe(FALLBACK)
    expect(safeInternalPath(42, FALLBACK)).toBe(FALLBACK)
    expect(safeInternalPath(['/dashboard'], FALLBACK)).toBe(FALLBACK)
  })
})

describe('safeInternalPath — keeps normal internal paths', () => {
  it.each([
    ['/meta-ads-ai/mine'],
    ['/dashboard/clients/a1000000-0000-4000-8000-000000000001/execution'],
    ['/dashboard'],
    ['/portal'],
    ['/prospect'],
    ['/'],
    ['/meta-ads-ai/mine?tab=report&from=%2Fdashboard'],
    ['/dashboard/clients/abc#section'],
  ])('%j is kept', (input) => {
    expect(safeInternalPath(input, FALLBACK)).toBe(input)
    expect(isSafeInternalPath(input)).toBe(true)
  })

  it('uses the caller-supplied fallback', () => {
    expect(safeInternalPath('//evil.com', '/portal')).toBe('/portal')
  })
})
