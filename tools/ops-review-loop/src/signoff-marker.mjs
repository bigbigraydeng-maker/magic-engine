/**
 * The machine-readable half of the review sign-off gate: one hidden HTML
 * comment per reviewer role, carrying the role, the verdict, and the two shas
 * it was computed from.
 *
 *   <!-- me-review-signoff:{"v":1,"base":"<sha>","head":"<sha>","role":"codex-astra","verdict":"pass"} -->
 *
 * 🔴 **Why the sign-off is bound to a pair of shas.**
 *
 * A sign-off describes a diff, and a diff is `base..head`. Carrying only the
 * head would make a sign-off look valid after a rebase or a base-branch merge
 * changed what the diff contains; carrying only the base would make it survive
 * the very push it is supposed to re-trigger on. Both are in the payload, and
 * `evaluateSignoffs` requires both to match — so "head 一动，旧批准立即失效" is a
 * comparison, not a habit.
 *
 * 🔴 **Why only `pass` is storable, and a failed review writes nothing.**
 *
 * A marker is a *claim of approval*. If a failed review also wrote a marker,
 * the gate would have to distinguish "a marker exists" from "a marker says
 * pass", and every reader would have to remember which. Instead, absence
 * blocks: a role with no marker for this exact pair is missing, and a missing
 * role is not complete. There is no `"verdict":"fail"` to parse, so there is no
 * way to write one that a reader might mistake for a pass.
 *
 * 🔴 **Why the payload is escaped before it is embedded.**
 *
 * The payload is embedded in an HTML comment. A value containing `-->` would
 * close the comment early and leave the rest of the payload rendered as visible
 * PR text — a marker that reads as valid to a human while parsing as something
 * else, or not at all. So every `<` and `>` in the serialised JSON is written
 * as a `\u003c` / `\u003e` escape (legal JSON, decoded transparently by
 * `JSON.parse`, and structurally impossible inside an HTML comment delimiter),
 * and the builder verifies the finished marker round-trips before returning it.
 * Same reasoning as `gate-marker.mjs`: if the transport is forgeable, escaping
 * the payload's *contents* fixes nothing.
 *
 * 🔴 **Why `github-actions[bot]` and the PR author are never trusted.**
 *
 * An A-level sign-off is two independent verdicts: Codex Astra reviews, and
 * Claude Code reviews again on its own. Any `pull_request` workflow running on
 * the PR branch can post a comment as `github-actions[bot]` — so a bot login in
 * the allowlist would let the PR's own CI sign its own review. And a PR author
 * signing their own review is no gate at all. Both are removed from the trusted
 * set *after* it is built, so naming them in the allowlist cannot re-admit them.
 * One login also cannot fill both seats: each required role is bound to its own
 * login, and a login already used for one role cannot satisfy the other.
 */

/** Payload schema version. Bump only with a parser that still reads v1. */
export const SIGNOFF_MARKER_VERSION = 1

/**
 * The reviewer roles that must all sign an A-level PR, in report order.
 *
 * Exactly two, and they are not interchangeable: `codex-astra` is Codex Astra's
 * review, `claude-code` is Claude Code's independent review. Frozen order:
 * `evaluateSignoffs` returns `present` / `missing` in this order, so a caller
 * can render the list without sorting it.
 */
export const REQUIRED_SIGNOFF_ROLES = ['codex-astra', 'claude-code']

/**
 * Former required reviewers. They may be recorded on a B-level PR as an
 * optional spot check. They are not required at any level, and a missing spot
 * check never blocks a merge — including B and C, which auto-merge on green
 * checks alone.
 */
export const SPOT_CHECK_ROLES = ['ziya', 'weizheng', 'direnjie']

/** Roles a marker may name. Required roles first, then the non-blocking spot checks. */
export const STORABLE_SIGNOFF_ROLES = [...REQUIRED_SIGNOFF_ROLES, ...SPOT_CHECK_ROLES]

/**
 * The only verdicts a marker may carry.
 *
 * Only `pass` is storable. A failed review writes no marker at all — absence
 * blocks — so there is no `fail` value for a reader to mis-handle.
 */
export const SIGNOFF_VERDICTS = ['pass']

/**
 * Logins that can never be trusted, even when the allowlist names them.
 *
 * `github-actions[bot]` is the identity any `pull_request` workflow on the PR
 * branch posts as, so trusting it would let the PR's own CI sign its own
 * review. This is a denylist applied *after* the allowlist, not a default the
 * caller can override.
 */
export const NEVER_TRUSTED_SIGNOFF_AUTHORS = ['github-actions[bot]']

const MARKER_RE = /<!--\s*me-review-signoff:(\{[^]*?\})\s*-->/g

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
 * Build one sign-off marker.
 *
 * @param {{base: string, head: string, role: string, verdict?: string}} input
 * @returns {string}
 * @throws if the role or verdict is not storable, or the marker does not survive its own parser
 */
export function buildSignoffMarker({ base, head, role, verdict = 'pass' }) {
  if (!STORABLE_SIGNOFF_ROLES.includes(role)) {
    throw new Error(
      `refusing to emit a sign-off marker with role "${role}" — only ${STORABLE_SIGNOFF_ROLES.join(' / ')} are storable`,
    )
  }
  if (!SIGNOFF_VERDICTS.includes(verdict)) {
    throw new Error(
      `refusing to emit a sign-off marker with verdict "${verdict}" — only ${SIGNOFF_VERDICTS.join(' / ')} are storable`,
    )
  }
  const payload = {
    v: SIGNOFF_MARKER_VERSION,
    base: String(base),
    head: String(head),
    role: String(role),
    verdict: String(verdict),
  }

  const marker = `<!-- me-review-signoff:${serialisePayload(payload)} -->`

  // Prove it, do not assume it. The escaping above is the whole defence, and a
  // defence nobody checks is a defence that stops working the day someone edits
  // the serialiser.
  const [roundTripped] = parseSignoffMarkers([marker])
  if (!roundTripped || roundTripped.head !== payload.head || roundTripped.role !== payload.role) {
    throw new Error('refusing to emit a sign-off marker that does not survive its own parser')
  }
  return marker
}

/**
 * Read every sign-off marker out of a set of comment bodies, in input order.
 *
 * Malformed payloads are skipped, not thrown on: one corrupted comment must not
 * make the whole PR unreadable. A caller that finds no *valid* marker for a
 * role is in the "that role has not signed off" state, which the gate treats as
 * blocking.
 *
 * @param {Array<string|null|undefined>|unknown} bodies
 * @returns {Array<{v: number, base: string, head: string, role: string, verdict: string}>}
 */
export function parseSignoffMarkers(bodies) {
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
      if (payload.v !== SIGNOFF_MARKER_VERSION) continue
      if (typeof payload.base !== 'string' || typeof payload.head !== 'string') continue
      if (!STORABLE_SIGNOFF_ROLES.includes(payload.role)) continue
      if (!SIGNOFF_VERDICTS.includes(payload.verdict)) continue
      out.push({
        v: payload.v,
        base: payload.base,
        head: payload.head,
        role: payload.role,
        verdict: payload.verdict,
      })
    }
  }
  return out
}

/**
 * Read sign-off markers only from sources whose author is trusted.
 *
 * 🔴 A marker is a *verdict*, and anyone who can comment on a PR can type one.
 * The escaping stops a marker being *truncated*; nothing in the payload stops
 * it being *authored*. So the identity check is a separate, explicit step, and
 * this is the only supported way to read markers off PR comments.
 *
 * Two logins are removed from the trusted set *after* it is built, so naming
 * them in the allowlist cannot re-admit them:
 *   - every login in `NEVER_TRUSTED_SIGNOFF_AUTHORS`: any `pull_request`
 *     workflow on the PR branch can post as `github-actions[bot]`, so trusting
 *     it would let the PR's own CI sign its own review;
 *   - `prAuthor`: a PR author signing their own review is no gate at all.
 *
 * Provenance is a property of *where the text came from*, which is why this
 * cannot be folded into `parseSignoffMarkers`: that function is handed strings
 * and has no way to know.
 *
 * @param {{sources?: Array<{author?: string|null, body?: string|null}>|unknown, trustedAuthors?: Iterable<string>|unknown, prAuthor?: string|null}} input
 * @returns {Array<{v: number, base: string, head: string, role: string, verdict: string}>}
 */
export function selectTrustedSignoffMarkers({ sources, trustedAuthors, prAuthor } = {}) {
  // A bare string is rejected rather than iterated: `trustedAuthors: 'codex-bot'`
  // would otherwise become the single characters of that name, trusting
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
  const trusted = new Set([...(iterable ? trustedAuthors : [])].filter((a) => typeof a === 'string'))
  // Applied after the allowlist, so a caller cannot re-admit either identity by
  // naming it. `prAuthor` is only removed when it is a non-empty string, so a
  // missing or blank author does not accidentally delete a real login.
  for (const never of NEVER_TRUSTED_SIGNOFF_AUTHORS) trusted.delete(never)
  if (typeof prAuthor === 'string' && prAuthor !== '') trusted.delete(prAuthor)

  if (!Array.isArray(sources)) return []
  const out = []
  for (const source of sources) {
    if (!source || !trusted.has(source.author)) continue
    for (const marker of parseSignoffMarkers([source.body])) {
      out.push({ ...marker, author: source.author })
    }
  }
  return out
}

/**
 * Parse `SIGNOFF_TRUSTED_LOGINS` into role → login bindings.
 *
 * The only form that can satisfy an A-level sign-off is role-bound:
 * `codex-astra=<login>,claude-code=<login>`. Optional spot-check bindings
 * (`ziya=<login>` and the same for weizheng / direnjie) only add logins that
 * may record a non-blocking marker. A bare login with no role is ignored, so
 * a leftover flat list cannot let one identity sign both seats.
 *
 * @param {unknown} raw
 * @returns {{byRole: Record<string, string>, logins: string[]}}
 */
export function parseSignoffTrust(raw) {
  /** @type {Record<string, string>} */
  const byRole = {}
  if (typeof raw !== 'string') return { byRole, logins: [] }
  const known = new Set(STORABLE_SIGNOFF_ROLES)
  for (const part of raw.split(',')) {
    const trimmed = part.trim()
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const role = trimmed.slice(0, eq).trim()
    const login = trimmed.slice(eq + 1).trim()
    if (login === '' || !known.has(role)) continue
    byRole[role] = login
  }
  return { byRole, logins: [...new Set(Object.values(byRole))] }
}

/**
 * Does this marker sign `role` for this exact diff, as `author`?
 *
 * @param {unknown} marker
 * @param {string} role
 * @param {string} base
 * @param {string} head
 * @param {string} author
 * @returns {boolean}
 */
function markerMatches(marker, role, base, head, author) {
  if (!marker || typeof marker !== 'object') return false
  const row = /** @type {{base?: unknown, head?: unknown, role?: unknown, author?: unknown}} */ (marker)
  return row.base === base && row.head === head && row.role === role && row.author === author
}

/**
 * Which required roles have signed off for this exact diff?
 *
 * A marker counts only when both shas match AND its author is the login bound
 * to that role. A head move or a base move invalidates every sign-off. The same
 * login cannot fill both seats, even if the variable names it twice. Spot-check
 * roles are ignored here. `present` / `missing` follow `REQUIRED_SIGNOFF_ROLES`.
 *
 * @param {{markers?: unknown, base?: string, head?: string, roleAuthors?: Record<string, string>|null}} input
 * @returns {{complete: boolean, present: string[], missing: string[]}}
 */
export function evaluateSignoffs({ markers, base, head, roleAuthors } = {}) {
  const all = [...REQUIRED_SIGNOFF_ROLES]
  if (typeof base !== 'string' || base === '' || typeof head !== 'string' || head === '') {
    return { complete: false, present: [], missing: all }
  }
  const list = Array.isArray(markers) ? markers : []
  const bindings = roleAuthors && typeof roleAuthors === 'object' ? roleAuthors : {}
  const usedAuthors = new Set()
  const present = []
  for (const role of all) {
    const author = typeof bindings[role] === 'string' ? bindings[role] : ''
    if (author === '' || usedAuthors.has(author)) continue
    if (!list.some((marker) => markerMatches(marker, role, base, head, author))) continue
    usedAuthors.add(author)
    present.push(role)
  }
  const missing = all.filter((role) => !present.includes(role))
  return { complete: missing.length === 0, present, missing }
}

/**
 * Which optional spot-check roles were recorded for this exact diff?
 *
 * This is a report, not a gate. `missing` here never feeds `decideMerge`.
 *
 * @param {{markers?: Array<{base?: string, head?: string, role?: string}>|unknown, base?: string, head?: string}} input
 * @returns {{present: string[], missing: string[]}}
 */
export function listSpotChecks({ markers, base, head } = {}) {
  const all = [...SPOT_CHECK_ROLES]
  if (typeof base !== 'string' || base === '' || typeof head !== 'string' || head === '') {
    return { present: [], missing: all }
  }
  const list = Array.isArray(markers) ? markers : []
  const present = all.filter((role) =>
    list.some((marker) => marker && marker.base === base && marker.head === head && marker.role === role),
  )
  return { present, missing: all.filter((role) => !present.includes(role)) }
}

/**
 * The sign-off state the risk gate acts on: trusted markers only, two required
 * roles bound to two logins, and spot checks reported beside that.
 *
 * @param {{rawTrust?: unknown, sources?: Array<{author?: string|null, body?: string|null}>|unknown, prAuthor?: string|null, base?: string, head?: string}} input
 * @returns {{trust: {byRole: Record<string, string>, logins: string[]}, markers: Array<{v: number, base: string, head: string, role: string, verdict: string, author: string}>, signoff: {complete: boolean, present: string[], missing: string[]}, spotChecks: {present: string[], missing: string[]}, ignoredMarkers: number}}
 */
export function reviewSignoffState({ rawTrust, sources, prAuthor, base, head } = {}) {
  const trust = parseSignoffTrust(rawTrust)
  const list = Array.isArray(sources) ? sources : []
  const parsedAll = parseSignoffMarkers(list.map((source) => (source ? source.body : null)))
  const markers = selectTrustedSignoffMarkers({
    sources: list,
    trustedAuthors: trust.logins,
    prAuthor,
  })
  return {
    trust,
    markers,
    signoff: evaluateSignoffs({ markers, base, head, roleAuthors: trust.byRole }),
    spotChecks: listSpotChecks({ markers, base, head }),
    ignoredMarkers: parsedAll.length - markers.length,
  }
}
