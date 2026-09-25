/**
 * Deterministic A/B/C risk rating for a pull request, computed from the files
 * the PR actually changed.
 *
 * 🔴 **Why this is code and not a prompt.**
 *
 * `docs/ENGINEERING_QUALITY_GATES.md` already defines what A, B and C mean.
 * What it could not define was *who decides*. Until now the answer was "the
 * agent writing the PR", which makes the rating an opinion — and an opinion
 * held by the same party the rating is supposed to constrain. An agent under
 * time pressure that can call its own change "C" has effectively removed the
 * gate. So the rating is computed here, from the diff, by rules a reviewer can
 * read; the PR author's own declaration is accepted only as a *floor*
 * (`classifyRisk` takes the higher of declared and computed), never as a
 * ceiling.
 *
 * Three consequences follow, and all three are deliberate:
 *
 * - **Unknown means A.** Unreadable file list, an entry with no filename, an
 *   empty list — every one of those is rated A with an explicit reason, because
 *   "we could not look" and "we looked and it was fine" must never produce the
 *   same output. This is the same fail-closed rule `fix-scope.mjs` already
 *   applies to the blast-radius guard.
 * - **C is a narrow allowlist, not a fallback.** A file is C-safe only if it
 *   matches an explicit low-risk pattern. Anything unrecognised is B. A diff is
 *   C only when *every* file in it is C-safe.
 * - **Over-classification is tolerated; under-classification is not.** A few
 *   rules here (a publisher module's own test file, this control plane's own
 *   README) rate higher than a human would. That costs one extra review round.
 *   The opposite error costs a production incident, so the asymmetry is priced
 *   in on purpose rather than tuned away.
 *
 * This module is pure: no I/O, no network, no clock. `tests/risk.test.ts`
 * exercises it offline.
 */

/** Severity order, lowest first. Index position is the comparison key. */
export const RISK_ORDER = ['C', 'B', 'A']

/**
 * The higher (more severe) of two ratings. An unrecognised value is treated as
 * A rather than ignored — a typo in a rating must not quietly relax the gate.
 *
 * @param {string} a
 * @param {string} b
 * @returns {'A'|'B'|'C'}
 */
export function higherRisk(a, b) {
  const rank = (r) => {
    const i = RISK_ORDER.indexOf(r)
    return i === -1 ? RISK_ORDER.length : i
  }
  const winner = rank(a) >= rank(b) ? a : b
  return RISK_ORDER.includes(winner) ? winner : 'A'
}

/**
 * The kinds of risk an A rule can represent.
 *
 * These exist because "this PR is A" is not actionable on its own. A migration,
 * a workflow edit and a payment route are all A, but they call for completely
 * different evidence — and demanding one fixed kind of proof from all of them
 * (Codex's second finding on PR #1205) either blocks the ones it does not fit
 * forever, or teaches people to write evidence they do not have. So each rule
 * names its category, `classifyRisk` reports the set a PR actually hit, and
 * `quality.mjs` asks for the evidence matching *those*.
 */
export const RISK_CATEGORY = {
  DB_MIGRATION: 'db-migration',
  CONTROL_PLANE: 'control-plane',
  PRODUCTION_SCHEDULE: 'production-schedule',
  AUTH_ISOLATION: 'auth-isolation',
  KERNEL_EXECUTION: 'kernel-execution',
  MONEY: 'money',
  OUTWARD_WRITE: 'outward-write',
  NETWORK_BOUNDARY: 'network-boundary',
  CREDENTIALS: 'credentials',
  SUPPLY_CHAIN: 'supply-chain',
  /** Rules for how people and agents use the machine — not code, but the machine's rulebook. */
  GOVERNANCE: 'governance',
  /** Not a kind of change — a kind of ignorance. The diff could not be read. */
  UNREADABLE: 'unreadable',
}

/**
 * Paths that make a PR A-level. Every entry carries its own `why`, in the
 * language the Product Owner reads, because a denylist nobody can explain gets
 * "tidied up" eventually — that is exactly how `fix-scope.mjs` justifies its
 * own list, and this one sits next to it. Every entry also carries a
 * `category`, which is what decides the specialised evidence it must produce.
 *
 * Rule kinds:
 *   `exact`            — whole path equals
 *   `prefix`           — path starts with
 *   `suffix`           — path ends with
 *   `includes`         — substring anywhere in the path
 *   `basenameIncludes` — substring of the final path segment
 *   `basenameWord`     — the final segment contains this as a whole word
 *                        (so `rls` matches `rls-policy.ts` but not `urls.ts`)
 */
export const A_RISK_RULES = [
  // --- Database structure and production data shape -----------------------
  { prefix: 'supabase/migrations/', why: 'migration —— 数据库结构变更，不可逆', category: RISK_CATEGORY.DB_MIGRATION },
  { suffix: '.sql', why: 'SQL —— 直接改数据库结构或生产数据', category: RISK_CATEGORY.DB_MIGRATION },

  // --- The control plane, including this gate itself ----------------------
  { prefix: '.github/workflows/', why: 'CI 定义与本闸门自身', category: RISK_CATEGORY.CONTROL_PLANE },
  { prefix: 'tools/ops-review-loop/', why: '决定 PR 自身命运的评级与复审控制面', category: RISK_CATEGORY.CONTROL_PLANE },
  { prefix: 'tools/ai-orchestrator/', why: '编排控制面', category: RISK_CATEGORY.CONTROL_PLANE },
  { exact: 'render.yaml', why: '生产服务与 cron 调度', category: RISK_CATEGORY.PRODUCTION_SCHEDULE },

  // --- Governance: the rulebook the machine and its operators follow ------
  // 🔴 子牙 design review 2026-09-25: `C_SAFE_RULES` rates every `.md` as C, so
  // once B/C PRs auto-merge, a PR that only rewrites CLAUDE.md (merge rules,
  // client-data red lines) or the merge-authorization doc would land with zero
  // human eyes on it. The machine's behaviour is set by code; these files set
  // how people and agents are allowed to use the machine. Editing the rulebook
  // unreviewed is the same hole as editing the gate unreviewed.
  { exact: 'CLAUDE.md', why: '仓库总规则 —— 合并规则、客户数据红线', category: RISK_CATEGORY.GOVERNANCE },
  { exact: 'AGENTS.md', why: 'agent 入口规则', category: RISK_CATEGORY.GOVERNANCE },
  { prefix: '.github/', why: 'GitHub 配置与合并规则文档（workflows 之外的部分）', category: RISK_CATEGORY.GOVERNANCE },
  { prefix: '.claude/', why: 'agent 规则、skill 与层级门定义', category: RISK_CATEGORY.GOVERNANCE },
  { exact: 'docs/ENGINEERING_QUALITY_GATES.md', why: '风险定级与质量闸的规则书', category: RISK_CATEGORY.GOVERNANCE },
  { exact: 'docs/ledger/README.md', why: '台账规则 —— 门卫怎么拦、夜巡怎么翻', category: RISK_CATEGORY.GOVERNANCE },
  { prefix: 'scripts/ledger-', why: '台账检查与更新脚本', category: RISK_CATEGORY.GOVERNANCE },

  // --- Auth, permissions, tenant isolation --------------------------------
  { exact: 'src/middleware.ts', why: '请求级鉴权与路由边界', category: RISK_CATEGORY.AUTH_ISOLATION },
  { prefix: 'src/lib/auth/', why: '鉴权与客户访问边界', category: RISK_CATEGORY.AUTH_ISOLATION },
  { prefix: 'src/app/api/auth/', why: '鉴权端点', category: RISK_CATEGORY.AUTH_ISOLATION },
  { prefix: 'src/app/api/webhooks/', why: '外部入站 webhook —— 签名校验即安全边界', category: RISK_CATEGORY.AUTH_ISOLATION },
  { basenameWord: 'rls', why: 'RLS 行级隔离策略', category: RISK_CATEGORY.AUTH_ISOLATION },
  { basenameIncludes: 'isolation', why: '客户 / 租户隔离判定', category: RISK_CATEGORY.AUTH_ISOLATION },

  // --- Execution kernel: authorization, approval, idempotency, state ------
  { prefix: 'src/lib/kernel/', why: 'Kernel —— 执行授权、审批、幂等、状态机', category: RISK_CATEGORY.KERNEL_EXECUTION },
  { prefix: 'src/app/api/kernel/', why: 'Kernel 端点', category: RISK_CATEGORY.KERNEL_EXECUTION },
  { prefix: 'src/lib/execution/', why: '自动执行策略与背书 —— 决定系统自己会做什么', category: RISK_CATEGORY.KERNEL_EXECUTION },

  // --- Money -------------------------------------------------------------
  { prefix: 'src/lib/billing/', why: '计费与用量', category: RISK_CATEGORY.MONEY },
  { prefix: 'src/app/api/stripe/', why: '支付', category: RISK_CATEGORY.MONEY },
  { prefix: 'src/app/api/mtc/', why: '客户额度扣减', category: RISK_CATEGORY.MONEY },

  // --- Production scheduling ---------------------------------------------
  { prefix: 'src/lib/cron/', why: '生产定时任务注册与调度', category: RISK_CATEGORY.PRODUCTION_SCHEDULE },
  { prefix: 'src/app/api/cron/', why: '生产定时任务路由', category: RISK_CATEGORY.PRODUCTION_SCHEDULE },

  // --- Outward, hard-to-retract side effects ------------------------------
  { basenameIncludes: 'publisher', why: '对外发布 —— 发出去就撤不回来', category: RISK_CATEGORY.OUTWARD_WRITE },
  { prefix: 'src/lib/email/', why: '对外发信', category: RISK_CATEGORY.OUTWARD_WRITE },
  { basenameIncludes: 'guardrail', why: '花费 / 发布安全闸 —— 它松了别的全松', category: RISK_CATEGORY.OUTWARD_WRITE },
  { basenameIncludes: 'ssrf', why: 'SSRF 出网边界', category: RISK_CATEGORY.NETWORK_BOUNDARY },

  // --- Credentials --------------------------------------------------------
  { suffix: '.env', why: '凭证文件', category: RISK_CATEGORY.CREDENTIALS },
  { includes: '/.env.', why: '凭证文件（带后缀变体）', category: RISK_CATEGORY.CREDENTIALS },
  // `cred` rather than `credential`: this repo names them `creds-loader.ts`.
  // It also catches `credit-*`, which is money and belongs at A anyway.
  { basenameIncludes: 'cred', why: '凭证装载 / 额度', category: RISK_CATEGORY.CREDENTIALS },

  // --- Supply chain (CLAUDE.md §4 counts a new dependency as a big task) ---
  { exact: 'package.json', why: '依赖清单 —— 引入新依赖即供应链面', category: RISK_CATEGORY.SUPPLY_CHAIN },
  { exact: 'package-lock.json', why: '依赖锁 —— 引入新依赖即供应链面', category: RISK_CATEGORY.SUPPLY_CHAIN },
]

/**
 * Patterns a file must match to count as strictly low-risk. Not a fallback:
 * anything unmatched here is B, and a diff is C only when every file matches.
 */
export const C_SAFE_RULES = [
  { prefix: 'docs/', why: '文档' },
  { suffix: '.md', why: '文档' },
  { suffix: '.mdx', why: '文档' },
  { suffix: '.txt', why: '纯文本' },
  { suffix: '.css', why: '样式' },
  { suffix: '.scss', why: '样式' },
  { suffix: '.svg', why: '图片资源' },
  { suffix: '.png', why: '图片资源' },
  { suffix: '.jpg', why: '图片资源' },
  { suffix: '.jpeg', why: '图片资源' },
  { suffix: '.gif', why: '图片资源' },
  { suffix: '.webp', why: '图片资源' },
  { suffix: '.avif', why: '图片资源' },
  { suffix: '.ico', why: '图片资源' },
  { suffix: '.test.ts', why: '测试补充，不改生产行为' },
  { suffix: '.test.tsx', why: '测试补充，不改生产行为' },
  { suffix: '.spec.ts', why: '测试补充，不改生产行为' },
  { suffix: '.spec.tsx', why: '测试补充，不改生产行为' },
  { includes: '/__tests__/', why: '测试补充，不改生产行为' },
]

/**
 * @param {{exact?: string, prefix?: string, suffix?: string, includes?: string, basenameIncludes?: string, basenameWord?: string}} rule
 * @param {string} path
 */
function ruleMatches(rule, path) {
  const basename = path.slice(path.lastIndexOf('/') + 1)
  if (rule.exact !== undefined) return path === rule.exact
  if (rule.prefix !== undefined) return path.startsWith(rule.prefix)
  if (rule.suffix !== undefined) return path.endsWith(rule.suffix)
  if (rule.includes !== undefined) return path.includes(rule.includes)
  if (rule.basenameIncludes !== undefined) return basename.toLowerCase().includes(rule.basenameIncludes)
  if (rule.basenameWord !== undefined) {
    return new RegExp(`(^|[^a-z0-9])${rule.basenameWord}([^a-z0-9]|$)`, 'i').test(basename)
  }
  return false
}

/**
 * Rate a single path.
 *
 * @param {string} path
 * @returns {{risk: 'A'|'B'|'C', why: string, category: string|null}}
 */
export function classifyFile(path) {
  const aRule = A_RISK_RULES.find((rule) => ruleMatches(rule, path))
  if (aRule) return { risk: 'A', why: aRule.why, category: aRule.category }

  const cRule = C_SAFE_RULES.find((rule) => ruleMatches(rule, path))
  if (cRule) return { risk: 'C', why: cRule.why, category: null }

  return { risk: 'B', why: '含实际业务逻辑，且不在严格低风险清单内', category: null }
}

/**
 * Statuses GitHub uses when a file's entry carries a `previous_filename`.
 * `copied` is included because the API sets `previous_filename` there too.
 */
const RENAME_STATUSES = new Set(['renamed', 'copied'])

/**
 * Every path one changed-file entry represents.
 *
 * 🔴 Codex finding on PR #1205 (P1): rating only `filename` let a rename walk a
 * file *out* of the protected set and take its rating with it. GitHub reports
 * `git mv .github/workflows/guard.yml docs/guard.yml` as one entry whose
 * `filename` is the new, C-safe path and whose `previous_filename` is the
 * protected one. Reading only `filename` rates "quietly disable the control
 * plane" as a documentation change — the single most valuable move for anyone
 * trying to get past this gate.
 *
 * So both ends of a rename are rated and the higher wins. And an entry that
 * *claims* to be a rename without saying what it renamed is unreadable, not
 * harmless: it fails closed, same as a missing filename.
 *
 * @param {Record<string, unknown>} entry
 * @returns {{paths: string[], unreadable: string|null}}
 */
function pathsForEntry(entry) {
  const paths = []
  const filename = entry?.filename
  if (typeof filename !== 'string' || filename === '') {
    return { paths, unreadable: '改动清单里有一项没有文件名 —— 输入不可信，按 A 处理' }
  }
  paths.push(filename)

  const previous = entry?.previous_filename
  const status = typeof entry?.status === 'string' ? entry.status : ''
  if (typeof previous === 'string' && previous !== '') {
    paths.push(previous)
  } else if (RENAME_STATUSES.has(status)) {
    return {
      paths,
      unreadable: `${filename} —— 标成 ${status} 却没有原路径，判不出它是从哪儿搬来的，按 A 处理`,
    }
  }
  return { paths, unreadable: null }
}

/**
 * Read the level the PR author declared, if any. Accepted only as a floor —
 * see `classifyRisk`. Matches the shape the quality-gate template asks for
 * ("风险级别：A"), plus the plain English equivalent.
 *
 * A body declaring more than one distinct level is ambiguous, and ambiguity in
 * this direction is a way to smuggle a downgrade past a reader, so it resolves
 * to A rather than to whichever appeared first.
 *
 * @param {string|null|undefined} body
 * @returns {'A'|'B'|'C'|null}
 */
export function parseDeclaredRisk(body) {
  if (typeof body !== 'string') return null
  const found = new Set()
  for (const match of body.matchAll(/(?:风险级别|风险等级|risk\s*level)\s*[:：]\s*([ABC])\b/gi)) {
    found.add(match[1].toUpperCase())
  }
  if (found.size === 0) return null
  if (found.size > 1) return 'A'
  return /** @type {'A'|'B'|'C'} */ ([...found][0])
}

/** Cap on how many reasons are carried into the marker, so it stays readable. */
export const MAX_REASONS = 12

/**
 * Rate a whole PR.
 *
 * @param {{files?: unknown, declaredRisk?: string|null}} input
 * @returns {{risk: 'A'|'B'|'C', computedRisk: 'A'|'B'|'C', declaredRisk: string|null, readable: boolean, reasons: string[], categories: string[]}}
 */
export function classifyRisk({ files, declaredRisk = null } = {}) {
  const unreadable = (reason) => ({
    risk: /** @type {'A'} */ ('A'),
    computedRisk: /** @type {'A'} */ ('A'),
    declaredRisk: declaredRisk ?? null,
    readable: false,
    reasons: [reason],
    categories: [RISK_CATEGORY.UNREADABLE],
  })

  if (!Array.isArray(files)) {
    return unreadable('拿不到改动文件清单 —— 无法判定，按 A 处理（不许把「读不到」当成「没问题」）')
  }
  if (files.length === 0) {
    return unreadable('改动文件清单为空 —— 分不清是「真没改」还是「没读到」，按 A 处理')
  }

  // Kept apart from `reasons` so `MAX_REASONS` can never truncate them away.
  // A PR touching 30 protected files would otherwise push "we could not read
  // entry 27" past the cut, and the report would show a confident A rating with
  // no hint that part of the diff was never actually examined.
  const unreadableReasons = []
  const reasons = []
  const categories = new Set()
  let computed = /** @type {'A'|'B'|'C'} */ ('C')
  let readable = true

  for (const entry of files) {
    const { paths, unreadable: problem } = pathsForEntry(entry)
    if (problem) {
      readable = false
      computed = 'A'
      categories.add(RISK_CATEGORY.UNREADABLE)
      unreadableReasons.push(problem)
    }
    for (const path of paths) {
      const { risk, why, category } = classifyFile(path)
      computed = higherRisk(computed, risk)
      if (category) categories.add(category)
      if (risk !== 'C') {
        const renamed = path !== entry?.filename ? `（rename 前的原路径，现为 ${entry.filename}）` : ''
        reasons.push(`${path} —— ${risk} 级（${why}）${renamed}`)
      }
    }
  }

  if (reasons.length === 0 && unreadableReasons.length === 0) {
    reasons.push(`${files.length} 个改动文件全部命中严格低风险清单（文档 / 样式 / 图片 / 纯测试）`)
  }

  const declared = typeof declaredRisk === 'string' && RISK_ORDER.includes(declaredRisk) ? declaredRisk : null
  const risk = declared ? higherRisk(computed, declared) : computed
  if (declared && risk !== computed) {
    reasons.unshift(`PR 自报 ${declared} 级，高于 diff 算出的 ${computed} 级 —— 取更高的一档`)
  }

  // Unreadable entries lead, always. They are the reason the rating cannot be
  // trusted at face value, so they must survive the cut that trims a long list
  // of ordinary hits.
  const allReasons = [...unreadableReasons, ...reasons]

  return {
    risk,
    computedRisk: computed,
    declaredRisk: declared,
    readable,
    reasons: allReasons.slice(0, MAX_REASONS),
    categories: [...categories].sort(),
  }
}

/**
 * Automated fix rounds allowed at each level, per the Product Owner's spec:
 * C=1 (only when the sample actually drew a review), B=1, A=2.
 *
 * Replaces the flat 3 rounds `handle-review.mjs` uses today, which spent three
 * full Claude rounds on a docs-only PR (#1204, 2026-08-27) before declaring
 * NEEDS HUMAN REVIEW.
 *
 * An unrecognised level gets the *smallest* budget, not the largest: a rating
 * this function does not understand must not buy more unattended pushes.
 *
 * @param {string} risk
 * @returns {number}
 */
export function maxRoundsForRisk(risk) {
  if (risk === 'A') return 2
  if (risk === 'B') return 1
  return 1
}
