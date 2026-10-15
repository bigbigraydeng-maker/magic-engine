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
  /** How the app is built and what the production runtime actually runs. */
  BUILD_RUNTIME: 'build-runtime',
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
 *   `basename`         — the final segment equals (any directory)
 *   `pattern`          — RegExp tested against the whole path; used only where
 *                        a family of names (`tsconfig*.json`, `.env*`) cannot
 *                        be written as one of the plain kinds above
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

  // --- Config that changes what the checks themselves do ------------------
  // 🔴 Verified 2026-09-27 on main 33672dbe: every one of these rated B, and B
  // auto-merges with no human since 2026-09-25. One line in any of them turns
  // a check off (strict mode, a lint rule, which tests run, the pre-commit
  // hook) while every check still reports green.
  { pattern: /(^|\/)tsconfig[^/]*\.json$/, why: 'TypeScript 检查配置 —— 一行就能关掉严格检查', category: RISK_CATEGORY.CONTROL_PLANE },
  // `workspace` / `projects`: vitest 3 reads both from the root on its own and
  // they can swap which tests run and what runs first (狄仁杰 DR71-1, #2071).
  { pattern: /(^|\/)vitest\.(config|setup|workspace|projects)\.[^/]+$/, why: '测试运行配置 —— 决定哪些测试跑、怎么跑', category: RISK_CATEGORY.CONTROL_PLANE },
  { pattern: /(^|\/)playwright\.config\.[^/]+$/, why: '端到端测试配置 —— 决定哪些页面测试跑', category: RISK_CATEGORY.CONTROL_PLANE },
  // Not in the repo today; adding one would hand a second runner the tests.
  { pattern: /(^|\/)jest\.config\.[^/]+$/, why: 'jest 测试配置 —— 新加一个就换了跑测试的方式', category: RISK_CATEGORY.CONTROL_PLANE },
  { pattern: /(^|\/)(eslint\.config\.[^/]+|\.eslintrc[^/]*)$/, why: 'lint 规则配置 —— 一行就能关掉规则', category: RISK_CATEGORY.CONTROL_PLANE },
  { prefix: '.husky/', why: '提交前自动检查钩子', category: RISK_CATEGORY.CONTROL_PLANE },
  // The db-security-invariants red-line scripts: a B PR turning either into
  // `exit 0` would switch off "RLS must say TO service_role" unattended
  // (DR71-4, #2071). `scripts/db-invariants.sql` is already A via `.sql`.
  { exact: 'scripts/check-policy-to-clause.mjs', why: 'RLS 红线检查脚本 —— 改成直接放行就关掉「策略必须写 TO service_role」', category: RISK_CATEGORY.CONTROL_PLANE },
  { exact: 'scripts/db-replay-and-verify.sh', why: '数据库红线回放检查脚本 —— 改成直接放行就关掉整套数据库安全检查', category: RISK_CATEGORY.CONTROL_PLANE },

  // --- Build and production runtime --------------------------------------
  // Same finding: these decide what production builds and runs, and rated B.
  { pattern: /(^|\/)next\.config\.[^/]+$/, why: 'Next.js 构建与运行配置 —— 响应头、重定向、构建时跳过哪些检查', category: RISK_CATEGORY.BUILD_RUNTIME },
  { pattern: /^(src\/)?instrumentation[^/]*\.[cm]?[jt]s$/, why: 'Next.js 启动钩子 —— 服务一启动就执行的代码', category: RISK_CATEGORY.BUILD_RUNTIME },
  { pattern: /(^|\/)Dockerfile[^/]*$/, why: '容器镜像定义 —— 生产 worker 实际跑什么', category: RISK_CATEGORY.BUILD_RUNTIME },
  { exact: 'supabase/config.toml', why: 'Supabase 项目配置 —— 鉴权与函数设置', category: RISK_CATEGORY.BUILD_RUNTIME },
  { basename: '.nvmrc', why: 'Node 版本锁定 —— 构建与运行用哪个 Node', category: RISK_CATEGORY.BUILD_RUNTIME },
  // Render reads `.node-version` ahead of `.nvmrc`; asdf/mise read `.tool-versions`.
  { basename: '.node-version', why: 'Node 版本锁定（Render 优先读这个）', category: RISK_CATEGORY.BUILD_RUNTIME },
  { basename: '.tool-versions', why: '运行时版本锁定（asdf / mise）', category: RISK_CATEGORY.BUILD_RUNTIME },
  // Executed as code during `next build`, where production env vars are
  // present (构建控制 2026-09-27). Babel / SWC config do not exist here; adding
  // one silently swaps the compiler for every file.
  { pattern: /(^|\/)((postcss|tailwind)\.config\.[^/]+|\.postcssrc[^/]*)$/, why: '构建时执行的样式配置 —— 生产构建里跑的代码', category: RISK_CATEGORY.BUILD_RUNTIME },
  { pattern: /(^|\/)(\.babelrc[^/]*|babel\.config\.[^/]+|\.swcrc)$/, why: '编译器配置 —— 新加一个就换了整站的编译方式', category: RISK_CATEGORY.BUILD_RUNTIME },

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
  { prefix: 'src/lib/ledger/', why: '台账解析与校验逻辑 —— 改了等于改门卫的判断标准', category: RISK_CATEGORY.GOVERNANCE },
  { pattern: /^docs\/playbooks(?:$|\/(?![^/]+\/inbox\.md$))/i, why: '经验手册正文 —— 所有窗口的必读规则书（inbox.md 除外，判 B/C）', category: RISK_CATEGORY.GOVERNANCE },

  // --- Auth, permissions, tenant isolation --------------------------------
  { exact: 'src/middleware.ts', why: '请求级鉴权与路由边界', category: RISK_CATEGORY.AUTH_ISOLATION },
  { pattern: /^(src\/)?middleware\.[cm]?[jt]sx?$/, why: 'middleware 其他写法（根目录 / .js 等）—— 请求级鉴权与路由边界', category: RISK_CATEGORY.AUTH_ISOLATION },
  { prefix: 'src/lib/auth/', why: '鉴权与客户访问边界', category: RISK_CATEGORY.AUTH_ISOLATION },
  { prefix: 'src/app/api/auth/', why: '鉴权端点', category: RISK_CATEGORY.AUTH_ISOLATION },
  { prefix: 'src/app/api/webhooks/', why: '外部入站 webhook —— 签名校验即安全边界', category: RISK_CATEGORY.AUTH_ISOLATION },
  { basenameWord: 'rls', why: 'RLS 行级隔离策略', category: RISK_CATEGORY.AUTH_ISOLATION },
  { basenameIncludes: 'isolation', why: '客户 / 租户隔离判定', category: RISK_CATEGORY.AUTH_ISOLATION },

  // --- Execution kernel: authorization, approval, idempotency, state ------
  { prefix: 'src/lib/kernel/', why: 'Kernel —— 执行授权、审批、幂等、状态机', category: RISK_CATEGORY.KERNEL_EXECUTION },
  { prefix: 'src/app/api/kernel/', why: 'Kernel 端点', category: RISK_CATEGORY.KERNEL_EXECUTION },
  { prefix: 'src/lib/execution/', why: '自动执行策略与背书 —— 决定系统自己会做什么', category: RISK_CATEGORY.KERNEL_EXECUTION },
  { prefix: 'tools/local-executor-bridge/', why: '签名本地执行器 —— 决定本机能被远程叫去执行什么', category: RISK_CATEGORY.KERNEL_EXECUTION },

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
  // --- Music vocal gate: the registry IS the gate; a hand-written signature would otherwise pass as B ---
  { pattern: /^scripts\/factory-worker\/.*music[-_]?vocal[^/]*$/i, why: '音乐人声闸：登记表 music-vocals.json、闸模块、回填工具及其测试 —— 登记表就是闸本身，签字格式可被手写伪造，只能靠人审', category: RISK_CATEGORY.OUTWARD_WRITE },
  { exact: 'scripts/factory-worker/remotion-branch.mjs', why: '出片机 Remotion 分支：人声闸接线点，删掉接线 = 含人声音乐直接出片', category: RISK_CATEGORY.OUTWARD_WRITE },
  { exact: 'scripts/factory-worker/worker.mjs', why: '出片机主程序：旧版/recipe 路径的人声闸接线点', category: RISK_CATEGORY.OUTWARD_WRITE },
  { exact: 'scripts/factory-worker/creative-recipe.mjs', why: '出片机 recipe 路径：BGM 解析，人声闸依赖它选出的文件', category: RISK_CATEGORY.OUTWARD_WRITE },
  { exact: 'scripts/factory-worker/remotion-branch.test.mjs', why: '出片机 Remotion 分支测试：删掉「没有人声闸就拒绝出片」的断言 = 闸静默失效', category: RISK_CATEGORY.OUTWARD_WRITE },
  { exact: 'scripts/factory-worker/worker.recipe-sequence.test.mjs', why: '出片机 recipe 分支测试：含「未注入人声闸就拒绝出片」的断言', category: RISK_CATEGORY.OUTWARD_WRITE },
  { basenameIncludes: 'ssrf', why: 'SSRF 出网边界', category: RISK_CATEGORY.NETWORK_BOUNDARY },

  // --- Credentials --------------------------------------------------------
  { suffix: '.env', why: '凭证文件', category: RISK_CATEGORY.CREDENTIALS },
  // 🔴 Replaces `includes: '/.env.'`, which needed a leading slash and so let
  // root `.env.production` / `.env.local` rate B. Any path segment starting
  // with `.env`, at any depth. The single exemption is the committed root
  // template `.env.example`, which rated B before this rule and still does;
  // nested `*/.env.example` stays A exactly as it was — nothing drops a level.
  { pattern: /^(?!\.env\.example$)(.*\/)?\.env/i, why: '凭证文件（.env 及各种后缀变体；只放过根目录模板 .env.example）', category: RISK_CATEGORY.CREDENTIALS },
  { basename: '.gitignore', why: '忽略清单 —— 删一行就能把 .env.local 这类密钥文件放进仓库', category: RISK_CATEGORY.CREDENTIALS },
  { basename: '.dockerignore', why: '镜像忽略清单 —— 删一行就能把 .env 打进容器镜像', category: RISK_CATEGORY.CREDENTIALS },
  // `cred` rather than `credential`: this repo names them `creds-loader.ts`.
  // It also catches `credit-*`, which is money and belongs at A anyway.
  { basenameIncludes: 'cred', why: '凭证装载 / 额度', category: RISK_CATEGORY.CREDENTIALS },

  // --- Supply chain (CLAUDE.md §4 counts a new dependency as a big task) ---
  // Any directory: `scripts/factory-worker/` installs its own dependencies too.
  { basename: 'package.json', why: '依赖清单 —— 引入新依赖即供应链面', category: RISK_CATEGORY.SUPPLY_CHAIN },
  { basename: 'package-lock.json', why: '依赖锁 —— 引入新依赖即供应链面', category: RISK_CATEGORY.SUPPLY_CHAIN },
  { pattern: /(^|\/)(npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/, why: '其他依赖锁 —— 引入新依赖即供应链面', category: RISK_CATEGORY.SUPPLY_CHAIN },
  { basename: '.npmrc', why: 'npm 安装配置 —— 能换依赖下载源、能放凭证', category: RISK_CATEGORY.SUPPLY_CHAIN },
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
 * @param {{exact?: string, prefix?: string, suffix?: string, includes?: string, basenameIncludes?: string, basenameWord?: string, basename?: string, pattern?: RegExp}} rule
 * @param {string} path
 * @param {boolean} [caseInsensitive] — when true, string comparisons use
 *   lowercased values and pattern rules gain the `i` flag. Used for A rules
 *   only, so a case-variant path like `claude.md` cannot evade `CLAUDE.md` on
 *   a macOS checkout where `core.ignorecase=true`.
 */
function ruleMatches(rule, path, caseInsensitive = false) {
  const p = caseInsensitive ? path.toLowerCase() : path
  const basename = p.slice(p.lastIndexOf('/') + 1)
  if (rule.exact !== undefined) {
    return caseInsensitive ? p === rule.exact.toLowerCase() : p === rule.exact
  }
  if (rule.prefix !== undefined) {
    return caseInsensitive ? p.startsWith(rule.prefix.toLowerCase()) : p.startsWith(rule.prefix)
  }
  if (rule.suffix !== undefined) {
    return caseInsensitive ? p.endsWith(rule.suffix.toLowerCase()) : p.endsWith(rule.suffix)
  }
  if (rule.includes !== undefined) {
    return caseInsensitive ? p.includes(rule.includes.toLowerCase()) : p.includes(rule.includes)
  }
  if (rule.basenameIncludes !== undefined) return basename.toLowerCase().includes(rule.basenameIncludes)
  if (rule.basename !== undefined) {
    return caseInsensitive ? basename === rule.basename.toLowerCase() : basename === rule.basename
  }
  if (rule.pattern !== undefined) {
    if (caseInsensitive && !rule.pattern.flags.includes('i')) {
      return new RegExp(rule.pattern.source, rule.pattern.flags + 'i').test(path)
    }
    return rule.pattern.test(path)
  }
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
  const aRule = A_RISK_RULES.find((rule) => ruleMatches(rule, path, true))
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
 * Labels that introduce a declared level.
 *
 * `STRONG` is this repo's own convention: a line that opens with one of them
 * is a declaration, so a value that cannot be read means "declared,
 * unreadable" → A, not silence. `WEAK` labels (风险分级, 风险, risk) are
 * common in prose, so they count only when an upper-case A/B/C standing on
 * its own follows them — otherwise they are ignored (子牙 #2121 round 1).
 */
const STRONG_LABEL = '风险级别|风险等级|风险级|[Rr][Ii][Ss][Kk]\\s*[Ll][Ee][Vv][Ee][Ll]'
const WEAK_LABEL = '风险分级|风险|[Rr][Ii][Ss][Kk]'

/**
 * Anything an author puts between label and level: 为 / 是 / is / = / - / → /
 * brackets / colons / pipes / spaces, in any combination (W121-1). A single
 * starred group whose branches cannot overlap — never `\s*…?\s*`, which
 * backtracks quadratically on long runs of blanks (DR121-3).
 */
const JOIN = '(?:[\\s:：|=为是\\-→（(]|is(?=\\s))*'

/**
 * An upper-case level letter, optional 级, then anything but a letter, digit
 * or `/` (DR121-2: "A/B/C" is a list; `A、` and `A）` are levels). Upper case
 * only (DR121-5): "Risk: a stale cache" is prose. A strong label followed by a
 * lower-case letter is still caught — as unreadable, which also rates A.
 */
const LEVEL = '([ABC])(?:\\s?级)?(?![A-Za-z0-9/])'

/** Label → join → level anywhere in a line; `[^A-Za-z]` keeps `asterisk` from reading as `risk`. */
const STRONG_INLINE_RE = new RegExp(`(?:^|[^A-Za-z])(?:${STRONG_LABEL})${JOIN}${LEVEL}`, 'g')
const WEAK_INLINE_RE = new RegExp(`(?:^|[^A-Za-z])(?:${WEAK_LABEL})${JOIN}${LEVEL}`, 'g')

/** Non-global twins for `.test()` — a `g` regex remembers `lastIndex` between calls. */
const LABELLED_LEVEL_RES = [new RegExp(STRONG_INLINE_RE.source), new RegExp(WEAK_INLINE_RE.source)]

/** A line that opens with a strong label: what joins it to the rest, and the rest. */
const STRONG_LINE_RE = new RegExp(`^(?:${STRONG_LABEL})(${JOIN})(.*)$`)

/** A line that opens with a level — the line under a `## 风险级` heading. */
const LEVEL_LINE_RE = new RegExp(`^${JOIN}${LEVEL}`)

/**
 * Strip the markdown that authors wrap declarations in: bold, code, heading
 * marks, list bullets, quote marks and table pipes. `**风险级：A**`,
 * `风险级：**A**` and `## 风险级别：A` all reduce to `风险级…：A`. The tail is
 * trimmed by hand: `/[\s|]+$/` rescans every run of blanks (DR121-3).
 *
 * @param {string} line
 */
function plainLine(line) {
  const text = line.replace(/\*\*|__|`/g, '').replace(/^[\s>#*+|-]+/, '')
  let end = text.length
  while (end > 0 && /[\s|]/.test(text[end - 1])) end--
  return text.slice(0, end)
}

/**
 * Read the level the PR author declared. Accepted only as a floor — see
 * `classifyRisk`.
 *
 * 🔴 Incident 2026-09-26 (#2061, #2075): the old parser read only
 * `风险级别|风险等级|risk level` + colon + letter. #2075 wrote `## 风险级` with
 * `**A 级**` on the next line, #2061 wrote `风险级：A`; both declared A, neither
 * was read, both rated B from their files and auto-merged with no review.
 * Round 1 of review found more (`风险级别为 A`, `风险分级：A 级`, `风险 **A 级**`,
 * `## 风险级别（自报）` then A). So the rule is general rather than a list of
 * spellings: a label, any joining characters, a level. A strong-label line
 * that joins to something unreadable — or a strong-label heading whose next
 * line is not a level — is "declared, unreadable" → A, so the next
 * unforeseen spelling fails closed instead of repeating the incident.
 *
 * Several distinct levels still resolve to A. "非 A 级", "不是 A 级",
 * "A/B/C 分级说明", "风险分级：见下表" and "Risk: a stale cache" are not
 * declarations.
 *
 * @param {string|null|undefined} body
 * @returns {{risk: 'A'|'B'|'C'|null, unreadable: string|null}} `unreadable` quotes the line that could not be read
 */
export function readDeclaredRisk(body) {
  if (typeof body !== 'string') return { risk: null, unreadable: null }
  const raw = body.replace(/<!--[\s\S]*?(-->|$)/g, '').replace(/\r\n/g, '\n').split('\n')
  const lines = raw.map(plainLine)
  const found = new Set()
  let unreadable = null
  lines.forEach((line, i) => {
    for (const m of line.matchAll(STRONG_INLINE_RE)) found.add(m[1])
    for (const m of line.matchAll(WEAK_INLINE_RE)) found.add(m[1])
    const next = () => lines.slice(i + 1).find((l) => l.trim() !== '')
    const level = strongLineLevel(line, /^\s*#/.test(raw[i]), next)
    if (level === 'unreadable') unreadable ??= line.slice(0, 60)
    else if (level) found.add(level)
  })
  if (unreadable !== null) return { risk: 'A', unreadable }
  if (found.size === 0) return { risk: null, unreadable: null }
  if (found.size > 1) return { risk: 'A', unreadable: null }
  return { risk: /** @type {'A'|'B'|'C'} */ ([...found][0]), unreadable: null }
}

/**
 * What a line that opens with a strong label declares: a level, `'unreadable'`,
 * or `null` when it is prose that merely mentions the label.
 *
 * @param {string} line markdown already stripped
 * @param {boolean} heading the raw line was a `#` heading
 * @param {() => string|undefined} next the next non-empty line (only looked up when needed)
 * @returns {'A'|'B'|'C'|'unreadable'|null}
 */
function strongLineLevel(line, heading, next) {
  const strong = line.match(STRONG_LINE_RE)
  if (!strong) return null
  const [, join, rest] = strong
  if (LEVEL_LINE_RE.test(`${join}${rest}`)) return null // already read inline
  // A heading with any tail ("## 风险级别（自报）", "## 风险级说明") or a bare
  // label: the level is on the next non-empty line.
  if (heading || rest.trim() === '') {
    const following = next()
    const level = following?.match(LEVEL_LINE_RE)
    if (level) return /** @type {'A'|'B'|'C'} */ (level[1])
    // "## 风险级别 / 优先级" then "- 风险：**B**（…）" (#2032 / #2033 / #2043): the
    // next line declares with its own label, and is read as its own line.
    if (following !== undefined && LABELLED_LEVEL_RES.some((re) => re.test(following))) return null
    return 'unreadable'
  }
  // "风险级别：见下表" joins the label to something that is not a level;
  // "风险级别只作下限" does not join at all — that is prose.
  return join.trim() === '' ? null : 'unreadable'
}

/**
 * The declared level only. Kept for callers that do not report *why*.
 *
 * @param {string|null|undefined} body
 * @returns {'A'|'B'|'C'|null}
 */
export function parseDeclaredRisk(body) {
  return readDeclaredRisk(body).risk
}

/** Cap on how many reasons are carried into the marker, so it stays readable. */
export const MAX_REASONS = 12

/**
 * Rate a whole PR.
 *
 * @param {{files?: unknown, declaredRisk?: string|null, declaredUnreadable?: string|null}} input
 * @returns {{risk: 'A'|'B'|'C', computedRisk: 'A'|'B'|'C', declaredRisk: string|null, readable: boolean, reasons: string[], categories: string[]}}
 */
export function classifyRisk({ files, declaredRisk = null, declaredUnreadable = null } = {}) {
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
    reasons.unshift(
      typeof declaredUnreadable === 'string'
        ? `PR 正文写了风险级但读不懂（\`${declaredUnreadable.replace(/`/g, '')}\`）—— 按 A 处理；本意是 B/C 就写 \`风险级别：B\`（或 C），改完会自动重判`
        : `PR 自报 ${declared} 级，高于 diff 算出的 ${computed} 级 —— 取更高的一档`,
    )
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
