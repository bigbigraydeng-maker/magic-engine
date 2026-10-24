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
 * function of three values, so `tests/merge-decision.test.ts` can enumerate the
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
 * 🔴 **Why A never auto-merges, even fully signed.**
 *
 * A signed A PR returns `pass: true` with `decision: 'disable'`. The two are
 * deliberately separate: `pass` means "this PR is not blocked by the merge
 * gate", `decision` means "what should be done to the auto-merge flag". An A PR
 * that has both sign-offs is *ready*, and a human still presses the button
 * — because the sign-off is a verdict about a diff, and the diff can move
 * between the sign-off and the merge. `evaluateSignoffs` binds the sign-off to
 * `base..head`; keeping the merge itself manual is what makes that binding
 * worth anything.
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
 * Is this sign-off object a *claim of completeness* we are willing to act on?
 *
 * 🔴 `complete: true` alone is not enough. The claim is only meaningful if the
 * object also carries a `missing` array that agrees with it — an object saying
 * `complete: true, missing: ['claude-code']` is self-contradictory, and one saying
 * `complete: true, missing: 'not-an-array'` is malformed. Both are treated as
 * "not complete", because a malformed claim of completeness is not a claim.
 * The alternative — trusting the boolean and ignoring the list — would make the
 * boolean the only thing an attacker needs to set.
 *
 * @param {unknown} signoff
 * @returns {boolean}
 */
function isCompleteSignoff(signoff) {
  if (!signoff || typeof signoff !== 'object') return false
  const candidate = /** @type {{complete?: unknown, missing?: unknown, present?: unknown}} */ (signoff)
  if (candidate.complete !== true) return false
  if (!Array.isArray(candidate.missing) || candidate.missing.length !== 0) return false
  if (!Array.isArray(candidate.present)) return false
  return REQUIRED_SIGNOFF_ROLES.every((role) => candidate.present.includes(role))
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
 *   2. B and C are auto-merged once the machine checks are green. Spot checks
 *      by ziya / weizheng / direnjie are not an input: a missing spot check
 *      cannot stop this branch from returning `enable`.
 *   3. A is merged by a human, and only once both sign-offs are present
 *      (Codex Astra and Claude Code). The old three roles do not count.
 *   4. Anything else is treated as A, and says so in the reason.
 *
 * 🔴 **`fork` uses the same fail-closed convention as `draft`.** Only an
 * explicit `false` clears the fork check; `undefined`, `null` or `true` all
 * block. Three-fold defence in depth: the caller reads
 * `github.event.pull_request.head.repo.full_name != github.repository`, the
 * signature here destructures `fork` (a rename that drops it fails
 * `merge-decision.test.ts`'s property enumeration, not silently succeeds), and
 * this rule fires before any risk-based rule can return `enable`.
 *
 * @param {{risk?: unknown, draft?: unknown, fork?: unknown, signoff?: unknown}} input
 * @returns {{pass: boolean, decision: 'enable'|'disable', tier: 'auto'|'signed'|'blocked', reason: string}}
 */
export function decideMerge({ risk, draft, fork, signoff } = {}) {
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

  // Rule 2. B and C are the levels the risk module rates as "machine checks are
  // enough". They are the only levels that may reach `enable`.
  if (risk === 'B' || risk === 'C') {
    return {
      pass: true,
      decision: MERGE_DECISION.ENABLE_AUTO_MERGE,
      tier: TIER.AUTO,
      reason: `${risk} 级：机器检查全绿后自动合并`,
    }
  }

  // Rule 3. A is signed, never auto-merged. `pass: true` here means "not
  // blocked by this gate", not "merge it for me" — see the module comment.
  if (risk === 'A') {
    if (isCompleteSignoff(signoff)) {
      return {
        pass: true,
        decision: MERGE_DECISION.DISABLE_AUTO_MERGE,
        tier: TIER.SIGNED,
        reason: 'A 级：Codex Astra 与 Claude Code 两方签字齐，可由人合并（A 级永不自动合）',
      }
    }
    return {
      pass: false,
      decision: MERGE_DECISION.DISABLE_AUTO_MERGE,
      tier: TIER.BLOCKED,
      reason: `A 级：缺签字 ${missingRolesFor(signoff).join('/')} （两方须各用自己的身份签字；自动写入尚未建成，由 PM 决定是否绕过）`,
    }
  }

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
