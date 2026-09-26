/**
 * Delivery quality score and the hard gates that outrank it.
 *
 * The risk level (see `risk.mjs`) decides *how much process* a PR goes through.
 * This module decides *whether the result is good enough to hand to the Product
 * Owner*. They are separate questions and are deliberately not blended: an
 * A-level change with excellent evidence still gets A's process, and a C-level
 * change with no evidence at all still fails.
 *
 * 🔴 **Why the score is a sum of named signals rather than a judgement.**
 *
 * A "score out of 100" produced by a model is a number with the shape of
 * evidence and none of the substance — and the model producing it is the same
 * one that wrote the code. So nothing here scores anything. `scoreDelivery`
 * accepts a list of *signal ids* that a caller has already observed
 * (a check run's conclusion, a section present in the PR body, a test file in
 * the diff), looks each one up in a fixed table, and adds up the points. A
 * signal that was not observed contributes 0; there is no partial credit and no
 * "looks about right" path. An id the table does not contain throws, rather
 * than being silently ignored — an invented signal must not be able to buy
 * points, and a renamed one must break loudly instead of quietly scoring zero.
 *
 * 🔴 **Why hard gates outrank the total.**
 *
 * Points are fungible; safety is not. A PR could reach 92 on documentation and
 * reuse while its required CI is red. `decideReadiness` therefore evaluates the
 * hard gates first and independently: red CI, an unresolved Codex P0/P1/P2 on
 * the current head, a rating bound to a stale sha, missing A-level evidence, or
 * *any* unreadable input blocks readiness at any score.
 *
 * 🔴 **What Codex does and does not contribute here.**
 *
 * The native Codex GitHub App posts prose ("### 💡 Codex Review", a
 * "**Reviewed commit:** `<sha>`" line, then findings) — verified against real
 * reviews on PR #1204 (2026-08-27, four reviews across four head shas). It does
 * not emit a machine-readable quality object, and this module does not pretend
 * otherwise: `CODEX_QUALITY_FIELDS` is exported as `unavailable` so a report can
 * say so out loud. Codex's contribution to this decision is exactly one fact —
 * how many P0/P1/P2 findings stand against the current head, via the existing
 * `severity.mjs` heuristic — and that fact is a hard gate, not a score.
 *
 * Pure module: no I/O, no clock. `tests/quality.test.ts` exercises it offline.
 */

import { RISK_CATEGORY } from './risk.mjs'
import {
  checkTrialRunElements,
  extractTrialRunSection,
  findCannotRunExit,
  parseLedgerVerifyBy,
  scheduledCodeInPatch,
  workflowHasSchedule,
} from './trial-run.mjs'

/**
 * Codex quality reporting status. Reported verbatim so a summary never implies
 * a structured Codex verdict exists. See the module header for the evidence.
 */
export const CODEX_QUALITY_FIELDS = 'unavailable'

/**
 * What "the corresponding specialised evidence" means, per risk category.
 *
 * 🔴 Codex finding on PR #1205 (P1): this used to be one fixed requirement —
 * every A-level PR had to show client-isolation evidence. But a migration, a
 * workflow edit, a payment route and a dependency bump are all A and none of
 * them produce isolation evidence. Under the old rule they could never be
 * Ready, or their authors would write isolation prose they had not actually
 * verified — which is worse than no gate, because it manufactures false
 * evidence. This very PR is an A-level control-plane change and was one of the
 * ones permanently blocked.
 *
 * The rule the spec actually states is "按命中风险运行" — evidence matching the
 * risks *hit*. So: `classifyRisk` reports the categories, this table says what
 * each one owes, and `evaluateSpecializedEvidence` compares required against
 * observed. A category with no entry here owes nothing; a category the table
 * does not recognise owes an explicit manual sign-off rather than nothing.
 */
export const SPECIALIZED_EVIDENCE = {
  [RISK_CATEGORY.DB_MIGRATION]: {
    id: 'migration-evidence',
    label: '迁移的加列 / 收紧顺序、RLS 策略与回滚路径已写明',
  },
  [RISK_CATEGORY.CONTROL_PLANE]: {
    id: 'control-plane-evidence',
    label: '权限边界、fail-closed 行为、以及它不能给自己放权，已验证',
  },
  [RISK_CATEGORY.PRODUCTION_SCHEDULE]: {
    id: 'schedule-evidence',
    label: '调度条目与密钥挂载已核对，失败会被看见',
  },
  [RISK_CATEGORY.AUTH_ISOLATION]: {
    id: 'isolation-evidence',
    label: '鉴权 / 权限 / 客户隔离的「允许」与「拒绝」两条路径都验过',
  },
  [RISK_CATEGORY.KERNEL_EXECUTION]: {
    id: 'kernel-evidence',
    label: '授权、幂等、并发与状态机边界已验证',
  },
  [RISK_CATEGORY.MONEY]: {
    id: 'money-evidence',
    label: '计费 / 扣费 / 预算路径的金额与重复执行已验证',
  },
  [RISK_CATEGORY.OUTWARD_WRITE]: {
    id: 'outward-write-evidence',
    label: '对外副作用做了干跑或沙箱验证，且确认没有真发出去',
  },
  [RISK_CATEGORY.NETWORK_BOUNDARY]: {
    id: 'ssrf-evidence',
    label: '出网目标绑定与重定向路径已验证',
  },
  [RISK_CATEGORY.CREDENTIALS]: {
    id: 'credential-evidence',
    label: '凭证没进日志、没进仓库，作用域最小',
  },
  [RISK_CATEGORY.SUPPLY_CHAIN]: {
    id: 'dependency-evidence',
    label: '新增依赖的必要性、来源与锁文件变更已说明',
  },
  [RISK_CATEGORY.GOVERNANCE]: {
    id: 'governance-evidence',
    label: '规则改动已由人读过：改的是哪条规矩、谁拍板、旧规矩为什么作废，已写明',
  },
  [RISK_CATEGORY.UNREADABLE]: {
    id: 'manual-rating-evidence',
    label: '改动清单读不到，改动范围必须由人确认过',
  },
}

/** Owed by any category this table does not recognise. Fail closed. */
export const UNKNOWN_CATEGORY_EVIDENCE = 'manual-rating-evidence'

/**
 * Iterate a collection of ids, treating a bare string as *not* one.
 *
 * A string is iterable in JavaScript, character by character. So passing
 * `'isolation-evidence'` where a list was meant does not throw and does not
 * come back empty — it comes back as eighteen single-character ids, none of
 * which match anything. The evidence then reads as "observed, but none of it
 * counted", which is the most misleading of the three possible answers. Callers
 * that hand us a string are making a mistake, and it is treated as one.
 *
 * @param {unknown} value
 * @returns {Iterable<string>}
 */
function iterableOrEmpty(value) {
  if (value === null || value === undefined || typeof value === 'string') return []
  return typeof value[Symbol.iterator] === 'function' ? value : []
}

/**
 * The specialised evidence a set of risk categories owes.
 *
 * @param {Iterable<string>} categories
 * @returns {Array<{category: string, id: string, label: string}>}
 */
export function requiredSpecializedEvidence(categories) {
  const out = []
  const seen = new Set()
  for (const category of iterableOrEmpty(categories)) {
    const entry = SPECIALIZED_EVIDENCE[category] ?? {
      id: UNKNOWN_CATEGORY_EVIDENCE,
      label: `风险类别 \`${category}\` 不在证据表里 —— 需要人工确认`,
    }
    if (seen.has(entry.id)) continue
    seen.add(entry.id)
    out.push({ category, ...entry })
  }
  return out
}

/**
 * Compare required specialised evidence against what was observed.
 *
 * `observed` being unreadable (not iterable) is distinct from being empty, and
 * is reported as such — the same distinction `risk.mjs` insists on.
 *
 * @param {{categories?: Iterable<string>, observed?: Iterable<string>|null}} input
 * @returns {{required: Array<{category: string, id: string, label: string}>, missing: Array<{category: string, id: string, label: string}>, complete: boolean, readable: boolean}}
 */
export function evaluateSpecializedEvidence({ categories = [], observed } = {}) {
  const required = requiredSpecializedEvidence(categories)
  // A string is deliberately NOT readable here — see `iterableOrEmpty`. An
  // empty array is: "we looked and found nothing" is a real, reportable answer,
  // and a different one from "we could not look".
  const readable =
    observed !== null &&
    observed !== undefined &&
    typeof observed !== 'string' &&
    typeof observed[Symbol.iterator] === 'function'
  if (!readable) {
    return { required, missing: required, complete: false, readable: false }
  }
  const seen = new Set(observed)
  const missing = required.filter((item) => !seen.has(item.id))
  return { required, missing, complete: missing.length === 0, readable: true }
}

/**
 * The five scoring dimensions and their weights, straight from the Product
 * Owner's spec. Each dimension's signals must sum to exactly its `max`; a test
 * asserts that, so the table cannot drift into scoring out of 103.
 */
export const SCORE_DIMENSIONS = [
  {
    key: 'acceptance',
    max: 30,
    label: '需求与验收条件完成',
    signals: [
      { id: 'linked-issue', points: 10, label: 'PR 关联到 Issue / 需求卡' },
      { id: 'acceptance-criteria', points: 10, label: 'PR 正文写了验收条件' },
      { id: 'scope-statement', points: 10, label: 'PR 正文写了「明确不做」的范围声明' },
    ],
  },
  {
    key: 'tests',
    max: 25,
    label: '测试、构建和运行证据',
    signals: [
      { id: 'required-ci-green', points: 10, label: '必过 CI 检查 completed+success' },
      { id: 'build-evidence', points: 5, label: '有构建结果证据' },
      { id: 'test-output', points: 5, label: '有测试命令与结果证据' },
      { id: 'changed-code-has-tests', points: 5, label: 'diff 里非测试代码有配套测试改动' },
    ],
  },
  {
    key: 'security',
    max: 20,
    label: '安全、权限、客户隔离证据',
    signals: [
      { id: 'risk-rated', points: 5, label: '风险等级已绑定 base+head 落盘' },
      { id: 'scope-guard-green', points: 5, label: '爆炸半径闸门通过' },
      // Not "isolation evidence" — see SPECIALIZED_EVIDENCE. What this scores
      // is that every kind of evidence the PR's own risk categories owe was
      // actually produced, whatever those kinds turned out to be.
      { id: 'specialized-evidence-complete', points: 10, label: '命中风险对应的专项证据齐了' },
    ],
  },
  {
    key: 'reuse',
    max: 15,
    label: '复用现有架构、没有重复建设',
    signals: [
      { id: 'reuse-statement', points: 10, label: '有 Reuse Statement（CLAUDE.md §0 强制）' },
      { id: 'no-unexplained-dependency', points: 5, label: '没有新依赖，或新依赖已说明理由' },
    ],
  },
  {
    key: 'resilience',
    max: 10,
    label: '失败处理、观测和恢复说明',
    signals: [
      { id: 'failure-handling', points: 5, label: '说明了失败时会怎样' },
      { id: 'observability', points: 5, label: '说明了失败会被谁 / 怎么发现' },
    ],
  },
]

/** Ready thresholds by risk level. */
export const READY_THRESHOLD = { A: 90, B: 85, C: 75 }

/**
 * Scoring signals every A-level PR must have regardless of category. Deliberately
 * short: the category-specific half lives in `SPECIALIZED_EVIDENCE`, and pinning
 * a long universal list here is exactly the mistake Codex caught.
 */
export const A_REQUIRED_SIGNALS = ['required-ci-green']

/** id -> {dimension, points, label}, built once from the table above. */
const SIGNAL_INDEX = new Map(
  SCORE_DIMENSIONS.flatMap((dimension) =>
    dimension.signals.map((signal) => [signal.id, { dimension: dimension.key, ...signal }]),
  ),
)

/** @returns {string[]} every signal id the table knows about */
export function knownSignalIds() {
  return [...SIGNAL_INDEX.keys()]
}

/**
 * Add up the observed signals.
 *
 * @param {{signals?: Iterable<string>}} input observed signal ids
 * @returns {{total: number, dimensions: Array<{key: string, label: string, max: number, awarded: number, present: string[], missing: string[]}>}}
 * @throws if a signal id is not in the table
 */
export function scoreDelivery({ signals = [] } = {}) {
  const observed = new Set(signals)
  for (const id of observed) {
    if (!SIGNAL_INDEX.has(id)) {
      throw new Error(
        `unknown evidence signal "${id}" — 未登记的证据不许得分（已登记：${knownSignalIds().join(', ')}）`,
      )
    }
  }

  const dimensions = SCORE_DIMENSIONS.map((dimension) => {
    const present = dimension.signals.filter((s) => observed.has(s.id))
    const missing = dimension.signals.filter((s) => !observed.has(s.id))
    return {
      key: dimension.key,
      label: dimension.label,
      max: dimension.max,
      awarded: present.reduce((sum, s) => sum + s.points, 0),
      present: present.map((s) => s.id),
      missing: missing.map((s) => s.id),
    }
  })

  return { total: dimensions.reduce((sum, d) => sum + d.awarded, 0), dimensions }
}

/**
 * Describe one missing evidence item, without trusting its shape.
 *
 * The blocker text is the only thing a human gets to act on. Interpolating
 * `${m.id}（${m.label}）` on an item that has neither prints
 * `undefined（undefined）` — a blocker that names nothing and cannot be
 * cleared. Reporting "an item we cannot describe" is at least honest about
 * what happened.
 *
 * @param {unknown} item
 * @returns {string}
 */
function describeEvidenceItem(item) {
  const id = item && typeof item.id === 'string' && item.id !== '' ? item.id : null
  const label = item && typeof item.label === 'string' && item.label !== '' ? item.label : null
  if (id && label) return `${id}（${label}）`
  if (id) return id
  return '一条说不出名字的证据项（评估结果结构不合法）'
}

/**
 * Why an A-level PR's specialised-evidence evaluation does not clear the gate,
 * or `null` if it genuinely does.
 *
 * 🔴 Codex finding on PR #1205 round 2. The previous shape asked the question
 * backwards: it blocked only when it could *prove* something was missing, and
 * passed by default otherwise. Three malformed evaluation objects therefore
 * sailed a score-100 A-level PR straight to READY with zero blockers:
 *
 *   { readable: true }                              // no `missing` at all
 *   { readable: true, missing: 'not-an-array' }     // `Array.isArray` false
 *   { readable: true, missing: [], complete: false } // says so itself
 *
 * The first two are what a partially-built or partially-deserialised object
 * looks like; the third is an evaluation openly reporting it did not finish.
 * All three read as "nothing to report" to a check written as `else if
 * (Array.isArray(x.missing) && x.missing.length > 0)`, because an absent or
 * mistyped field makes that condition false — the same shape as success.
 *
 * So the question is asked the other way round. The gate clears only on a
 * *positive* assertion of completeness from a structurally valid result:
 * `readable === true`, `required` and `missing` both real arrays, `missing`
 * empty, and `complete === true`. Anything else — malformed, inconsistent, or
 * merely not-positively-complete — is a blocker. This is the same fail-closed
 * rule `risk.mjs` applies to an unreadable file list, applied to the evidence
 * side: "we could not tell" must never render as "there was nothing wrong".
 *
 * @param {unknown} specialized
 * @returns {string|null}
 */
function specializedEvidenceProblem(specialized) {
  if (!specialized || typeof specialized !== 'object') {
    return 'A 级：命中风险对应的专项证据压根没算过 —— 按缺失处理'
  }
  if (specialized.readable !== true) {
    return 'A 级：命中风险对应的专项证据读不到 —— 按缺失处理'
  }
  if (!Array.isArray(specialized.required) || !Array.isArray(specialized.missing)) {
    return 'A 级：专项证据评估结果结构不合法（required / missing 不是数组）—— 按缺失处理'
  }
  if (specialized.missing.length > 0) {
    return `A 级缺少命中风险对应的专项证据：${specialized.missing.map(describeEvidenceItem).join('、')}`
  }
  // Reached only when nothing is listed as missing. That is not the same as
  // "everything required was found" — an evaluation that stopped early reports
  // exactly this. Require it to say so itself.
  if (specialized.complete !== true) {
    return 'A 级：专项证据评估没有给出「已完成」的结论 —— 缺项列表为空不等于查全了，按缺失处理'
  }
  // A `missing.length > required.length` consistency check was written here and
  // removed: by this point `missing` is empty, so it can never fire. The
  // inverse inconsistency — `complete: true` alongside a non-empty `missing` —
  // is already caught above, and correctly, by the missing-items branch.
  return null
}

/**
 * Collect every hard-gate blocker. Returns all of them, not the first: a report
 * that names one blocker invites a fix-and-retry cycle that discovers the next
 * one only after another full round.
 *
 * @param {{risk?: string, gates?: Record<string, unknown>|null, observedSignals?: Iterable<string>}} input
 * @returns {string[]}
 */
function hardGateBlockers({ risk, gates, observedSignals }) {
  const blockers = []
  const g = gates ?? {}

  if (g.evidenceReadable !== true) {
    blockers.push('读不到判定所需的证据 —— 失败关闭，不得当成「没有问题」')
  }
  if (g.shaMatches !== true) {
    blockers.push('评级 / 评分绑定的 commit 与当前 head 对不上 —— head 一动，旧结论立即作废')
  }
  if (g.requiredCiPassed !== true) {
    blockers.push(
      g.requiredCiPassed === null || g.requiredCiPassed === undefined
        ? '必过 CI 状态读不到 —— 按未通过处理'
        : '必过 CI 未通过',
    )
  }
  if (typeof g.openBlockerCount !== 'number') {
    blockers.push('当前 head 的 Codex 未解决问题数读不到 —— 按有问题处理')
  } else if (g.openBlockerCount > 0) {
    blockers.push(`当前 head 还有 ${g.openBlockerCount} 条 Codex P0/P1/P2 未解决`)
  }
  if (risk === 'A') {
    const observed = new Set(observedSignals ?? [])
    const missing = A_REQUIRED_SIGNALS.filter((id) => !observed.has(id))
    if (missing.length > 0) {
      blockers.push(`A 级缺少必备证据：${missing.join('、')}`)
    }
    // The category-matched half. The gate clears only on a positive, valid
    // assertion of completeness — see `specializedEvidenceProblem`.
    const problem = specializedEvidenceProblem(g.specialized)
    if (problem) blockers.push(problem)
  }
  return blockers
}

/**
 * Final Ready / Blocked / Needs-product-decision call.
 *
 * `NEEDS_PRODUCT_DECISION` is never inferred from a low score or a stuck loop —
 * a technical dead end is a technical problem, and routing it to the Product
 * Owner as a "decision" is how a PM ends up carrying Codex comments around
 * again. It is returned only when the caller explicitly asserts a business
 * question exists (scope, money, a client fact, accepting a risk).
 *
 * Every input is optional on purpose: this function's contract is that missing
 * or unreadable evidence produces blockers, not a crash. A caller that cannot
 * fetch the check runs must be able to say so by passing nothing.
 *
 * @param {{risk?: string, score?: {total?: number}, gates?: Record<string, unknown>|null, observedSignals?: Iterable<string>}} [input]
 * @returns {{decision: 'READY_FOR_PRODUCT_OWNER'|'BLOCKED'|'NEEDS_PRODUCT_DECISION', ready: boolean, threshold: number, score: number, blockers: string[], productDecisionReason: string|null}}
 */
export function decideReadiness({ risk, score, gates, observedSignals } = {}) {
  const threshold = READY_THRESHOLD[risk] ?? READY_THRESHOLD.A
  const total = Number.isFinite(score?.total) ? score.total : -1
  const blockers = hardGateBlockers({ risk, gates, observedSignals })

  if (total < 0) {
    blockers.push('质量分算不出来 —— 失败关闭')
  } else if (total < threshold) {
    blockers.push(`质量分 ${total} 低于 ${risk} 级门槛 ${threshold}`)
  }

  const g = gates ?? {}
  if (g.productDecisionNeeded === true) {
    return {
      decision: 'NEEDS_PRODUCT_DECISION',
      ready: false,
      threshold,
      score: total,
      blockers,
      productDecisionReason: typeof g.productDecisionReason === 'string' ? g.productDecisionReason : null,
    }
  }

  return {
    decision: blockers.length === 0 ? 'READY_FOR_PRODUCT_OWNER' : 'BLOCKED',
    ready: blockers.length === 0,
    threshold,
    score: total,
    blockers,
    productDecisionReason: null,
  }
}

// --- 当场试跑 (trial-run) gate --------------------------------------------
//
// PM rule 2026-09-26: anything that will run automatically later must be
// triggered once, end to end, before it counts as done. `check-risk-gate.mjs`
// calls ONLY the pure functions below — never `scoreDelivery`, which throws on
// an unknown signal and would turn one bad input into every PR going red.
//
// The path table lives here, not in `risk.mjs`: it answers "does this PR owe a
// trial-run record", which is a different question from "how risky is it".

/**
 * Paths whose changes will run automatically later. `workflowSchedule` means
 * a top-level workflow file whose head version has `on.schedule`.
 */
export const TRIAL_RUN_PATH_RULES = [
  { exact: 'render.yaml', why: '生产服务与 cron 调度' },
  { prefix: 'src/app/api/cron/', why: '生产定时任务路由' },
  { prefix: 'src/lib/cron/', why: '生产定时任务注册与调度' },
  // Whole directory, not just `functions/`: the client, serve guard and
  // registry decide what runs too (狄仁杰 DR78-1, #2078).
  { prefix: 'src/lib/inngest/', why: 'Inngest 后台 / 定时函数与注册' },
  { prefix: 'src/app/api/inngest/', why: 'Inngest 注册入口' },
  { prefix: 'scripts/factory-worker/inngest-', why: '工厂 worker 的 Inngest 函数' },
  { prefix: 'scripts/auto-dev/', why: '自动开发通道脚本' },
  // Called daily by a scheduled job; its output is the PM's 今日待办 (子牙, #2078).
  { prefix: 'src/lib/pm-todo/', why: '每天定时生成的今日待办' },
  { workflowSchedule: true, why: '带 schedule 的 GitHub 工作流' },
]

/** A workflow GitHub actually loads: directly under `.github/workflows/`. */
export const WORKFLOW_FILE = /^\.github\/workflows\/[^/]+\.ya?ml$/

/** Test-only files never run on a schedule; changing them owes no trial run. */
const TEST_FILE = /(^|\/)__tests__\/|\.(test|spec)\.[cm]?[jt]sx?$/

/** Files whose added lines are scanned for scheduled-work markers. */
const CODE_FILE = /\.([cm]?[jt]sx?|sh|py)$/

/** How far ahead a "当场跑不了" card may promise its check. */
export const CANNOT_RUN_MAX_DAYS = 7

const LEDGER_CARD = /^docs\/ledger\/(\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*)\.md$/

/**
 * @param {{exact?: string, prefix?: string}} rule
 * @param {string} path
 */
function trialPathRuleMatches(rule, path) {
  if (rule.exact !== undefined) return path === rule.exact
  if (rule.prefix !== undefined) return path.startsWith(rule.prefix)
  return false
}

/**
 * Every "will run automatically" hit in the diff. A workflow whose content we
 * could not read (`contents[path]` missing or null) counts as a hit: "we could
 * not tell" must not read as "not scheduled".
 *
 * @param {unknown} files
 * @param {Record<string, string|null>} contents
 * @returns {string[]} one human-readable line per hit
 */
function trialRunHits(files, contents) {
  if (!Array.isArray(files) || files.length === 0) {
    return ['改动清单读不到 —— 分不清有没有改到定时任务，按需要试跑处理']
  }
  const hits = []
  for (const entry of files) {
    const filename = entry?.filename
    if (typeof filename !== 'string' || filename === '') {
      hits.push('改动清单里有一项没有文件名 —— 按需要试跑处理')
      continue
    }
    // A deleted scheduled job owes no trial run. A rename is NOT a deletion:
    // it keeps `renamed` and both ends are checked below.
    if (entry.status === 'removed') continue
    const previous = typeof entry.previous_filename === 'string' ? entry.previous_filename : ''
    for (const path of previous ? [filename, previous] : [filename]) {
      if (TEST_FILE.test(path)) continue
      const rule = TRIAL_RUN_PATH_RULES.find((r) => trialPathRuleMatches(r, path))
      if (rule) hits.push(`${path}（${rule.why}）`)
    }
    if (WORKFLOW_FILE.test(filename)) {
      const scheduled = workflowHasSchedule(contents[filename] ?? null)
      if (scheduled === true) hits.push(`${filename}（带 schedule 的 GitHub 工作流）`)
      if (scheduled === null) hits.push(`${filename}（工作流内容读不到或判不了有没有 schedule —— 按需要试跑处理）`)
    }
    const scan = scanAddedCode(entry, filename)
    if (scan) hits.push(scan)
  }
  return hits
}

/**
 * A job can be scheduled from anywhere: a new `createFunction(` or a changed
 * `*_CRON =` outside the path table rated B and owed no record (DR78-1 /
 * DR78-2, #2078). So the lines a diff adds are scanned too. A code file under
 * `src/` or `scripts/` whose patch GitHub left out (large diffs) cannot be
 * scanned and counts as a hit; one with zero changed lines (a pure rename)
 * has nothing to scan.
 *
 * @param {Record<string, unknown>} entry
 * @param {string} filename
 * @returns {string|null}
 */
function scanAddedCode(entry, filename) {
  if (!CODE_FILE.test(filename) || TEST_FILE.test(filename)) return null
  const found = scheduledCodeInPatch(entry.patch)
  if (found === null) {
    if (Number(entry.changes) === 0) return null
    if (!/^(src|scripts)\//.test(filename)) return null
    return `${filename}（GitHub 没给出这份改动的内容，查不了有没有新增定时 / 后台任务 —— 按需要试跑处理）`
  }
  return found.length > 0 ? `${filename}（新增行里有定时 / 后台任务写法：${found.join('、')}）` : null
}

/**
 * Which files the gate must read at the PR head before `evaluateTrialRun` can
 * decide: every changed top-level workflow, and every ledger card this PR adds
 * (a "当场跑不了" exit may cite it).
 *
 * @param {{files?: unknown}} input
 * @returns {string[]}
 */
export function planTrialRunReads({ files } = {}) {
  if (!Array.isArray(files)) return []
  const paths = []
  for (const entry of files) {
    const filename = entry?.filename
    if (typeof filename !== 'string' || entry.status === 'removed') continue
    if (WORKFLOW_FILE.test(filename)) paths.push(filename)
    else if (entry.status === 'added' && LEDGER_CARD.test(filename)) paths.push(filename)
  }
  return paths
}

/**
 * @param {string} today YYYY-MM-DD
 * @param {number} days
 * @returns {string}
 */
function addDays(today, days) {
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Check the "当场跑不了" exit: it must cite a ledger card this PR adds, whose
 * `verify_by` falls between today and today + 7 days.
 *
 * @param {{cardIds: string[]}} exit
 * @param {unknown[]} files
 * @param {Record<string, string|null>} contents
 * @param {string} today
 * @returns {{ok: boolean, problems: string[]}}
 */
function checkCannotRunExit(exit, files, contents, today) {
  const added = new Set(
    files.filter((f) => f?.status === 'added' && typeof f.filename === 'string').map((f) => f.filename),
  )
  const cited = exit.cardIds.filter((id) => added.has(`docs/ledger/${id}.md`))
  if (cited.length === 0) {
    return { ok: false, problems: ['写了「当场跑不了」，但段里没引用本 PR 新增的台账卡（docs/ledger/<id>.md）'] }
  }
  const latest = addDays(today, CANNOT_RUN_MAX_DAYS)
  const problems = []
  for (const id of cited) {
    const verifyBy = parseLedgerVerifyBy(contents[`docs/ledger/${id}.md`] ?? null)
    if (verifyBy === null) problems.push(`台账卡 ${id} 读不到或没有合法的 verify_by`)
    else if (verifyBy < today) problems.push(`台账卡 ${id} 的 verify_by（${verifyBy}）已过期，改成首次自动运行当天`)
    else if (verifyBy > latest) problems.push(`台账卡 ${id} 的 verify_by（${verifyBy}）晚于 ${latest}，改成首次自动运行当天（最多 ${CANNOT_RUN_MAX_DAYS} 天内）`)
    else return { ok: true, problems: [] }
  }
  return { ok: false, problems }
}

/**
 * Does this PR owe a trial-run record, and does its body carry one?
 *
 * Checks presence and shape only — a made-up record passes. Reviewers judge
 * whether it is true; every summary says so.
 *
 * @param {{files?: unknown, body?: unknown, contents?: Record<string, string|null>|null, today?: string}} input
 * @returns {{required: boolean, satisfied: boolean, via: 'record'|'exit'|null, hits: string[], problems: string[]}}
 */
export function evaluateTrialRun({ files, body, contents, today } = {}) {
  const read = contents && typeof contents === 'object' ? contents : {}
  const hits = trialRunHits(files, read)
  if (hits.length === 0) return { required: false, satisfied: true, via: null, hits, problems: [] }

  const section = extractTrialRunSection(body)
  if (section === null) {
    return { required: true, satisfied: false, via: null, hits, problems: ['PR 正文没有「## 当场试跑」段'] }
  }
  const elements = checkTrialRunElements(section)
  if (elements.missing.length === 0) return { required: true, satisfied: true, via: 'record', hits, problems: [] }

  const exit = findCannotRunExit(section)
  if (exit && Array.isArray(files) && typeof today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(today)) {
    const result = checkCannotRunExit(exit, files, read, today)
    if (result.ok) return { required: true, satisfied: true, via: 'exit', hits, problems: [] }
    return { required: true, satisfied: false, via: null, hits, problems: result.problems }
  }
  return {
    required: true,
    satisfied: false,
    via: null,
    hits,
    problems: [`「## 当场试跑」段缺：${elements.missing.join('、')}`],
  }
}

/**
 * The trial-run result to use when the check itself blew up. Still blocks —
 * an error is never a pass — but says why, instead of crashing the gate.
 *
 * @param {string} message
 */
export function trialRunCheckFailed(message) {
  return {
    required: true,
    satisfied: false,
    via: null,
    hits: [],
    problems: [`试跑检查自身出错：${message}`],
  }
}

/**
 * Fold the trial-run result into a merge decision. It can only make the
 * decision stricter: a PR that owes a trial run and lacks one is blocked with
 * auto-merge off, whatever its risk or sign-offs. It never produces `enable`.
 *
 * Fail closed: only an explicit `required: false`, or `satisfied: true`, lets
 * the decision through unchanged.
 *
 * @param {{decision?: any, trialRun?: any}} input
 */
export function applyTrialRunToDecision({ decision, trialRun } = {}) {
  const ok = trialRun && typeof trialRun === 'object' && (trialRun.required === false || trialRun.satisfied === true)
  if (ok && decision && typeof decision === 'object') return decision
  const problems =
    trialRun && Array.isArray(trialRun.problems) && trialRun.problems.length > 0
      ? trialRun.problems.map(String)
      : ['试跑检查结果读不到']
  const trialReason = `当场试跑不合格 —— ${problems.join('；')}`
  // Already blocked for another reason (draft, fork, A without sign-off):
  // keep that reason first — it is the one to act on (魏征 W78-1, #2078).
  const earlier =
    decision && typeof decision === 'object' && decision.pass === false && typeof decision.reason === 'string'
      ? decision.reason
      : null
  return {
    pass: false,
    decision: 'disable',
    tier: 'blocked',
    reason: earlier ? `${earlier}；另：${trialReason}` : trialReason,
  }
}

/**
 * The whole trial-run evaluation, with the file reader injected. Never
 * throws: a failing reader or unexpected input becomes a blocking result that
 * says what went wrong (子牙 PR2 design review, item 1; 魏征 W78-5).
 *
 * @param {{files?: unknown, body?: unknown, today?: string, readFiles?: (paths: string[]) => Promise<Record<string, string|null>>}} input
 */
export async function evaluateTrialRunSafely({ files, body, today, readFiles } = {}) {
  try {
    // A missing `readFiles` throws here and lands in the catch like any other failure.
    const contents = await /** @type {Function} */ (readFiles)(planTrialRunReads({ files }))
    return evaluateTrialRun({ files, body, contents, today })
  } catch (err) {
    return trialRunCheckFailed(err instanceof Error ? err.message : String(err))
  }
}

/**
 * Summary lines for the Risk gate report, in plain Chinese.
 *
 * @param {any} trialRun
 * @returns {string[]}
 */
export function describeTrialRun(trialRun) {
  if (!trialRun || typeof trialRun !== 'object') return ['- 当场试跑：检查结果读不到 —— 按不合格处理']
  if (trialRun.required === false) return ['- 当场试跑：不涉及（没改「以后会自动跑」的文件）']
  const hits = Array.isArray(trialRun.hits) ? trialRun.hits : []
  const lines = [`- 当场试跑：改到了「以后会自动跑」的文件 —— ${hits.slice(0, 5).join('；') || '（清单读不到）'}${hits.length > 5 ? ` 等 ${hits.length} 处` : ''}`]
  if (trialRun.satisfied === true) {
    lines.push(
      trialRun.via === 'exit'
        ? '  - 走「当场跑不了」出口：原因已写，并引用了本 PR 新增、7 天内到期的台账卡'
        : '  - 「## 当场试跑」段齐了（触发方式 / 时间 / 状态）',
    )
  } else {
    const problems = Array.isArray(trialRun.problems) ? trialRun.problems : []
    lines.push(`  - ❌ ${problems.join('；') || '不合格'} → 本检查红、自动合并关闭`)
    lines.push(
      '  - 补法：在 PR 正文加「## 当场试跑」段，写「触发方式：… / 时间：… / 状态：…」；确实当场跑不了，写「当场跑不了：原因」并在本 PR 新增一张台账卡（verify_by = 首次自动运行当天，7 天内），段里写上卡的 id',
    )
  }
  lines.push('  - 注意：机器只查段落在不在、格式对不对，试跑真假由审查人核对')
  lines.push('  - 范围：只看直接改到的定时 / 后台任务文件和新增的定时写法，不追踪它们调用的代码')
  return lines
}
