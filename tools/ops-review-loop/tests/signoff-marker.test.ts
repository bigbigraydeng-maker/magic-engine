/**
 * The review sign-off marker: the record that says "this named reviewer passed
 * this exact diff".
 *
 * Three things are being defended here.
 *
 *  1. **Staleness.** A sign-off that outlives the diff it describes is worse
 *     than no sign-off, because it looks like due diligence. `evaluateSignoffs`
 *     is the only thing standing between "three reviewers approved it" and
 *     "three reviewers approved something else".
 *  2. **The transport.** The payload is embedded in an HTML comment. If a value
 *     can contain `-->`, the marker can be truncated — and a truncated marker
 *     either vanishes or leaves an attacker-chosen tail rendered as PR text.
 *  3. **Provenance.** A sign-off is a human verdict, and anyone who can comment
 *     can type one. `github-actions[bot]` and the PR author are removed from
 *     the trusted set even when the allowlist names them.
 */

import { describe, expect, it } from 'vitest'

import {
  NEVER_TRUSTED_SIGNOFF_AUTHORS,
  REQUIRED_SIGNOFF_ROLES,
  SIGNOFF_MARKER_VERSION,
  buildSignoffMarker,
  evaluateSignoffs,
  parseSignoffMarkers,
  selectTrustedSignoffMarkers,
} from '../src/signoff-marker.mjs'

const BASE = 'd8ee449d13f7632e2f67234a22d00a1b76175b9b'
const HEAD = '7a1527bc3b2e5a064815d761ecea7e27848c3108'

describe('build and parse round-trip', () => {
  it.each(REQUIRED_SIGNOFF_ROLES)('round-trips a sign-off for role %s', (role) => {
    const marker = buildSignoffMarker({ base: BASE, head: HEAD, role })
    const [parsed] = parseSignoffMarkers([marker])
    expect(parsed).toMatchObject({
      v: SIGNOFF_MARKER_VERSION,
      base: BASE,
      head: HEAD,
      role,
      verdict: 'pass',
    })
  })

  it('matches the documented marker shape', () => {
    const marker = buildSignoffMarker({ base: BASE, head: HEAD, role: 'ziya' })
    expect(marker.startsWith('<!-- me-review-signoff:{')).toBe(true)
    expect(marker.endsWith('} -->')).toBe(true)
  })

  it('finds several markers across several comment bodies, in order', () => {
    const a = buildSignoffMarker({ base: BASE, head: HEAD, role: 'ziya' })
    const b = buildSignoffMarker({ base: BASE, head: HEAD, role: 'weizheng' })
    const parsed = parseSignoffMarkers([`text\n${a}\nmore`, null, `${b}`])
    expect(parsed.map((m: { role: string }) => m.role)).toEqual(['ziya', 'weizheng'])
  })
})

describe('only the three named roles and the pass verdict are storable', () => {
  it('refuses to build a marker for an unknown role', () => {
    expect(() => buildSignoffMarker({ base: BASE, head: HEAD, role: 'banqiao' })).toThrow(
      /only ziya \/ weizheng \/ direnjie are storable/,
    )
  })

  it('refuses to build a marker with verdict "fail" — a failed review writes nothing', () => {
    expect(() => buildSignoffMarker({ base: BASE, head: HEAD, role: 'ziya', verdict: 'fail' })).toThrow(
      /only pass are storable/,
    )
  })
})

describe('malformed input is skipped, not thrown on', () => {
  it.each([
    ['not JSON', '<!-- me-review-signoff:{nope} -->'],
    ['wrong version', '<!-- me-review-signoff:{"v":2,"base":"a","head":"b","role":"ziya","verdict":"pass"} -->'],
    ['unknown role', '<!-- me-review-signoff:{"v":1,"base":"a","head":"b","role":"nonsense","verdict":"pass"} -->'],
    ['fail verdict', '<!-- me-review-signoff:{"v":1,"base":"a","head":"b","role":"ziya","verdict":"fail"} -->'],
    ['non-string head', '<!-- me-review-signoff:{"v":1,"base":"a","head":3,"role":"ziya","verdict":"pass"} -->'],
    ['a different marker family', '<!-- me-dev-gate:{"v":1,"base":"a","head":"b","risk":"A"} -->'],
  ])('%s yields nothing', (_label, body) => {
    expect(parseSignoffMarkers([body])).toEqual([])
  })

  it('does not let one corrupted comment hide a valid marker', () => {
    const good = buildSignoffMarker({ base: BASE, head: HEAD, role: 'direnjie' })
    expect(parseSignoffMarkers(['<!-- me-review-signoff:{broken -->', good])).toHaveLength(1)
  })

  it('tolerates junk input types', () => {
    expect(parseSignoffMarkers(undefined)).toEqual([])
    expect(parseSignoffMarkers([undefined, null, 42])).toEqual([])
  })
})

describe('a value cannot close the HTML comment it lives in', () => {
  it('emits no raw ">" anywhere but the closing delimiter', () => {
    const marker = buildSignoffMarker({ base: BASE, head: HEAD, role: 'ziya' })
    // The only ">" in the marker is the one in the closing " -->".
    expect(marker.indexOf('>')).toBe(marker.length - 1)
    expect(marker.indexOf('-->')).toBe(marker.length - 3)
    expect(marker.indexOf('<!--')).toBe(0)
  })

  it('still parses to exactly one marker with the payload intact as data', () => {
    const marker = buildSignoffMarker({ base: BASE, head: HEAD, role: 'weizheng' })
    const parsed = parseSignoffMarkers([marker])
    expect(parsed).toHaveLength(1)
    expect(parsed[0].role).toBe('weizheng')
    expect(parsed[0].head).toBe(HEAD)
  })
})

describe('a marker only counts if a trusted identity wrote it', () => {
  const TRUSTED = 'ziya'
  const signoff = (role: string) => buildSignoffMarker({ base: BASE, head: HEAD, role })

  it('reads a marker written by a trusted author', () => {
    const found = selectTrustedSignoffMarkers({
      sources: [{ author: TRUSTED, body: signoff('ziya') }],
      trustedAuthors: [TRUSTED],
    })
    expect(found.map((m: { role: string }) => m.role)).toEqual(['ziya'])
  })

  it('ignores the same marker written by an untrusted author', () => {
    const found = selectTrustedSignoffMarkers({
      sources: [{ author: 'random-commenter', body: signoff('ziya') }],
      trustedAuthors: [TRUSTED],
    })
    expect(found).toEqual([])
  })

  it('drops github-actions[bot] even when the allowlist names it', () => {
    const bot = NEVER_TRUSTED_SIGNOFF_AUTHORS[0]
    const found = selectTrustedSignoffMarkers({
      sources: [{ author: bot, body: signoff('ziya') }],
      trustedAuthors: [bot, TRUSTED],
    })
    expect(found).toEqual([])
  })

  it('drops the PR author even when the allowlist names them', () => {
    const found = selectTrustedSignoffMarkers({
      sources: [{ author: 'bigbigraydeng-maker', body: signoff('ziya') }],
      trustedAuthors: ['bigbigraydeng-maker', TRUSTED],
      prAuthor: 'bigbigraydeng-maker',
    })
    expect(found).toEqual([])
  })

  it('still trusts the other reviewers when the PR author is removed', () => {
    const found = selectTrustedSignoffMarkers({
      sources: [
        { author: 'bigbigraydeng-maker', body: signoff('ziya') },
        { author: TRUSTED, body: signoff('ziya') },
      ],
      trustedAuthors: ['bigbigraydeng-maker', TRUSTED],
      prAuthor: 'bigbigraydeng-maker',
    })
    expect(found).toHaveLength(1)
  })

  it('trusts nobody when the allowlist is a bare string, rather than trusting its letters', () => {
    expect(
      selectTrustedSignoffMarkers({
        sources: [{ author: 'z', body: signoff('ziya') }],
        trustedAuthors: 'ziya',
      }),
    ).toEqual([])
  })

  it('trusts nobody when the allowlist is empty — it does not fall back to reading everything', () => {
    expect(
      selectTrustedSignoffMarkers({ sources: [{ author: TRUSTED, body: signoff('ziya') }], trustedAuthors: [] }),
    ).toEqual([])
  })

  it('tolerates junk input on both sides', () => {
    expect(selectTrustedSignoffMarkers()).toEqual([])
    expect(selectTrustedSignoffMarkers({ sources: 'nope', trustedAuthors: [TRUSTED] })).toEqual([])
  })
})

describe('the sign-off dies when the diff moves', () => {
  const all = REQUIRED_SIGNOFF_ROLES.map((role) => ({ base: BASE, head: HEAD, role }))

  it('is complete when all three roles signed the same base and head', () => {
    expect(evaluateSignoffs({ markers: all, base: BASE, head: HEAD })).toEqual({
      complete: true,
      present: ['ziya', 'weizheng', 'direnjie'],
      missing: [],
    })
  })

  it('is incomplete when only two of three roles signed', () => {
    expect(evaluateSignoffs({ markers: all.slice(0, 2), base: BASE, head: HEAD })).toEqual({
      complete: false,
      present: ['ziya', 'weizheng'],
      missing: ['direnjie'],
    })
  })

  it('drops a role whose marker was for a different head — this is the "旧批准立即失效" rule', () => {
    const markers = [
      { base: BASE, head: HEAD, role: 'ziya' },
      { base: BASE, head: HEAD, role: 'weizheng' },
      { base: BASE, head: 'f'.repeat(40), role: 'direnjie' },
    ]
    expect(evaluateSignoffs({ markers, base: BASE, head: HEAD })).toEqual({
      complete: false,
      present: ['ziya', 'weizheng'],
      missing: ['direnjie'],
    })
  })

  it('drops every role when the markers were for a different base', () => {
    const markers = REQUIRED_SIGNOFF_ROLES.map((role) => ({ base: 'e'.repeat(40), head: HEAD, role }))
    expect(evaluateSignoffs({ markers, base: BASE, head: HEAD })).toEqual({
      complete: false,
      present: [],
      missing: ['ziya', 'weizheng', 'direnjie'],
    })
  })

  it('treats a non-array markers value as no sign-offs at all', () => {
    expect(evaluateSignoffs({ markers: undefined, base: BASE, head: HEAD })).toEqual({
      complete: false,
      present: [],
      missing: ['ziya', 'weizheng', 'direnjie'],
    })
  })

  it('treats a missing base or head as nothing signed', () => {
    expect(evaluateSignoffs({ markers: all })).toEqual({
      complete: false,
      present: [],
      missing: ['ziya', 'weizheng', 'direnjie'],
    })
  })
})
