/**
 * The gate marker: the record that says "this level was computed from this
 * exact diff".
 *
 * Two things are being defended here.
 *
 *  1. **Staleness.** A rating that outlives the diff it describes is worse than
 *     no rating, because it looks like due diligence. `isGateCurrent` is the
 *     only thing standing between "Codex approved it" and "Codex approved
 *     something else".
 *  2. **The transport.** The payload is embedded in an HTML comment and carries
 *     file paths taken from the PR. If one of those can contain `-->`, the
 *     marker can be truncated — and a truncated marker either vanishes or, far
 *     worse, leaves an attacker-chosen tail rendered as PR text. So the escape
 *     is tested with a payload that actively tries to close the comment.
 */

import { describe, expect, it } from 'vitest'

import {
  GATE_MARKER_VERSION,
  buildGateMarker,
  findGateFor,
  isGateCurrent,
  parseGateMarkers,
  selectTrustedGateMarkers,
} from '../src/gate-marker.mjs'

const BASE = 'd8ee449d13f7632e2f67234a22d00a1b76175b9b'
const HEAD = '7a1527bc3b2e5a064815d761ecea7e27848c3108'

describe('build and parse round-trip', () => {
  it('carries level, both shas and the reasons', () => {
    const marker = buildGateMarker({
      base: BASE,
      head: HEAD,
      risk: 'A',
      reasons: ['supabase/migrations/x.sql —— A 级（migration）'],
    })
    const [parsed] = parseGateMarkers([marker])
    expect(parsed).toMatchObject({
      v: GATE_MARKER_VERSION,
      base: BASE,
      head: HEAD,
      risk: 'A',
      reasons: ['supabase/migrations/x.sql —— A 级（migration）'],
    })
  })

  it('matches the documented marker shape', () => {
    const marker = buildGateMarker({ base: BASE, head: HEAD, risk: 'C', reasons: [] })
    expect(marker.startsWith('<!-- me-dev-gate:{')).toBe(true)
    expect(marker.endsWith('} -->')).toBe(true)
  })

  it('carries the optional score and decision when they exist', () => {
    const marker = buildGateMarker({
      base: BASE,
      head: HEAD,
      risk: 'B',
      score: 88,
      decision: 'READY_FOR_PRODUCT_OWNER',
    })
    const [parsed] = parseGateMarkers([marker])
    expect(parsed.score).toBe(88)
    expect(parsed.decision).toBe('READY_FOR_PRODUCT_OWNER')
  })

  it('omits score entirely when it was not measured — null would read as zero', () => {
    const marker = buildGateMarker({ base: BASE, head: HEAD, risk: 'B' })
    const [parsed] = parseGateMarkers([marker])
    expect('score' in parsed).toBe(false)
    expect('decision' in parsed).toBe(false)
  })

  it('finds several markers across several comment bodies, in order', () => {
    const a = buildGateMarker({ base: BASE, head: 'a'.repeat(40), risk: 'C' })
    const b = buildGateMarker({ base: BASE, head: 'b'.repeat(40), risk: 'B' })
    const parsed = parseGateMarkers([`text\n${a}\nmore`, null, `${b}`])
    expect(parsed.map((m: { risk: string }) => m.risk)).toEqual(['C', 'B'])
  })
})

describe('a reason cannot close the HTML comment it lives in', () => {
  const HOSTILE = 'evil--> visible text <!-- me-dev-gate:{"v":1,"base":"x","head":"x","risk":"C"}'

  it('emits no raw comment delimiter anywhere but the ends', () => {
    const marker = buildGateMarker({ base: BASE, head: HEAD, risk: 'A', reasons: [HOSTILE] })
    expect(marker.indexOf('-->')).toBe(marker.length - 3)
    expect(marker.indexOf('<!--')).toBe(0)
  })

  it('still parses to exactly one marker with the hostile text intact as data', () => {
    const marker = buildGateMarker({ base: BASE, head: HEAD, risk: 'A', reasons: [HOSTILE] })
    const parsed = parseGateMarkers([marker])
    expect(parsed).toHaveLength(1)
    expect(parsed[0].risk).toBe('A')
    expect(parsed[0].head).toBe(HEAD)
    expect(parsed[0].reasons[0]).toBe(HOSTILE)
  })

  it('is not fooled by a forged marker smuggled through a reason', () => {
    // The forged payload inside HOSTILE claims risk C. If the escape leaked, a
    // second marker would appear and a "last one wins" reader would take it.
    const marker = buildGateMarker({ base: BASE, head: HEAD, risk: 'A', reasons: [HOSTILE] })
    const parsed = parseGateMarkers([marker])
    expect(parsed.map((m: { risk: string }) => m.risk)).toEqual(['A'])
  })
})

/**
 * Codex finding on PR #1205 (P2): the parser accepted any string as `risk`. An
 * unrecognised level is not merely scored strictly — the category-matched
 * evidence gate in quality.mjs only runs when `risk === 'A'`, so a marker
 * saying `"risk":"nonsense"` skipped that gate entirely while still counting as
 * the record in force.
 */
describe('only A, B and C are storable levels', () => {
  it.each(['A', 'B', 'C'])('accepts %s', (risk) => {
    expect(parseGateMarkers([buildGateMarker({ base: BASE, head: HEAD, risk })])[0].risk).toBe(risk)
  })

  // `unknown` on purpose: half of these are not strings, and the point of the
  // test is that the builder refuses them rather than that TypeScript does.
  // At runtime the payload comes from JSON, where the compiler is not present.
  it.each<[string, unknown]>([
    ['nonsense', 'nonsense'],
    ['lowercase a', 'a'],
    ['empty string', ''],
    ['a number', 3],
    ['null', null],
    ['an object', { risk: 'A' }],
  ])('refuses to build a marker with risk = %s', (_label, risk) => {
    expect(() => buildGateMarker({ base: BASE, head: HEAD, risk: risk as string })).toThrow(
      /only A \/ B \/ C are storable/,
    )
  })

  it.each([
    ['nonsense', '<!-- me-dev-gate:{"v":1,"base":"a","head":"b","risk":"nonsense"} -->'],
    ['lowercase', '<!-- me-dev-gate:{"v":1,"base":"a","head":"b","risk":"a"} -->'],
    ['a number', '<!-- me-dev-gate:{"v":1,"base":"a","head":"b","risk":3} -->'],
    ['empty', '<!-- me-dev-gate:{"v":1,"base":"a","head":"b","risk":""} -->'],
  ])('refuses to parse a hand-written marker with risk = %s', (_label, body) => {
    expect(parseGateMarkers([body])).toEqual([])
  })

  it('does not let an unrecognised level become the record in force', () => {
    const valid = buildGateMarker({ base: BASE, head: HEAD, risk: 'A' })
    const forged = `<!-- me-dev-gate:{"v":1,"base":"${BASE}","head":"${HEAD}","risk":"nonsense"} -->`
    const markers = parseGateMarkers([valid, forged])
    // "Last one wins" would hand the decision to the forged one if it parsed.
    expect(findGateFor({ markers, base: BASE, head: HEAD })?.risk).toBe('A')
  })
})

/**
 * Codex finding on PR #1205 (P2, second half): a marker is a verdict, and
 * anyone who can comment on a PR can type one. The escaping stops a marker
 * being truncated; nothing in the payload stops it being authored by the very
 * person it is meant to constrain.
 */
describe('a marker only counts if a trusted identity wrote it', () => {
  const TRUSTED = 'github-actions[bot]'
  const gate = (risk: string) => buildGateMarker({ base: BASE, head: HEAD, risk })

  it('reads a marker written by a trusted author', () => {
    const found = selectTrustedGateMarkers({
      sources: [{ author: TRUSTED, body: gate('A') }],
      trustedAuthors: [TRUSTED],
    })
    expect(found.map((m: { risk: string }) => m.risk)).toEqual(['A'])
  })

  it('ignores the same marker written by the PR author', () => {
    const found = selectTrustedGateMarkers({
      sources: [{ author: 'bigbigraydeng-maker', body: gate('C') }],
      trustedAuthors: [TRUSTED],
    })
    expect(found).toEqual([])
  })

  it('is not fooled by an author-posted downgrade sitting after the real rating', () => {
    const found = selectTrustedGateMarkers({
      sources: [
        { author: TRUSTED, body: gate('A') },
        { author: 'pr-author', body: gate('C') },
      ],
      trustedAuthors: [TRUSTED],
    })
    expect(findGateFor({ markers: found, base: BASE, head: HEAD })?.risk).toBe('A')
  })

  it.each([
    ['no author field', [{ body: '<!-- x -->' }]],
    ['a null author', [{ author: null, body: '<!-- x -->' }]],
    ['a non-string author', [{ author: 42, body: '<!-- x -->' }]],
    ['a null source', [null]],
  ])('drops a source with %s', (_label, sources) => {
    expect(
      selectTrustedGateMarkers({
        sources: sources.map((s) => (s === null ? s : { ...s, body: gate('A') })),
        trustedAuthors: [TRUSTED],
      }),
    ).toEqual([])
  })

  it('trusts nobody when the allowlist is empty — it does not fall back to reading everything', () => {
    expect(
      selectTrustedGateMarkers({ sources: [{ author: TRUSTED, body: gate('A') }], trustedAuthors: [] }),
    ).toEqual([])
  })

  // Identity is compared against a GitHub login, which is a string. A caller
  // passing a numeric account id on both sides must not accidentally establish
  // trust through `Set.has` matching two numbers — the allowlist keeps strings
  // only, so the comparison can never succeed on a non-login value.
  it('does not trust a non-string identity, even when both sides match', () => {
    expect(
      selectTrustedGateMarkers({
        sources: [{ author: 12345, body: gate('A') }],
        trustedAuthors: [12345],
      }),
    ).toEqual([])
  })

  it('still trusts the string logins in a mixed allowlist', () => {
    expect(
      selectTrustedGateMarkers({
        sources: [{ author: TRUSTED, body: gate('A') }],
        trustedAuthors: [12345, TRUSTED, null],
      }),
    ).toHaveLength(1)
  })

  it('trusts nobody when the allowlist is a bare string, rather than trusting its letters', () => {
    // `trustedAuthors: 'ci-bot'` would become the six characters of that name:
    // an allowlist that looks configured and trusts no real login.
    expect(
      selectTrustedGateMarkers({
        sources: [{ author: 'c', body: gate('A') }],
        trustedAuthors: 'ci-bot',
      }),
    ).toEqual([])
  })

  it('accepts a Set as the allowlist', () => {
    const found = selectTrustedGateMarkers({
      sources: [{ author: TRUSTED, body: gate('B') }],
      trustedAuthors: new Set([TRUSTED]),
    })
    expect(found).toHaveLength(1)
  })

  it('tolerates junk input on both sides', () => {
    expect(selectTrustedGateMarkers()).toEqual([])
    expect(selectTrustedGateMarkers({ sources: 'nope', trustedAuthors: [TRUSTED] })).toEqual([])
  })
})

/**
 * Codex finding on PR #1211 (P1): `github-actions[bot]` is shared by every
 * Actions workflow in the repo, so the author check above is necessary but
 * not sufficient — any other same-repo workflow with `pull-requests: write`
 * can post a comment authored as that same login and forge a rating/verdict.
 * `secret` layers an HMAC signature on top; omitting it must reproduce the
 * pre-existing author-only behaviour exactly (every describe block above
 * this one calls these functions with no `secret` and must keep passing
 * unmodified).
 */
describe('secret-gated provenance on top of the author check', () => {
  const TRUSTED = 'github-actions[bot]'
  const SECRET = 'test-secret-value'
  const OTHER_SECRET = 'a-different-secret'
  const signedGate = (risk: string, secret: string | null = SECRET) =>
    buildGateMarker({ base: BASE, head: HEAD, risk, secret })

  it('omitting secret reproduces the author-only behaviour — a trusted, unsigned marker still counts', () => {
    const found = selectTrustedGateMarkers({
      sources: [{ author: TRUSTED, body: buildGateMarker({ base: BASE, head: HEAD, risk: 'A' }) }],
      trustedAuthors: [TRUSTED],
    })
    expect(found.map((m: { risk: string }) => m.risk)).toEqual(['A'])
  })

  it('accepts a trusted marker whose signature verifies against the same secret', () => {
    const found = selectTrustedGateMarkers({
      sources: [{ author: TRUSTED, body: signedGate('A') }],
      trustedAuthors: [TRUSTED],
      secret: SECRET,
    })
    expect(found.map((m: { risk: string }) => m.risk)).toEqual(['A'])
  })

  it('drops a trusted-author marker with no signature at all once a secret is configured', () => {
    // The exact gap Codex flagged: some other same-repo workflow's ambient
    // GITHUB_TOKEN can author as github-actions[bot] too, but it does not
    // have OPS_GATE_MARKER_SECRET unless someone deliberately wired it in.
    const found = selectTrustedGateMarkers({
      sources: [{ author: TRUSTED, body: buildGateMarker({ base: BASE, head: HEAD, risk: 'A' }) }],
      trustedAuthors: [TRUSTED],
      secret: SECRET,
    })
    expect(found).toEqual([])
  })

  it('drops a trusted-author marker signed with a different secret', () => {
    const found = selectTrustedGateMarkers({
      sources: [{ author: TRUSTED, body: signedGate('A', OTHER_SECRET) }],
      trustedAuthors: [TRUSTED],
      secret: SECRET,
    })
    expect(found).toEqual([])
  })

  it('the author check still applies — a signed marker from an untrusted author is still dropped', () => {
    const found = selectTrustedGateMarkers({
      sources: [{ author: 'bigbigraydeng-maker', body: signedGate('C') }],
      trustedAuthors: [TRUSTED],
      secret: SECRET,
    })
    expect(found).toEqual([])
  })

  it('a forged downgrade cannot ride alongside a genuinely signed rating once a secret is configured', () => {
    const found = selectTrustedGateMarkers({
      sources: [
        { author: TRUSTED, body: signedGate('A') },
        { author: TRUSTED, body: buildGateMarker({ base: BASE, head: HEAD, risk: 'C' }) },
      ],
      trustedAuthors: [TRUSTED],
      secret: SECRET,
    })
    expect(findGateFor({ markers: found, base: BASE, head: HEAD })?.risk).toBe('A')
  })
})

describe('malformed input is skipped, not thrown on', () => {
  it.each([
    ['not JSON', '<!-- me-dev-gate:{nope} -->'],
    ['wrong version', '<!-- me-dev-gate:{"v":99,"base":"a","head":"b","risk":"A"} -->'],
    ['missing head', '<!-- me-dev-gate:{"v":1,"base":"a","risk":"A"} -->'],
    ['risk not a string', '<!-- me-dev-gate:{"v":1,"base":"a","head":"b","risk":3} -->'],
    ['a different marker family', '<!-- ops-codex-loop:stage=ready pr=1 sha=abcdef1 -->'],
  ])('%s yields nothing', (_label, body) => {
    expect(parseGateMarkers([body])).toEqual([])
  })

  it('does not let one corrupted comment hide a valid marker', () => {
    const good = buildGateMarker({ base: BASE, head: HEAD, risk: 'B' })
    expect(parseGateMarkers(['<!-- me-dev-gate:{broken -->', good])).toHaveLength(1)
  })

  it('tolerates junk input types', () => {
    expect(parseGateMarkers(undefined)).toEqual([])
    expect(parseGateMarkers([undefined, null, 42])).toEqual([])
  })

  it('drops non-string reasons rather than carrying them forward', () => {
    const parsed = parseGateMarkers([
      '<!-- me-dev-gate:{"v":1,"base":"a","head":"b","risk":"A","reasons":["ok",7,null]} -->',
    ])
    expect(parsed[0].reasons).toEqual(['ok'])
  })
})

describe('the rating dies when the diff moves', () => {
  const gate = { base: BASE, head: HEAD }

  it('is current for the exact pair it was computed from', () => {
    expect(isGateCurrent(gate, { base: BASE, head: HEAD })).toBe(true)
  })

  it('is stale the moment the head moves — this is the "旧批准立即失效" rule', () => {
    expect(isGateCurrent(gate, { base: BASE, head: 'f'.repeat(40) })).toBe(false)
  })

  it('is stale when the base moves, even if the head did not', () => {
    // A base-branch merge changes what base..head contains without touching the
    // head sha. Binding only the head would call that rating still valid.
    expect(isGateCurrent(gate, { base: 'e'.repeat(40), head: HEAD })).toBe(false)
  })

  it('is stale against nothing at all', () => {
    expect(isGateCurrent(null, { base: BASE, head: HEAD })).toBe(false)
    expect(isGateCurrent(gate, undefined)).toBe(false)
  })
})

describe('findGateFor', () => {
  it('returns null when no rating covers this diff', () => {
    const markers = parseGateMarkers([buildGateMarker({ base: BASE, head: 'a'.repeat(40), risk: 'C' })])
    expect(findGateFor({ markers, base: BASE, head: HEAD })).toBeNull()
  })

  it('takes the most recent rating for the pair, so a re-run supersedes', () => {
    const markers = parseGateMarkers([
      buildGateMarker({ base: BASE, head: HEAD, risk: 'C' }),
      buildGateMarker({ base: BASE, head: HEAD, risk: 'A' }),
    ])
    expect(findGateFor({ markers, base: BASE, head: HEAD })?.risk).toBe('A')
  })

  it('ignores ratings for other shas entirely', () => {
    const markers = parseGateMarkers([
      buildGateMarker({ base: BASE, head: 'a'.repeat(40), risk: 'A' }),
      buildGateMarker({ base: BASE, head: HEAD, risk: 'C' }),
      buildGateMarker({ base: BASE, head: 'b'.repeat(40), risk: 'A' }),
    ])
    expect(findGateFor({ markers, base: BASE, head: HEAD })?.risk).toBe('C')
  })

  it('tolerates junk input', () => {
    expect(findGateFor({ markers: undefined, base: BASE, head: HEAD })).toBeNull()
  })
})
