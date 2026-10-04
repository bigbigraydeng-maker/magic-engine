/**
 * Deterministic detectors for the delivery-quality signals `quality.mjs`
 * accepts, plus the specialised-evidence claims an A-level PR owes.
 *
 * 🔴 Every detector here reads only facts obtainable from the GitHub API or
 * the PR body text — never a judgement about whether the work is actually
 * good. That is the whole point of `quality.mjs`'s signal-table design (see
 * its header comment): a signal is present or it is not, and nothing in this
 * module infers intent, quality, or completeness from prose it cannot verify.
 *
 * The body patterns are keyed to the section headings
 * `docs/ENGINEERING_QUALITY_GATES.md` already asks every PR to write (风险级别
 * / 判定理由 / 验收条件 / 明确不做 / Reuse Statement). A PR that does not write
 * in that shape scores 0 on the matching signal — that is the incentive, not
 * a bug: a claim not made in a checkable form is not evidence.
 *
 * Pure module: no I/O, no clock. `tests/evidence.test.ts` exercises it
 * offline.
 */

/**
 * Regexes for the signals derivable from PR body text alone. Kept narrow and
 * literal on purpose — a pattern loose enough to match unrelated prose would
 * let a PR "earn" a signal by accident, and Codex's PR #1205 findings on this
 * same tool were all about exactly that kind of accidental leniency.
 */
const BODY_SIGNAL_PATTERNS = {
  'linked-issue': /(?:closes|fixes|resolves)\s+#\d+|(?:^|[^\w#])#\d+\b/i,
  'acceptance-criteria': /验收条件|验收证据|acceptance criteria/i,
  'scope-statement': /明确不做|不做的范围|out of scope/i,
  'reuse-statement': /reuse statement|复用声明/i,
  'failure-handling': /失败处理|fail[- ]closed|失败关闭|失败会/i,
  observability: /观测|observability|会被(?:谁|看见)|谁.{0,6}发现/i,
}

// 🔴 Codex finding (PR #1211, P2): `build-evidence`/`test-output` used to
// match on the command name alone (`npm run build`, `npx vitest`, ...), so
// "npm run build 未运行", "npm run build 失败", and "测试命令：npx vitest（待执行）"
// scored the same 5 points each as a real pass — on a C-level PR (75-point
// threshold) that is 10 free points, enough on its own to turn a BLOCKED into
// a READY. These two signals now require an explicit, unambiguous completion
// word on the SAME LINE as the command mention, with a negation word on that
// line disqualifying it outright — "npm run build 成功，之前失败过" stays
// unscored rather than trusting whichever word a looser check happened to
// key off. A `N/N` ratio (e.g. "473/473") counts as unambiguous success too;
// a mismatched ratio ("467/473") does not match the backreference and is
// correctly treated as not-yet-proven.
const EVIDENCE_NEGATION_PATTERN =
  /未运行|未执行|不通过|未通过|失败|取消|待执行|待运行|skip(?:ped|s)?|not\s+run|didn.?t\s+run|no\s+run|pending|cancell?ed|fail(?:ed|s|ure)?/i
const EVIDENCE_SUCCESS_PATTERN = /通过|成功|全绿|绿灯|succeeded|success(?:ful)?|passed|green|(\d+)\s*\/\s*\1\b/i
const BUILD_COMMAND_PATTERN = /npm run build|\bbuild\b/i
const TEST_COMMAND_PATTERN = /npx vitest|vitest run|npm test|测试命令/i

function linesOf(body) {
  return typeof body === 'string' ? body.split(/\r?\n/) : []
}

/** True when some line names the command AND unambiguously claims success on that same line. */
function hasUnambiguousCompletion(prBody, commandPattern) {
  return linesOf(prBody).some(
    (line) => commandPattern.test(line) && EVIDENCE_SUCCESS_PATTERN.test(line) && !EVIDENCE_NEGATION_PATTERN.test(line),
  )
}

/**
 * Which body-derived signal ids a PR body positively contains.
 *
 * @param {string|null|undefined} prBody
 * @returns {string[]}
 */
export function bodySignals(prBody) {
  if (typeof prBody !== 'string') return []
  const ids = Object.entries(BODY_SIGNAL_PATTERNS)
    .filter(([, pattern]) => pattern.test(prBody))
    .map(([id]) => id)
  if (hasUnambiguousCompletion(prBody, BUILD_COMMAND_PATTERN)) ids.push('build-evidence')
  if (hasUnambiguousCompletion(prBody, TEST_COMMAND_PATTERN)) ids.push('test-output')
  return ids
}

/** Matches the same test-file shape `risk.mjs`'s C-safe rules recognise. */
const TEST_FILE_RULES = [/\.test\.tsx?$/, /\.spec\.tsx?$/, /\/__tests__\//]

/** @param {string} path */
export function isTestFile(path) {
  return typeof path === 'string' && TEST_FILE_RULES.some((rule) => rule.test(path))
}

/**
 * True when the diff touches at least one non-test file and at least one
 * test file — "changed code has tests", not "the diff contains a test file"
 * (a test-only diff has nothing to pair a test against, and a code-only diff
 * has no test at all; neither is the signal this claims to be).
 *
 * @param {Array<{filename?: unknown}>|null|undefined} files
 * @returns {boolean}
 */
export function changedCodeHasTests(files) {
  if (!Array.isArray(files)) return false
  const paths = files.map((f) => f?.filename).filter((p) => typeof p === 'string')
  return paths.some(isTestFile) && paths.some((p) => !isTestFile(p))
}

/**
 * Whether the diff touches a dependency manifest without the body explaining
 * why. Absence of the file in the diff is the common case, and is treated as
 * "nothing to explain" per the signal's own name (`no-unexplained-dependency`).
 *
 * @param {Array<{filename?: unknown}>|null|undefined} files
 * @param {string|null|undefined} prBody
 * @returns {boolean}
 */
export function noUnexplainedDependency(files, prBody) {
  const touchesManifest = Array.isArray(files)
    ? files.some((f) => f?.filename === 'package.json' || f?.filename === 'package-lock.json')
    : false
  if (!touchesManifest) return true
  return /新增依赖|new dependency|依赖.{0,10}(?:理由|原因)|dependency.{0,20}(?:justif|reason|because)/i.test(
    prBody ?? '',
  )
}

/**
 * Assemble the full observed-signal list `quality.mjs`'s `scoreDelivery`
 * accepts, from facts a caller has already fetched.
 *
 * @param {{
 *   prBody?: string|null,
 *   files?: Array<{filename?: unknown}>|null,
 *   requiredCiPassed?: boolean,
 *   scopeGuardPassed?: boolean,
 *   riskRated?: boolean,
 *   specializedEvidenceComplete?: boolean,
 * }} [input]
 * @returns {string[]}
 */
export function collectObservedSignals({
  prBody,
  files,
  requiredCiPassed = false,
  scopeGuardPassed = false,
  riskRated = false,
  specializedEvidenceComplete = false,
} = {}) {
  const signals = new Set(bodySignals(prBody))
  if (requiredCiPassed) signals.add('required-ci-green')
  if (changedCodeHasTests(files)) signals.add('changed-code-has-tests')
  if (riskRated) signals.add('risk-rated')
  if (scopeGuardPassed) signals.add('scope-guard-green')
  if (specializedEvidenceComplete) signals.add('specialized-evidence-complete')
  if (noUnexplainedDependency(files, prBody)) signals.add('no-unexplained-dependency')
  return [...signals]
}

/**
 * Which specialised-evidence ids a PR body positively *claims* as addressed,
 * out of the ids `categories` could owe (see `quality.mjs`'s
 * `SPECIALIZED_EVIDENCE` table).
 *
 * A claim only counts on a *checked* list item — `- [x] ... (the-evidence-id)`
 * — never the id merely appearing somewhere in prose. `quality.mjs`'s own
 * header is explicit about why this asymmetry matters: an unchecked box or a
 * passing mention is not a positive assertion of completeness, and this
 * module must not manufacture one.
 *
 * @param {string|null|undefined} prBody
 * @param {Iterable<{id: string}>} requiredEvidence output of
 *   `quality.mjs`'s `requiredSpecializedEvidence`
 * @returns {string[]}
 */
export function observedSpecializedEvidence(prBody, requiredEvidence) {
  if (typeof prBody !== 'string') return []
  const observed = []
  for (const item of requiredEvidence) {
    const id = item?.id
    if (typeof id !== 'string' || id === '') continue
    const pattern = new RegExp(`^[ \\t]*-[ \\t]*\\[x\\][^\\n]*\\(${id}\\)`, 'im')
    if (pattern.test(prBody)) observed.push(id)
  }
  return observed
}
