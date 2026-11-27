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
 * 🔴 **Why A auto-merges only for this exact head, and some paths never do.**
 *
 * An A PR arms auto-merge when every required check other than this gate is
 * already green and every review conversation is resolved. Claude Code and
 * Codex reviews still run; neither blocks the merge (Ray 2026-11-16). A `p0`
 * label is a suggestion to look, not a hold. Paths that touch a database
 * schema or migration, a Meta token or credential, or code that creates or
 * changes a Meta campaign, budget, or bid never arm auto-merge:
 * `rayHold: true` disables every level. A missing `rayHold` fails closed
 * for A only.
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
 * B/C auto-merge.
 *
 * Codex 不再是输入（2026-10-26：那一签的审查已停，等它会把每条 PR 卡住）。
 * `p0` 标签和 Claude 签字也不再挡（Ray 2026-11-16）。打开自动合并之后，由
 * GitHub 等必过检查。草稿、fork、`rayHold` 在调用方先拦。
 *
 * @param {string} risk
 * @returns {{pass: boolean, decision: 'enable'|'disable', tier: 'auto'|'signed'|'blocked', reason: string}}
 */
function decideBcMerge(risk) {
  return {
    pass: true,
    decision: MERGE_DECISION.ENABLE_AUTO_MERGE,
    tier: TIER.AUTO,
    reason: `${risk} 级：机器检查全绿后自动合并（签字和 p0 标签都不挡）`,
  }
}

/**
 * A-level auto-merge. Checks and conversations must be the boolean `true`.
 * A stringly `"true"` does not arm it. Sign-off is not an input (Ray
 * 2026-11-16). `rayHold` must already have been rejected by the caller when
 * it is `true`; anything other than an explicit `false` still fails closed.
 *
 * @param {{requiredChecksGreen?: unknown, conversationsResolved?: unknown, rayHold?: unknown}} input
 * @returns {{pass: boolean, decision: 'enable'|'disable', tier: 'auto'|'signed'|'blocked', reason: string, needsRayMerge: boolean}}
 */
function decideAMerge({ requiredChecksGreen, conversationsResolved, rayHold }) {
  if (rayHold !== false) {
    return {
      pass: false,
      decision: MERGE_DECISION.DISABLE_AUTO_MERGE,
      tier: TIER.BLOCKED,
      needsRayMerge: false,
      reason: 'A 级：没能确认这批改动是否碰到库表、Meta 凭证或广告花费，不开启自动合并',
    }
  }
  if (requiredChecksGreen === true && conversationsResolved === true) {
    return {
      pass: true,
      decision: MERGE_DECISION.ENABLE_AUTO_MERGE,
      tier: TIER.AUTO,
      needsRayMerge: false,
      reason: 'A 级：必过检查已全绿，审查对话都已解决，自动合并（签字不挡）',
    }
  }
  const parts = []
  if (requiredChecksGreen !== true) parts.push('必过检查还没全绿')
  if (conversationsResolved !== true) parts.push('还有没解决的审查对话')
  return {
    pass: false,
    decision: MERGE_DECISION.DISABLE_AUTO_MERGE,
    tier: TIER.BLOCKED,
    needsRayMerge: false,
    reason: `A 级：${parts.join('；')}，不开启自动合并`,
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
 *   1c. `rayHold: true` never auto-merges, at any level. That flag is the
 *       schema / Meta credential / Meta ad-spend exception.
 *   2. B 和 C 直接开自动合并。Codex 不是输入（2026-10-26）。`p0` 标签和 Claude
 *      签字也不挡（Ray 2026-11-16）。把关交给 GitHub 的必过检查。子牙 / 魏征 /
 *      狄仁杰的抽查不是输入。
 *   3. A 级要必过检查全绿、审查对话全解决。不要求 Claude 或 Codex 签字
 *      （Ray 2026-11-16）。库表 / Meta 凭证 / 广告花费已在 1c 拦住。
 *   4. Anything else is not auto-merged, and says so in the reason.
 *
 * 🔴 **`fork` uses the same fail-closed convention as `draft`.** Only an
 * explicit `false` clears the fork check; `undefined`, `null` or `true` all
 * block. Three-fold defence in depth: the caller reads
 * `github.event.pull_request.head.repo.full_name != github.repository`, the
 * signature here destructures `fork` (a rename that drops it fails
 * `merge-decision.test.ts`'s property enumeration, not silently succeeds), and
 * this rule fires before any risk-based rule can return `enable`.
 *
 * @param {{risk?: unknown, draft?: unknown, fork?: unknown, p0?: unknown, signoff?: unknown, codexReview?: {clear?: unknown, reason?: unknown}|null, claudeSignoff?: {clear?: unknown, reason?: unknown}|null, requiredChecksGreen?: unknown, conversationsResolved?: unknown, rayHold?: unknown}} input
 * @returns {{pass: boolean, decision: 'enable'|'disable', tier: 'auto'|'signed'|'blocked', reason: string, needsRayMerge?: boolean}}
 */
export function decideMerge({
  risk,
  draft,
  fork,
  p0: _p0,
  signoff: _signoff,
  codexReview: _codexReview,
  claudeSignoff: _claudeSignoff,
  requiredChecksGreen,
  conversationsResolved,
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

  // Rule 1c. An explicit hold disables every level, including a B/C PR whose
  // files were mis-rated. Only the boolean `true` does this.
  if (rayHold === true) {
    return {
      pass: false,
      decision: MERGE_DECISION.DISABLE_AUTO_MERGE,
      tier: TIER.BLOCKED,
      needsRayMerge: true,
      reason: '碰到库表、Meta 凭证或广告花费，留给 Ray 亲手合',
    }
  }

  // Rule 2. B and C arm auto-merge without a review. A missing rayHold does
  // not affect them. `p0` and sign-off are ignored on purpose.
  if (risk === 'B' || risk === 'C') return decideBcMerge(risk)

  // Rule 3. A reaches `enable` when the required checks and the review
  // conversations agree. See `decideAMerge`.
  if (risk === 'A') {
    return decideAMerge({ requiredChecksGreen, conversationsResolved, rayHold })
  }

  // Rule 4. An unrecognised level is not a level we can reason about.
  void _signoff
  void _codexReview
  void _claudeSignoff
  void _p0
  return {
    pass: false,
    decision: MERGE_DECISION.DISABLE_AUTO_MERGE,
    tier: TIER.BLOCKED,
    needsRayMerge: false,
    reason: `级别不可识别（${String(risk)}），不开启自动合并`,
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
