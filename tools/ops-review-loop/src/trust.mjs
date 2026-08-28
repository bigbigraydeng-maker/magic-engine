import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * The only identity this loop's own dev-gate records trust — the author
 * `gate-marker.mjs`'s `selectTrustedGateMarkers` is told to accept.
 *
 * Every marker this tool writes for itself (rating, quality decision) is
 * posted with the ambient `GITHUB_TOKEN`, which authors as exactly this
 * login. Two identities are deliberately excluded:
 *
 *   - The PR author. A gate marker is a verdict about the PR; letting the PR
 *     author's own login count would let them hand-type a downgrade (see
 *     gate-marker.mjs's header comment and tests).
 *   - `OPS_REVIEW_PAT`'s identity (a human Product Owner account). It posts
 *     "@codex review" because Codex only answers a human-authored comment —
 *     but that same human can comment on their own PRs for any reason, and
 *     trusting that account here would let an ordinary comment carry the
 *     same weight as this tool's own computed output.
 *
 * A single shared constant so every script that reads a gate marker uses the
 * same allowlist rather than each hand-typing the login and drifting apart.
 *
 * 🔴 Codex finding on PR #1211 (P1): `github-actions[bot]` is not actually an
 * identity exclusive to this control plane — it is the login EVERY GitHub
 * Actions workflow's ambient `GITHUB_TOKEN` authors as, repo-wide. Any other
 * same-repo workflow granted `pull-requests: write` can post a comment that
 * satisfies this allowlist and forge a C-level rating or a READY verdict for
 * the current base/head. This allowlist is necessary — it still rules out
 * the PR author and the human PAT — but it is not sufficient on its own; see
 * `signGateProvenance`/`verifyGateProvenance` below for the second, harder
 * to forge check `gate-marker.mjs` layers on top of it.
 */
export const TRUSTED_GATE_AUTHORS = ['github-actions[bot]']

/**
 * The exact fields a gate marker's payload signs — everything but `sig`
 * itself, in whatever key order the caller's object already has.
 *
 * @param {Record<string, unknown>|null|undefined} payload
 * @returns {Record<string, unknown>}
 */
function withoutSig(payload) {
  if (!payload || typeof payload !== 'object') return {}
  const { sig: _sig, ...rest } = payload
  return rest
}

/**
 * HMAC-SHA256 over a gate marker's payload (every field except `sig`),
 * keyed on `secret` — the value this control plane's three entrypoint
 * workflows (and only them) are meant to receive as `OPS_GATE_MARKER_SECRET`.
 *
 * 🔴 Why this signs the WHOLE payload, not just base/head/risk: a rating
 * marker (no `score`/`decision` yet) and the later quality-decision marker
 * for the same base/head are different payloads. Signing only the fields
 * common to both would let an attacker take a genuinely-signed C-level
 * rating and bolt on a forged `score`/`decision` pair without invalidating
 * the signature — exactly the "no actual grading, straight to READY" outcome
 * this check exists to close off. `gate-marker.mjs` calls this on the same
 * object it is about to serialise, before the `sig` field is added, so every
 * field the marker actually carries is covered.
 *
 * @param {Record<string, unknown>} payload
 * @param {string} secret
 * @returns {string} lowercase hex digest
 */
export function signGateProvenance(payload, secret) {
  return createHmac('sha256', secret).update(JSON.stringify(withoutSig(payload))).digest('hex')
}

/**
 * Does `payload.sig` actually prove `secret` produced this exact payload?
 *
 * Fails closed on every input that cannot prove anything: no secret
 * configured, no `sig` on the payload, or a `sig` that does not match — all
 * return `false` rather than falling back to "assume it is fine". A missing
 * `OPS_GATE_MARKER_SECRET` is indistinguishable, on purpose, from "we cannot
 * verify this marker" — see `gate-marker.mjs`'s `selectTrustedGateMarkers`
 * for how that composes with the author allowlist above.
 *
 * @param {Record<string, unknown>|null|undefined} payload must carry `sig`
 * @param {string|null|undefined} secret
 * @returns {boolean}
 */
export function verifyGateProvenance(payload, secret) {
  if (typeof secret !== 'string' || secret === '') return false
  const sig = payload && typeof payload === 'object' ? payload.sig : undefined
  if (typeof sig !== 'string' || sig === '' || !/^[0-9a-f]+$/i.test(sig)) return false
  const expected = signGateProvenance(payload, secret)
  const expectedBuf = Buffer.from(expected, 'hex')
  const actualBuf = Buffer.from(sig, 'hex')
  if (expectedBuf.length !== actualBuf.length) return false
  return timingSafeEqual(expectedBuf, actualBuf)
}
