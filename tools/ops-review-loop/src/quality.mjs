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
  [RISK_CATEGORY.BUILD_RUNTIME]: {
    id: 'build-runtime-evidence',
    label: '构建 / 运行时配置改了哪一项、影响哪些环境、怎么回退，已写明',
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
