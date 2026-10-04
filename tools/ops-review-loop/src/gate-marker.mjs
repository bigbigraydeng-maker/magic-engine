/**
 * The machine-readable half of the dev gate: one hidden HTML comment per
 * rating, carrying the level, the two shas it was computed from, and the
 * reasons.
 *
 *   <!-- me-dev-gate:{"v":1,"base":"<sha>","head":"<sha>","risk":"A","reasons":["..."]} -->
 *
 * 🔴 **Why the rating is bound to a pair of shas.**
 *
 * A rating describes a diff, and a diff is `base..head`. Carrying only the head
 * would make a rating look valid after a rebase or a base-branch merge changed
 * what the diff contains; carrying only the base would make it survive the very
 * push it is supposed to re-trigger on. Both are in the payload, and
 * `isGateCurrent` requires both to match — so the Product Owner's rule ("head
 * 一动，旧评级、旧质量分和旧 Codex 批准立即失效") is a comparison, not a habit.
 *
 * 🔴 **Why the payload is escaped before it is embedded.**
 *
 * The reasons are built from `risk.mjs`'s own table today, but they contain
 * file paths taken from the PR, and this string is embedded in an HTML comment.
 * A path containing `-->` would close the comment early and leave the rest of
 * the payload rendered as visible PR text — a marker that reads as valid to a
 * human while parsing as something else, or not at all. So every `<` and `>` in
 * the serialised JSON is written as a `\u003c` / `\u003e` escape (legal JSON,
 * decoded transparently by `JSON.parse`, and structurally impossible inside an
 * HTML comment delimiter), and the builder verifies the finished marker
 * round-trips before returning it. Same reasoning as `output.mjs`: if the
 * transport is forgeable, escaping the payload's *contents* fixes nothing.
 *
 * This module deliberately does not extend `markers.mjs`. That module's
 * `stage=/pr=/sha=` markers are the *loop's* state ledger and are matched by a
 * strict regex; this is a *rating record* with a structured payload. One regex
 * serving both would have to loosen to fit, and the loosened one is the one
 * that decides whether an automated push happens.
 *
 * 🔴 **Provenance beyond the author login (Codex finding, PR #1211 P1).**
 *
 * `selectTrustedGateMarkers` already drops anything not authored by
 * `TRUSTED_GATE_AUTHORS` (`trust.mjs`), but that login —
 * `github-actions[bot]` — is shared by every GitHub Actions workflow in the
 * repo, not exclusive to this control plane. When a `secret` is supplied
 * (this control plane's own `OPS_GATE_MARKER_SECRET`), `buildGateMarker`
 * additionally signs the payload (`trust.mjs`'s `signGateProvenance`) and
 * `selectTrustedGateMarkers` requires that signature to verify before
 * trusting a marker — a forged comment from some other same-repo workflow
 * cannot produce it without the secret. `secret` is optional and additive on
 * purpose: omitting it reproduces this module's pre-existing, author-only
 * behaviour exactly (every test and call site written before this
 * protection existed keeps working unchanged), while every one of this PR's
 * three entrypoint scripts is wired to read the real secret from
 * `process.env.OPS_GATE_MARKER_SECRET` and pass it through — so once that
 * secret is provisioned, verification is enforced end to end.
 */

import { signGateProvenance, verifyGateProvenance } from './trust.mjs'

/** Payload schema version. Bump only with a parser that still reads v1. */
export const GATE_MARKER_VERSION = 1

/**
 * @typedef {object} GateRecord
 * @property {number} v
 * @property {string} base
 * @property {string} head
 * @property {string} risk
 * @property {string[]} reasons
 * @property {number} [score]
 * @property {string} [decision]
 */

const MARKER_RE = /<!--\s*me-dev-gate:(\{[^]*?\})\s*-->/g

/**
 * The only levels a marker may carry.
 *
 * 🔴 Codex finding on PR #1205 (P2): the parser only checked that `risk` was a
 * string, so a marker claiming `"risk":"nonsense"` parsed as valid and became
 * the record in force. The score threshold falls back to A's 90 for an
 * unrecognised level — but the *category-matched evidence* gate only runs when
 * `risk === 'A'`, so an unrecognised level skipped it entirely. A level nobody
 * recognises must not be storable, not merely scored strictly.
 */
const VALID_RISKS = new Set(['A', 'B', 'C'])

/**
 * Serialise the payload so it can never contain an HTML comment delimiter.
 *
 * `<` and `>` are not JSON structural characters, so replacing every one of
 * them with its `\uXXXX` escape changes no parse result — it only removes the
 * two characters an HTML comment could end on.
 *
 * @param {object} payload
 * @returns {string}
 */
function serialisePayload(payload) {
  return JSON.stringify(payload).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
}

/**
 * Build one gate marker.
 *
 * @param {{base: string, head: string, risk: string, reasons?: string[], score?: number|null, decision?: string|null, secret?: string|null}} input
 *   `secret`, when a non-empty string, signs the payload — see the module
 *   header's "Provenance beyond the author login" section.
 * @returns {string}
 * @throws if the marker does not survive its own parser
 */
export function buildGateMarker({ base, head, risk, reasons = [], score = null, decision = null, secret = null }) {
  if (!VALID_RISKS.has(risk)) {
    throw new Error(`refusing to emit a gate marker with risk "${risk}" — only A / B / C are storable`)
  }
  const payload = {
    v: GATE_MARKER_VERSION,
    base: String(base),
    head: String(head),
    risk: String(risk),
    reasons: (Array.isArray(reasons) ? reasons : []).map((r) => String(r)),
  }
  // Optional, and omitted rather than nulled when absent: a `"score":null` in
  // the record reads like "we measured zero", which is a different claim from
  // "we did not measure".
  if (Number.isFinite(score)) payload.score = score
  if (typeof decision === 'string' && decision !== '') payload.decision = decision
  // Signed last, over every field above — see trust.mjs's signGateProvenance
  // for why the whole payload (not just base/head/risk) has to be covered.
  if (typeof secret === 'string' && secret !== '') {
    payload.sig = signGateProvenance(payload, secret)
  }

  const marker = `<!-- me-dev-gate:${serialisePayload(payload)} -->`

  // Prove it, do not assume it. The escaping above is the whole defence, and a
  // defence nobody checks is a defence that stops working the day someone edits
  // the serialiser.
  const [roundTripped] = parseGateMarkers([marker])
  if (!roundTripped || roundTripped.head !== payload.head || roundTripped.risk !== payload.risk) {
    throw new Error('refusing to emit a gate marker that does not survive its own parser')
  }
  return marker
}

/**
 * Read every gate marker out of a set of comment bodies, newest last (input
 * order is preserved).
 *
 * Malformed payloads are skipped, not thrown on: one corrupted comment must not
 * make the whole PR unreadable. A caller that finds no *valid* marker is in the
 * "no rating on record" state, which every gate here already treats as blocking.
 *
 * @param {Array<string|null|undefined>|unknown} bodies
 * @returns {GateRecord[]}
 */
export function parseGateMarkers(bodies) {
  const out = []
  for (const body of Array.isArray(bodies) ? bodies : []) {
    if (typeof body !== 'string') continue
    for (const match of body.matchAll(MARKER_RE)) {
      let payload
      try {
        payload = JSON.parse(match[1])
      } catch {
        continue
      }
      if (!payload || typeof payload !== 'object') continue
      if (payload.v !== GATE_MARKER_VERSION) continue
      if (typeof payload.base !== 'string' || typeof payload.head !== 'string') continue
      if (!VALID_RISKS.has(payload.risk)) continue
      out.push({
        ...payload,
        reasons: Array.isArray(payload.reasons) ? payload.reasons.filter((r) => typeof r === 'string') : [],
      })
    }
  }
  return out
}

/**
 * Is this rating still describing the PR as it stands?
 *
 * @param {{base: string, head: string}|null|undefined} gate
 * @param {{base: string, head: string}|null|undefined} current
 * @returns {boolean}
 */
export function isGateCurrent(gate, current) {
  if (!gate || !current) return false
  return gate.base === current.base && gate.head === current.head
}

/**
 * The rating in force for `base..head`, or `null`.
 *
 * Last match wins: a re-rating posted later for the same pair supersedes an
 * earlier one, which is what a manual re-run of the gate is supposed to do.
 *
 * @param {{markers: GateRecord[]|unknown, base: string, head: string}} input
 * @returns {GateRecord|null}
 */
export function findGateFor({ markers, base, head }) {
  const matches = (Array.isArray(markers) ? markers : []).filter((m) => isGateCurrent(m, { base, head }))
  return matches.length === 0 ? null : matches[matches.length - 1]
}

/**
 * Must a fresh rating comment be posted? Yes when nothing is on record for
 * this pair, or the record disagrees on the risk OR the auto-merge decision.
 *
 * The decision matters because an `edited` run (the PR body's 当场试跑 section
 * filled in) flips it without moving the head; comparing only the risk left a
 * stale "❌ 当场试跑不合格" comment next to a green check (魏征 W78-2, #2078).
 *
 * @param {{existing: GateRecord|null|undefined, risk: string, decision: string}} input
 * @returns {boolean}
 */
export function shouldPostGateComment({ existing, risk, decision }) {
  if (!existing) return true
  return existing.risk !== risk || existing.decision !== decision
}

/**
 * Read gate markers only from sources whose author is trusted.
 *
 * 🔴 Codex finding on PR #1205 (P2, second half): a gate marker is a *verdict*,
 * and anyone who can comment on a PR — including its author — can type one.
 * Without an author check, an author who did not like being rated A can post
 * `<!-- me-dev-gate:{"v":1,...,"risk":"C"} -->` for their own base/head pair,
 * and "last one wins" hands it the decision. The marker's escaping stops it
 * being *truncated*; nothing in the payload stops it being *authored*.
 *
 * So the identity check is a separate, explicit step, and this is the only
 * supported way to read markers off PR comments. A source with no author, or an
 * author not on the list, is dropped — the wiring PR must pass the identity
 * that actually writes the rating (the check-run producer, or the loop's own
 * bot login), never `github.event.pull_request.user.login`.
 *
 * Provenance is a property of *where the text came from*, which is why this
 * cannot be folded into `parseGateMarkers`: that function is handed strings and
 * has no way to know.
 *
 * 🔴 Codex finding on PR #1211 (P1): the author check above is necessary but
 * not sufficient — `github-actions[bot]` is the login every Actions workflow
 * in the repo shares, not one exclusive to this control plane, so any other
 * same-repo workflow with `pull-requests: write` can satisfy it too. When
 * `secret` is supplied, a marker additionally has to carry a `sig` that
 * verifies against it (`trust.mjs`'s `verifyGateProvenance`) — omitting
 * `secret` reproduces the pre-existing author-only behaviour exactly, so
 * every caller written before this protection existed is unaffected.
 *
 * @param {{sources?: Array<{author?: string|null, body?: string|null}>|unknown, trustedAuthors?: Iterable<string>|unknown, secret?: string|null}} input
 * @returns {GateRecord[]}
 */
export function selectTrustedGateMarkers({ sources, trustedAuthors, secret = null } = {}) {
  // A bare string is rejected rather than iterated: `trustedAuthors: 'ci-bot'`
  // would otherwise become the six single characters of that name, trusting
  // nobody while looking configured.
  const iterable =
    trustedAuthors !== null &&
    trustedAuthors !== undefined &&
    typeof trustedAuthors !== 'string' &&
    typeof trustedAuthors[Symbol.iterator] === 'function'
  // Only string logins enter the allowlist, and that single normalisation is
  // what makes every later comparison safe: identity is a GitHub login, so a
  // caller passing a numeric account id must not be able to establish trust by
  // having `Set.has` match two numbers.
  //
  // Two other guards were written here and removed, both for the same reason —
  // a branch no test can reach is a branch that quietly stops working:
  //   - `trusted.size === 0` early return: an empty Set already makes every
  //     `has()` false, so an empty allowlist trusts nobody regardless.
  //   - `typeof s.author === 'string'` on the source side: given the allowlist
  //     holds strings only, a non-string author can never match anyway.
  // Deleting either one alone left the suite green, which is the definition of
  // a guard that is not doing the work. One guard, one test, no illusion.
  const trusted = new Set([...(iterable ? trustedAuthors : [])].filter((a) => typeof a === 'string'))
  if (!Array.isArray(sources)) return []
  const bodies = sources.filter((s) => s && trusted.has(s.author)).map((s) => s.body)
  const candidates = parseGateMarkers(bodies)
  // Additive, not a replacement for the author check above: `secret` unset
  // (the pre-existing default) keeps this function's original behaviour
  // byte-for-byte. `secret` set requires every candidate's `sig` to verify —
  // one that does not (missing, forged, or signed by a different secret) is
  // dropped exactly like an untrusted author would be.
  if (typeof secret !== 'string' || secret === '') return candidates
  return candidates.filter((record) => verifyGateProvenance(record, secret))
}
