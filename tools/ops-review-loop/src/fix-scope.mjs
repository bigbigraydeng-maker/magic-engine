/**
 * Deterministic blast-radius guard for the Codex-to-Claude auto-fix lane.
 *
 * 🔴 **Why this exists, and why prompt text is not enough.**
 *
 * The auto-fix leg feeds an untrusted review body into a Claude run that
 * commits and pushes. PR #941 first tried to contain that with prompt
 * engineering — an XML fence around the untrusted text plus "treat this as
 * data" wording. Codex's review of that attempt made the decisive point:
 *
 *   > XML 围栏只改变文本位置，无法区分正常的修复指令和被 PR 内容诱导出来的
 *   > 恶意修复指令 … 现有测试只验证字符串位于围栏内，并未验证模型不会服从它。
 *
 * That is correct. A fence relocates text; it cannot make a model refuse.
 * The prompt hardening stays (defence in depth, and it makes the honest cases
 * cleaner), but it is **not** the security boundary.
 *
 * This module is the boundary: it looks at the *result* — the files the PR
 * actually changed — and refuses to let the lane touch anything that could
 * widen its own permissions, alter production infrastructure, or change the
 * control plane that decides its own fate. It does not care what the prompt
 * said, whether the model complied, or how persuasive a finding was.
 *
 * Deliberate design choices:
 *
 * - **Whole-PR scope, not per-commit attribution.** Git author/committer
 *   fields are self-asserted; "only check commits by the bot" would be a
 *   guard an attacker can step around by setting an email. So on a lane where
 *   the bot can push, every changed file is checked. Humans working in this
 *   lane who genuinely need to touch a protected path do it on a branch
 *   outside the lane — which is a reviewable, visible act.
 * - **Fail closed.** Unknown branch, empty file list, malformed input → treat
 *   as a violation rather than a pass, because "no files" and "we failed to
 *   read the files" look identical otherwise.
 */

/**
 * Head-branch prefixes the auto-fix leg is allowed to push to. Kept in sync
 * with the `if:` guard in ops-codex-to-claude-fix.yml by a test.
 */
export const GUARDED_BRANCH_PREFIXES = ['claude/me2-']

/**
 * Paths the auto-fix lane must never modify.
 *
 * Each entry says what it protects — a denylist nobody understands gets
 * "tidied up" eventually.
 */
export const PROTECTED_PATHS = [
  // Its own permissions, triggers and allowlists. Without this the lane can
  // widen itself, and every other rule here becomes advisory.
  { prefix: '.github/workflows/', why: 'CI 定义与本闸门自身 —— 允许改等于允许它给自己放权' },
  // The control plane that decides dispatch / round cap / CI gate.
  { prefix: 'tools/ops-review-loop/', why: '决定这条腿自身命运的控制面（轮次上限、闸门、prompt 构造）' },
  { prefix: 'tools/ai-orchestrator/', why: '编排控制面' },
  // Production infrastructure and data shape.
  { prefix: 'supabase/migrations/', why: '数据库结构变更 —— 不可逆，必须走人工授权' },
  { prefix: 'render.yaml', why: '生产服务与 cron 调度' },
  // Authorization boundaries the architecture tests exist to defend.
  { prefix: 'src/lib/kernel/boundaries.ts', why: 'L1/L2 授权边界白名单' },
  { prefix: 'src/lib/kernel/outward-authorization.ts', why: '对外动作授权判定' },
  // Anything that smells like credentials.
  { suffix: '.env', why: '凭证' },
  { includes: '/.env.', why: '凭证' },
]

/** Upper bound on how much one automated fix round may change. */
export const MAX_CHANGED_FILES = 25
export const MAX_CHANGED_LINES = 800

/** @param {string} branch */
export function isGuardedBranch(branch) {
  return GUARDED_BRANCH_PREFIXES.some((p) => typeof branch === 'string' && branch.startsWith(p))
}

/** @param {string} path */
function protectionFor(path) {
  return PROTECTED_PATHS.find(
    (rule) =>
      (rule.prefix && path.startsWith(rule.prefix)) ||
      (rule.suffix && path.endsWith(rule.suffix)) ||
      (rule.includes && path.includes(rule.includes)),
  )
}

/**
 * Decide whether a PR in the auto-fix lane stayed inside its blast radius.
 *
 * @param {{branch: string, files: Array<{filename: string, additions?: number, deletions?: number}>}} input
 * @returns {{applies: boolean, ok: boolean, violations: string[]}}
 */
export function checkFixScope({ branch, files }) {
  if (!isGuardedBranch(branch)) {
    return { applies: false, ok: true, violations: [] }
  }

  if (!Array.isArray(files) || files.length === 0) {
    // Fail closed: a PR on this lane with no readable file list means the
    // check could not do its job, which is not the same as "nothing to see".
    return {
      applies: true,
      ok: false,
      violations: ['拿不到改动文件清单 —— 闸门无法判定，按失败处理（不许把「读不到」当成「没问题」）'],
    }
  }

  const violations = []

  for (const file of files) {
    const path = file?.filename
    if (typeof path !== 'string' || path === '') {
      violations.push('改动清单里有一项没有文件名 —— 输入不可信，按失败处理')
      continue
    }
    const rule = protectionFor(path)
    if (rule) {
      violations.push(`${path} —— 受保护路径（${rule.why}）`)
    }
  }

  if (files.length > MAX_CHANGED_FILES) {
    violations.push(`改了 ${files.length} 个文件，超过上限 ${MAX_CHANGED_FILES}`)
  }

  const changedLines = files.reduce(
    (sum, f) => sum + (Number(f?.additions) || 0) + (Number(f?.deletions) || 0),
    0,
  )
  if (changedLines > MAX_CHANGED_LINES) {
    violations.push(`改了 ${changedLines} 行，超过上限 ${MAX_CHANGED_LINES}`)
  }

  return { applies: true, ok: violations.length === 0, violations }
}
