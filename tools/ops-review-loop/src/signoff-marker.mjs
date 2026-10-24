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

import { isMergeBlockingSeverity } from './severity.mjs'

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
 * check never blocks a merge. B and C auto-merge only after Codex has reviewed
 * the current head with no unresolved P0/P1 (`evaluateCodexHeadReview`).
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

// --- Codex review of the current head (B/C auto-merge) -----------------------
//
// Observed 2026-10-24 on this repo, login chatgpt-codex-connector[bot]:
//
//   Clean review (#3086, #3091): `/pulls/{n}/reviews` is empty. Codex posts two
//   issue comments. The one that binds the head is
//   `<!-- codex-review-state:v1 {"code_review":{"commit_sha":"<40 hex>",
//   "has_any_findings":false,"has_unresolved_findings":false,"status":"completed"}} -->`.
//   The receipt comment says "Didn't find any major issues" and only a short
//   sha (`**Reviewed commit:** \`8d6681811d\``). A short sha is not a binding.
//
//   Review with findings (#3080): a pull-request review (state COMMENTED,
//   `commit_id` = full head) plus an inline comment. The finding is a shields
//   badge (`badge/P2-yellow` / `P2 Badge`) and `<!-- codex-code-review-finding:v1 -->`.
//   The same state comment is posted, with has_unresolved_findings true.
//   That boolean covers P2 as well, so it is not the P0/P1 gate. Resolution is
//   GraphQL `reviewThread.isResolved` (REST comments have no such field).
//
// Head binding matches `evaluateSignoffs`: the reviewed commit must be the
// current head. Codex does not record the base sha, so this check binds head
// only. Trust is the `codex-astra` login from `parseSignoffTrust`, with the
// same denylist (`github-actions[bot]`, the PR author).

const CODEX_STATE_RE = /<!--\s*codex-review-state:v1\s+(\{[^]*?\})\s*-->/g
const HEAD_SHA_RE = /^[0-9a-f]{40}$/i
const CODEX_REVIEW_STATES = new Set(['COMMENTED', 'APPROVED', 'CHANGES_REQUESTED'])

/**
 * @param {unknown} login
 * @returns {string}
 */
function normaliseLogin(login) {
  if (typeof login !== 'string') return ''
  return login.trim().toLowerCase().replace(/\[bot\]$/, '')
}

/**
 * GraphQL omits the `[bot]` suffix that REST includes. Both shapes are the
 * same account.
 *
 * @param {unknown} actual
 * @param {unknown} trusted
 * @returns {boolean}
 */
function loginMatchesTrusted(actual, trusted) {
  const left = normaliseLogin(actual)
  const right = normaliseLogin(trusted)
  return left !== '' && left === right
}

/**
 * @param {unknown} trustedLogin
 * @param {unknown} prAuthor
 * @returns {boolean}
 */
function codexLoginUsable(trustedLogin, prAuthor) {
  if (typeof trustedLogin !== 'string' || trustedLogin.trim() === '') return false
  if (NEVER_TRUSTED_SIGNOFF_AUTHORS.some((never) => loginMatchesTrusted(trustedLogin, never))) return false
  if (typeof prAuthor === 'string' && prAuthor !== '' && loginMatchesTrusted(trustedLogin, prAuthor)) return false
  return true
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isHeadSha(value) {
  return typeof value === 'string' && HEAD_SHA_RE.test(value)
}

/**
 * Read completed Codex state blobs. A non-completed status, or a commit that
 * is not a full sha, is ignored.
 *
 * @param {unknown} body
 * @returns {Array<{commitSha: string}>}
 */
export function parseCodexReviewStates(body) {
  if (typeof body !== 'string') return []
  const out = []
  for (const match of body.matchAll(CODEX_STATE_RE)) {
    let payload
    try {
      payload = JSON.parse(match[1])
    } catch {
      continue
    }
    const code = payload && typeof payload === 'object' ? payload.code_review : null
    if (!code || typeof code !== 'object') continue
    if (code.status !== 'completed' || !isHeadSha(code.commit_sha)) continue
    out.push({ commitSha: String(code.commit_sha).toLowerCase() })
  }
  return out
}

/**
 * @param {unknown} review
 * @param {string} trustedLogin
 * @returns {boolean}
 */
function isCodexReview(review, trustedLogin) {
  if (!review || typeof review !== 'object') return false
  const row = /** @type {{author?: unknown, commitId?: unknown, state?: unknown}} */ (review)
  return (
    loginMatchesTrusted(row.author, trustedLogin) &&
    isHeadSha(row.commitId) &&
    CODEX_REVIEW_STATES.has(String(row.state || '').toUpperCase())
  )
}

/**
 * @param {{head: string, trustedLogin: string, comments: unknown, reviews: unknown}} input
 * @returns {{reviewed: boolean, stale: boolean, reviews: object[]}}
 */
function collectCodexEvidence({ head, trustedLogin, comments, reviews }) {
  const headSha = head.toLowerCase()
  const states = []
  for (const source of Array.isArray(comments) ? comments : []) {
    if (!source || !loginMatchesTrusted(source.author, trustedLogin)) continue
    states.push(...parseCodexReviewStates(source.body))
  }
  const trustedReviews = (Array.isArray(reviews) ? reviews : []).filter((review) => isCodexReview(review, trustedLogin))
  const stateForHead = states.some((state) => state.commitSha === headSha)
  const reviewForHead = trustedReviews.some((review) => String(review.commitId).toLowerCase() === headSha)
  const reviewed = stateForHead || reviewForHead
  return {
    reviewed,
    stale: !reviewed && (states.length > 0 || trustedReviews.length > 0),
    reviews: trustedReviews,
  }
}

/**
 * @param {unknown} thread
 * @param {string} headSha
 * @param {string} trustedLogin
 * @returns {boolean}
 */
function threadBlocks(thread, headSha, trustedLogin) {
  if (!thread || typeof thread !== 'object' || thread.resolved === true) return false
  const comments = Array.isArray(thread.comments) ? thread.comments : []
  return comments.some(
    (comment) =>
      comment &&
      loginMatchesTrusted(comment.author, trustedLogin) &&
      isHeadSha(comment.commitId) &&
      String(comment.commitId).toLowerCase() === headSha &&
      isMergeBlockingSeverity(comment.body),
  )
}

/**
 * @param {object[]} reviews
 * @param {string} headSha
 * @returns {number}
 */
function reviewBodiesBlocking(reviews, headSha) {
  return reviews.filter(
    (review) => String(review.commitId).toLowerCase() === headSha && isMergeBlockingSeverity(review.body),
  ).length
}

/**
 * Has the trusted Codex login reviewed this exact head, with no unresolved
 * P0/P1 left on it?
 *
 * `clear: true` is the only value `decideMerge` will arm auto-merge on.
 * Anything else — missing review, a review of an older head, an untrusted
 * author, unreadable threads, unresolved P0/P1 — stays closed.
 *
 * @param {{head?: unknown, trustedLogin?: unknown, prAuthor?: unknown, comments?: unknown, reviews?: unknown, threads?: unknown, threadsReadable?: unknown}} input
 * @returns {{clear: boolean, reviewed: boolean, blocking: number, reason: string}}
 */
export function evaluateCodexHeadReview({
  head,
  trustedLogin,
  prAuthor,
  comments,
  reviews,
  threads,
  threadsReadable,
} = {}) {
  if (!codexLoginUsable(trustedLogin, prAuthor)) {
    return { clear: false, reviewed: false, blocking: 0, reason: 'Codex 的可信登录名还没配好，或这个登录名不能当审查人' }
  }
  if (!isHeadSha(head)) {
    return { clear: false, reviewed: false, blocking: 0, reason: '当前提交号读不到，不能把审查算在这次提交上' }
  }
  const evidence = collectCodexEvidence({
    head: String(head),
    trustedLogin: String(trustedLogin),
    comments,
    reviews,
  })
  if (!evidence.reviewed) {
    const reason = evidence.stale ? 'Codex 审的是更早的提交，当前这次还没审' : 'Codex 还没审过当前这次提交'
    return { clear: false, reviewed: false, blocking: 0, reason }
  }
  if (threadsReadable !== true) {
    return { clear: false, reviewed: true, blocking: 0, reason: '没能读全 Codex 的行内意见' }
  }
  const headSha = String(head).toLowerCase()
  const threadHits = (Array.isArray(threads) ? threads : []).filter((thread) =>
    threadBlocks(thread, headSha, String(trustedLogin)),
  ).length
  const blocking = threadHits + reviewBodiesBlocking(evidence.reviews, headSha)
  if (blocking > 0) {
    return { clear: false, reviewed: true, blocking, reason: `还有 ${blocking} 条没解决的 P0/P1` }
  }
  return { clear: true, reviewed: true, blocking: 0, reason: 'Codex 已审过当前这次提交，没有未解决的 P0/P1' }
}

// --- Claude Code sign-off on the current head (A auto-merge) ----------------
//
// Counts only against the current head sha. A later push drops it, the same
// way a Codex review of an older head drops. The base sha is not required:
// Claude's review is of this commit, and the live head compare plus
// `--match-head-commit` is what stops a stale enable.
//
// A sign-off is one of:
//   - a trusted `me-review-signoff` v1 marker, role `claude-code`, verdict
//     `pass`, whose `head` is this sha;
//   - a GitHub review by the trusted login, commit oid = this sha, state
//     APPROVED;
//   - a review or issue comment by that login whose body contains this full
//     sha and an explicit sign-off phrase.
// "no P0/P1" in that sign-off text is not itself a finding. An unresolved
// P0/P1 thread from that login on this head still blocks.

const CLAUDE_SIGNOFF_PHRASE = /\b(sign[\s-]?off|signed off|lgtm)\b|签字通过/i

/**
 * @param {unknown} body
 * @param {string} headSha
 * @returns {boolean}
 */
function bodySignsHead(body, headSha) {
  return typeof body === 'string' && CLAUDE_SIGNOFF_PHRASE.test(body) && body.toLowerCase().includes(headSha)
}

/**
 * @param {unknown} body
 * @param {string} headSha
 * @returns {boolean}
 */
function bodySignsOlderHead(body, headSha) {
  if (typeof body !== 'string' || !CLAUDE_SIGNOFF_PHRASE.test(body)) return false
  const shas = body.toLowerCase().match(/[0-9a-f]{40}/g) ?? []
  return shas.some((sha) => sha !== headSha)
}

/**
 * @param {unknown} review
 * @param {string} headSha
 * @param {string} login
 * @param {boolean} current
 * @returns {boolean}
 */
function claudeReviewSigns(review, headSha, login, current) {
  if (!review || typeof review !== 'object') return false
  const row = /** @type {{author?: unknown, commitId?: unknown, state?: unknown, body?: unknown}} */ (review)
  if (!loginMatchesTrusted(row.author, login) || !isHeadSha(row.commitId)) return false
  const same = String(row.commitId).toLowerCase() === headSha
  if (current !== same) return false
  if (String(row.state || '').toUpperCase() === 'CHANGES_REQUESTED') return false
  if (String(row.state || '').toUpperCase() === 'APPROVED') return true
  return current ? bodySignsHead(row.body, headSha) : bodySignsOlderHead(row.body, headSha)
}

/**
 * @param {unknown} markers
 * @param {string} headSha
 * @param {string} login
 * @param {boolean} current
 * @returns {boolean}
 */
function claudeMarkerSigns(markers, headSha, login, current) {
  return (Array.isArray(markers) ? markers : []).some((marker) => {
    if (!marker || typeof marker !== 'object') return false
    const row = /** @type {{role?: unknown, verdict?: unknown, author?: unknown, head?: unknown}} */ (marker)
    if (row.role !== 'claude-code' || row.verdict !== 'pass') return false
    if (!loginMatchesTrusted(row.author, login) || !isHeadSha(row.head)) return false
    return current === (String(row.head).toLowerCase() === headSha)
  })
}

/**
 * @param {{headSha: string, login: string, comments: unknown, reviews: unknown, markers: unknown}} input
 * @returns {{signed: boolean, older: boolean}}
 */
function collectClaudeEvidence({ headSha, login, comments, reviews, markers }) {
  const reviewList = Array.isArray(reviews) ? reviews : []
  const commentList = Array.isArray(comments) ? comments : []
  const signed =
    claudeMarkerSigns(markers, headSha, login, true) ||
    reviewList.some((review) => claudeReviewSigns(review, headSha, login, true)) ||
    commentList.some(
      (comment) => comment && loginMatchesTrusted(comment.author, login) && bodySignsHead(comment.body, headSha),
    )
  const older =
    claudeMarkerSigns(markers, headSha, login, false) ||
    reviewList.some((review) => claudeReviewSigns(review, headSha, login, false)) ||
    commentList.some(
      (comment) => comment && loginMatchesTrusted(comment.author, login) && bodySignsOlderHead(comment.body, headSha),
    )
  return { signed, older }
}

/**
 * Has Claude Code signed off on this exact head, with no unresolved P0/P1
 * from that login left on it?
 *
 * @param {{head?: unknown, trustedLogin?: unknown, prAuthor?: unknown, comments?: unknown, reviews?: unknown, markers?: unknown, threads?: unknown, threadsReadable?: unknown}} input
 * @returns {{clear: boolean, reviewed: boolean, blocking: number, reason: string}}
 */
export function evaluateClaudeHeadSignoff({
  head,
  trustedLogin,
  prAuthor,
  comments,
  reviews,
  markers,
  threads,
  threadsReadable,
} = {}) {
  if (!codexLoginUsable(trustedLogin, prAuthor)) {
    return { clear: false, reviewed: false, blocking: 0, reason: 'Claude Code 的可信登录名还没配好，或这个登录名不能当审查人' }
  }
  if (!isHeadSha(head)) {
    return { clear: false, reviewed: false, blocking: 0, reason: '当前提交号读不到，不能把签字算在这次提交上' }
  }
  const headSha = String(head).toLowerCase()
  const evidence = collectClaudeEvidence({
    headSha,
    login: String(trustedLogin),
    comments,
    reviews,
    markers,
  })
  if (!evidence.signed) {
    const reason = evidence.older
      ? 'Claude Code 签的是更早的提交，当前这次还没签'
      : 'Claude Code 还没签过当前这次提交'
    return { clear: false, reviewed: false, blocking: 0, reason }
  }
  if (threadsReadable !== true) {
    return { clear: false, reviewed: true, blocking: 0, reason: '没能读全 Claude Code 的行内意见' }
  }
  const blocking = (Array.isArray(threads) ? threads : []).filter((thread) =>
    threadBlocks(thread, headSha, String(trustedLogin)),
  ).length
  if (blocking > 0) {
    return { clear: false, reviewed: true, blocking, reason: `Claude Code 还有 ${blocking} 条没解决的 P0/P1` }
  }
  return { clear: true, reviewed: true, blocking: 0, reason: 'Claude Code 已签过当前这次提交，没有未解决的 P0/P1' }
}

/**
 * Every review conversation must be resolved before an A-level PR can arm
 * auto-merge. A P2 thread is not a P0/P1 finding, but an open thread still
 * blocks. Unreadable threads fail closed. This does not resolve anything.
 *
 * @param {{threads?: unknown, threadsReadable?: unknown}} input
 * @returns {{resolved: boolean, reason: string}}
 */
export function reviewConversationsResolved({ threads, threadsReadable } = {}) {
  if (threadsReadable !== true || !Array.isArray(threads)) {
    return { resolved: false, reason: '没能读全审查对话' }
  }
  const open = threads.filter((thread) => !thread || thread.resolved !== true).length
  if (open > 0) return { resolved: false, reason: `还有 ${open} 条没解决的审查对话` }
  return { resolved: true, reason: '审查对话都已解决' }
}
