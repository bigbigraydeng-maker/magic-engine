import { describe, expect, it } from 'vitest'

import { TRUSTED_GATE_AUTHORS, signGateProvenance, verifyGateProvenance } from '../src/trust.mjs'

describe('TRUSTED_GATE_AUTHORS', () => {
  it('trusts only the ambient GITHUB_TOKEN identity', () => {
    expect(TRUSTED_GATE_AUTHORS).toEqual(['github-actions[bot]'])
  })

  it('does not trust the OPS_REVIEW_PAT human identity or a PR author placeholder', () => {
    expect(TRUSTED_GATE_AUTHORS).not.toContain('bigbigraydeng-maker')
    expect(TRUSTED_GATE_AUTHORS).not.toContain('chatgpt-codex-connector')
  })
})

/**
 * Codex finding on PR #1211 (P1): `github-actions[bot]` is shared by every
 * Actions workflow in the repo, so the author allowlist above is necessary
 * but not sufficient — any other same-repo workflow with `pull-requests:
 * write` can post a comment authored as that same login. `gate-marker.mjs`
 * layers this HMAC check on top: a marker only counts once its `sig` field
 * verifies against a secret exclusive to this control plane
 * (`OPS_GATE_MARKER_SECRET`).
 */
describe('signGateProvenance / verifyGateProvenance', () => {
  const SECRET = 'test-secret-value'
  const PAYLOAD = { v: 1, base: 'b'.repeat(40), head: 'c'.repeat(40), risk: 'C', reasons: [] }

  it('produces a deterministic lowercase hex digest for the same payload and secret', () => {
    const a = signGateProvenance(PAYLOAD, SECRET)
    const b = signGateProvenance(PAYLOAD, SECRET)
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]+$/)
  })

  it('verifies a signature computed with the same payload and secret', () => {
    const sig = signGateProvenance(PAYLOAD, SECRET)
    expect(verifyGateProvenance({ ...PAYLOAD, sig }, SECRET)).toBe(true)
  })

  it('ignores whatever `sig` already carries when computing the signature — signing is not self-referential', () => {
    const sig = signGateProvenance({ ...PAYLOAD, sig: 'stale-value' }, SECRET)
    expect(verifyGateProvenance({ ...PAYLOAD, sig }, SECRET)).toBe(true)
  })

  it('rejects a payload tampered after signing — e.g. an upgraded risk level', () => {
    const sig = signGateProvenance(PAYLOAD, SECRET)
    expect(verifyGateProvenance({ ...PAYLOAD, risk: 'A', sig }, SECRET)).toBe(false)
  })

  it('rejects a tampered score/decision bolted onto an otherwise-genuine signed rating', () => {
    // The exact forgery this check exists to close off: take a genuinely
    // signed C-level rating (no score/decision yet) and try to append a
    // forged READY verdict without re-signing.
    const sig = signGateProvenance(PAYLOAD, SECRET)
    expect(
      verifyGateProvenance({ ...PAYLOAD, score: 100, decision: 'READY_FOR_PRODUCT_OWNER', sig }, SECRET),
    ).toBe(false)
  })

  it('rejects a signature produced with a different secret', () => {
    const sig = signGateProvenance(PAYLOAD, 'a-different-secret')
    expect(verifyGateProvenance({ ...PAYLOAD, sig }, SECRET)).toBe(false)
  })

  it('fails closed when no secret is configured — a missing OPS_GATE_MARKER_SECRET must not read as "trusted"', () => {
    const sig = signGateProvenance(PAYLOAD, SECRET)
    expect(verifyGateProvenance({ ...PAYLOAD, sig }, undefined)).toBe(false)
    expect(verifyGateProvenance({ ...PAYLOAD, sig }, null)).toBe(false)
    expect(verifyGateProvenance({ ...PAYLOAD, sig }, '')).toBe(false)
  })

  it('fails closed when the payload carries no signature at all', () => {
    expect(verifyGateProvenance(PAYLOAD, SECRET)).toBe(false)
  })

  it('fails closed on junk input rather than throwing', () => {
    expect(verifyGateProvenance(null, SECRET)).toBe(false)
    expect(verifyGateProvenance({ sig: 'not-hex-!!' }, SECRET)).toBe(false)
    expect(verifyGateProvenance({ sig: 42 }, SECRET)).toBe(false)
  })
})
