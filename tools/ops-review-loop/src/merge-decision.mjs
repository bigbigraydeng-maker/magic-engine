/**
 * The merge gate: the single place that decides whether a PR may be merged
 * unattended, and the only module in this control plane that can *ask* for
 * auto-merge to be turned on.
 *
 * 🔴 **Why the decision is a pure function and not a workflow step.**
 *
 * The rules that decide "may this land without a human" are the rules an agent
 * under time pressure has the most incentive to bend. If they live as `if`
 * statements inside a YAML job, they can only be tested by running the job, and
 * the only way to check a change to them is to watch a real PR. Here they are a
 * function of those values, so `tests/merge-decision.test.ts` can enumerate the
 * whole input space offline — including the combinations nobody thought to try.
 *
 * 🔴 **Why `enable` is unreachable from any failing branch.**
 *
 * Turning on auto-merge is the only side effect this module can request, and it
 * is the one that removes a human from the loop. So it is not enough for the
 * happy paths to return `enable`; it must be *impossible* for a failing path to
 * do so. Every branch below either returns `disable`, or returns `enable` with
 * `pass: true` and `tier: 'auto'` — and the test asserts that implication over
 * every combination of inputs, not just the ones written by hand. A future edit
 * that adds a fourth way to reach `enable` fails that property test.
 *
 * 🔴 **When A may auto-merge.**
 *
 * An A PR enables auto-merge only when Codex has reviewed this head with no
 * unresolved P0/P1, Claude Code has signed this head with no P0/P1, the
 * required checks are already green, and the diff does not touch a path Ray
 * still merges by hand (schema/SQL, Meta tokens or secrets, ad spend).
 * Anything uncertain — a missing flag, a hold path, a stale review — stays
 * `disable`. P2 does not block. Resolving review threads stays a repository
 * rule; this function does not resolve them.
 *
 * 🔴 **Why an unrecognised risk is treated as A, not as B.**
 *
 * `risk.mjs` already fails closed on unreadable input, and this module must not
 * undo that. A rating this function does not understand is a rating whose
 * consequences are unknown, so it takes the strictest path — the same one A
 * takes — rather than the permissive one. The reason string says so explicitly,
 * so a reader of the summary can tell "this is A" from "we could not tell, so
 * we assumed A".
 *
 * This module is pure: no I/O, no network, no clock.
 */

import { RISK_GATE_CHECK_NAME } from './head-check.mjs'
import { REQUIRED_SIGNOFF_ROLES } from './signoff-marker.mjs'

/**
 * The two things a caller can be told to do to the auto-merge flag.
 *
 * There is no third value. "Leave it alone" is not a decision this gate makes:
 * a PR that is not enabled is disabled, so a stale `enable` from an earlier run
 * cannot survive a later failing evaluation.
 */
export const MERGE_DECISION = {
  ENABLE_AUTO_MERGE: 'enable',
  DISABLE_AUTO_MERGE: 'disable',
}

/**
 * The three tiers a decision can land in, for reporting.
 *
 * `auto` is the only tier that may carry `decision: 'enable'`. `signed` means
 * the PR cleared the gate but a human merges it. `blocked` means it did not
 * clear the gate.
 */
const TIER = {
  AUTO: 'auto',
  SIGNED: 'signed',
  BLOCKED: 'blocked',
}

/**
 * The roles reported as missing when the sign-off input is absent or malformed.
 *
 * A fresh copy each call, so a caller mutating the returned array cannot change
 * what the next call reports.
 *
 * @returns {string[]}
 */
function allRolesMissing() {
  return [...REQUIRED_SIGNOFF_ROLES]
}

/**
 * The roles to name in a "missing sign-off" reason.
 *
 * Falls back to every required role when the sign-off input is absent or does
 * not carry a usable `missing` list, so the reason never reads "缺签字 " with
 * nothing after it — an empty list of missing roles is indistinguishable from a
 * rendering bug, and a reader cannot act on it.
 *
 * @param {unknown} signoff
 * @returns {string[]}
 */
function missingRolesFor(signoff) {
  if (signoff && typeof signoff === 'object') {
    const candidate = /** @type {{missing?: unknown}} */ (signoff)
    if (Array.isArray(candidate.missing) && candidate.missing.length > 0) {
      return candidate.missing.map((role) => String(role))
    }
  }
  return allRolesMissing()
}

/**
 * Latest required checks, ignoring this gate's own check so it cannot wait
 * on itself. Only an explicit completed success counts. An empty or unreadable
 * required list stays closed.
 *
 * @param {{required?: unknown, checks?: unknown}} input
 * @returns {boolean}
 */
export function requiredChecksAreGreen({ required, checks } = {}) {
  if (!Array.isArray(required) || required.length === 0) return false
  const names = required.filter(
    (name) => typeof name === 'string' && name !== '' && name !== RISK_GATE_CHECK_NAME,
  )
  if (names.length === 0) return false
  const list = Array.isArray(checks) ? checks : []
  return names.every((name) =>
    list.some(
      (check) =>
        check &&
        check.name === name &&
        check.status === 'completed' &&
        check.conclusion === 'success',
    ),
  )
}

/**
 * A-level auto-merge. `rayHold` must be the explicit boolean false; a missing
 * value is treated as "we could not tell" and stays with Ray.
 *
 * @param {{codexReview?: {clear?: unknown}|null, claudeSignoff?: {clear?: unknown}|null, requiredChecksGreen?: unknown, rayHold?: unknown}} input
 * @returns {{pass: boolean, decision: 'enable'|'disable', tier: 'auto'|'signed'|'blocked', reason: string, needsRayMerge?: boolean}}
 */
function decideAMerge({ codexReview, claudeSignoff, requiredChecksGreen, rayHold }) {
  if (rayHold !== false) {
    const known = rayHold === true
    return {
      pass: false,
      decision: MERGE_DECISION.DISABLE_AUTO_MERGE,
      tier: TIER.BLOCKED,
      needsRayMerge: true,
      reason: known
        ? 'A 级：碰到库表、Meta 凭证或广告花费，留给 Ray 亲手合'
        : 'A 级：没能判断有没有碰到库表、Meta 凭证或广告花费，留给 Ray 亲手合',
    }
  }
  const ready =
    codexReview?.clear === true && claudeSignoff?.clear === true && requiredChecksGreen === true
  if (ready) {
    return {
      pass: true,
      decision: MERGE_DECISION.ENABLE_AUTO_MERGE,
      tier: TIER.AUTO,
      needsRayMerge: false,
      reason: 'A 级：Codex 与 Claude Code 都审过当前这次提交，没有未解决的 P0/P1，必过检查已全绿，自动合并',
    }
  }
  return {
    pass: false,
    decision: MERGE_DECISION.DISABLE_AUTO_MERGE,
    tier: TIER.BLOCKED,
    needsRayMerge: false,
    reason: 'A 级：要 Codex 审过当前提交、Claude Code 签过当前提交、必过检查全绿，才自动合并',
  }
}

/**
 * B/C auto-merge. Only an explicit `clear: true` arms it. The workflow's
 * disable step runs whenever the decision is not `enable`, so a new push
 * whose Codex review is missing or stale turns auto-merge off.
 *
 * @param {string} risk
 * @param {{clear?: unknown, reason?: unknown}|null|undefined} codexReview
 * @returns {{pass: boolean, decision: 'enable'|'disable', tier: 'auto'|'signed'|'blocked', reason: string}}
 */
function decideBcMerge(risk, codexReview) {
  if (codexReview && codexReview.clear === true) {
    return {
      pass: true,
      decision: MERGE_DECISION.ENABLE_AUTO_MERGE,
      tier: TIER.AUTO,
      reason: `${risk} 级：Codex 已审过当前这次提交且没有未解决的 P0/P1，机器检查全绿后自动合并`,
    }
  }
  const detail =
    codexReview && typeof codexReview.reason === 'string' && codexReview.reason !== ''
      ? codexReview.reason
      : 'Codex 还没审过当前这次提交'
  return {
    pass: false,
    decision: MERGE_DECISION.DISABLE_AUTO_MERGE,
    tier: TIER.BLOCKED,
    reason: `${risk} 级：${detail}，不开启自动合并`,
  }
}

/**
 * Decide what should happen to a PR's auto-merge flag.
 *
 * Rules are applied in order, and the first one that matches wins:
 *
 *   1. A draft is never merged, whatever its risk or sign-off state.
 *   1b. A fork PR is never auto-merged, whatever its risk. `pull_request_target`
 *       hands this workflow a write token; if a fork PR that rates B or C could
 *       reach `enable`, an outside author who fork-and-changes README could
 *       auto-merge into main. Documented in `.github/merge-authorization.md`
 *       and asserted by the caller `check-risk-gate.mjs` — the guard must live
 *       here or a caller that forgets to pass `fork` slips it past.
 *   2. A diff that touches schema, SQL, Meta tokens or secrets, or ad spend
 *      is never auto-merged. `rayHold: true` is that fact. A missing `rayHold`
 *      does not block B/C; for A it fails closed inside rule 3.
 *   3. B and C arm auto-merge only when `codexReview.clear === true`.
 *   4. A arms auto-merge only when Codex has cleared this head, Claude Code
 *      has signed this head, required checks are green, and `rayHold` is false.
 *   5. Anything else is treated as A, and says so in the reason.
 *
 * 🔴 **`fork` uses the same fail-closed convention as `draft`.** Only an
 * explicit `false` clears the fork check; `undefined`, `null` or `true` all
 * block. Three-fold defence in depth: the caller reads
 * `github.event.pull_request.head.repo.full_name != github.repository`, the
 * signature here destructures `fork` (a rename that drops it fails
 * `merge-decision.test.ts`'s property enumeration, not silently succeeds), and
 * this rule fires before any risk-based rule can return `enable`.
 *
 * @param {{risk?: unknown, draft?: unknown, fork?: unknown, signoff?: unknown, codexReview?: {clear?: unknown, reason?: unknown}|null, claudeSignoff?: {clear?: unknown}|null, requiredChecksGreen?: unknown, rayHold?: unknown}} input
 * @returns {{pass: boolean, decision: 'enable'|'disable', tier: 'auto'|'signed'|'blocked', reason: string, needsRayMerge?: boolean}}
 */
export function decideMerge({
  risk,
  draft,
  fork,
  signoff,
  codexReview,
  claudeSignoff,
  requiredChecksGreen,
  rayHold,
} = {}) {
  // Rule 1. `draft !== false` rather than `draft === true`: a missing or
  // non-boolean `draft` is not evidence that the PR is ready, so it fails
  // closed. Only an explicit `false` opens the gate.
  if (draft !== false) {
    return {
      pass: false,
      decision: MERGE_DECISION.DISABLE_AUTO_MERGE,
      tier: TIER.BLOCKED,
      reason: '草稿 PR 不做合并判定',
    }
  }

  // Rule 1b. Same fail-closed convention as draft. A fork PR that rates B or C
  // would otherwise auto-merge on the fork author's word alone; the write token
  // this workflow holds turns that into a real merge.
  if (fork !== false) {
    return {
      pass: false,
      decision: MERGE_DECISION.DISABLE_AUTO_MERGE,
      tier: TIER.BLOCKED,
      reason: 'fork PR 不自动合并（外部作者的改动一律需要人合）',
    }
  }

  // Rule 2. Schema, tokens, secrets, and ad spend stay with Ray at every level.
  if (rayHold === true) {
    return {
      pass: false,
      decision: MERGE_DECISION.DISABLE_AUTO_MERGE,
      tier: TIER.BLOCKED,
      needsRayMerge: true,
      reason: '碰到库表、Meta 凭证或广告花费，留给 Ray 亲手合',
    }
  }

  // Rule 3. B and C arm only after Codex has reviewed this head.
  if (risk === 'B' || risk === 'C') return decideBcMerge(risk, codexReview)

  // Rule 4. A arms only with both reviews, green required checks, and an
  // explicit `rayHold: false`. A missing hold fails closed.
  if (risk === 'A') return decideAMerge({ codexReview, claudeSignoff, requiredChecksGreen, rayHold })

  // Rule 4. An unrecognised level is not a level we can reason about, so it
  // takes A's strict path. The prefix keeps the two cases distinguishable in
  // the summary: "this is A" and "we assumed A" call for different follow-ups.
  return {
    pass: false,
    decision: MERGE_DECISION.DISABLE_AUTO_MERGE,
    tier: TIER.BLOCKED,
    reason: `级别不可识别（${String(risk)}），按 A 处理：缺签字 ${missingRolesFor(signoff).join('/')} （两方须各用自己的身份签字；自动写入尚未建成，由 PM 决定是否绕过）`,
  }
}

/**
 * Render the decision as a GitHub step summary, in the language the Product
 * Owner reads.
 *
 * The summary is a *report*, not an input: nothing downstream parses it, so it
 * is free to be prose. It repeats the reason verbatim rather than paraphrasing
 * it, because the reason is the part a human acts on and a summary that says
 * something slightly different from the decision is worse than no summary.
 *
 * @param {{risk?: unknown, reasons?: unknown, decision?: {decision?: unknown, reason?: unknown}|null, ignoredMarkers?: unknown}} input
 * @returns {string}
 */
export function summariseDecision({ risk, reasons, decision, ignoredMarkers } = {}) {
  const reason = decision && typeof decision === 'object' ? decision.reason : undefined
  const lines = [`## 合并闸：${String(risk)} 级 — ${String(reason)}`, '']

  lines.push('- 定级依据：')
  if (Array.isArray(reasons)) {
    for (const item of reasons) lines.push(`  - ${String(item)}`)
  } else {
    lines.push('  - （无）')
  }

  const enabled = decision && typeof decision === 'object' && decision.decision === MERGE_DECISION.ENABLE_AUTO_MERGE
  lines.push(enabled ? '- 自动合并：已开启' : '- 自动合并：已关闭')

  // Only rendered when there is something to report. A permanent "忽略了 0 条"
  // line trains readers to skip the line, which is exactly the line that must
  // not be skipped when the count is not zero.
  if (typeof ignoredMarkers === 'number' && Number.isInteger(ignoredMarkers) && ignoredMarkers > 0) {
    lines.push(`- 忽略了 ${ignoredMarkers} 条非可信身份写的标记`)
  }

  return lines.join('\n')
}
