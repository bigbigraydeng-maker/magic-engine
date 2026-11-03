/**
 * Capability · `page.apply_optimization_request`
 *
 * 把已经通过 Snapshot → Draft → Diff → Validation → Human Approval 的一份
 * `PageOptimizationRequest` 提交到 GitHub（v1 = **Draft PR**，不合并、不 auto-merge）。
 *
 * spec: docs/specs/2026-08-19-me2-page-optimization-apply-action-v1.0.md
 *
 * 🔴 verification = execution-integrity only（§8）。**PR 创建成功 ≠ Growth success。**
 *    Growth 层的 matched remeasurement 走下游 GEO Measurement 链，跟本 capability 无关。
 *
 * 🔴 capability **不信任 input 里的任何 hash** —— `prepare` step 强制拿真实 approved
 *    snapshot 自己再算一遍（§4.1 / PM Change 6）。
 *
 * 🔴 本文件是 kernel/capabilities 边界之内唯一 import provider write module 的位置；
 *    `boundaries.ts` 的 PROVIDER_WRITE_ALLOWED_DIRS 自动覆盖新目录。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  CapabilityImplementation,
  CapabilityStepContext,
  CapabilityStepResult,
  OutwardRollbackResult,
  VerificationResult,
} from '@/lib/kernel/types'
import { KernelError, RetryableCapabilityError } from '@/lib/kernel/errors'
import { GitHubApiError } from '@/lib/cms/github-client'
import type {
  GithubPageSnapshot,
  PageDiffResult,
  PageDraftResult,
  PageOptimizationField,
  PageOptimizationIntent,
} from '@/lib/page-optimization'
import {
  PAGE_OPTIMIZATION_FIELDS,
  draftPageChange,
  diffPageChange,
  extractGithubFieldValue,
} from '@/lib/page-optimization'
import { resolveStaticHtmlPath, patchStaticHtmlPage } from '@/lib/cms/static-html-page-upgrade'
import { identityFromUrl, mergeIdentities, ProtectedPageError } from '@/lib/seo/protected-pages'
import type { PageApplyOptimizationDeps } from './deps'
import { defaultDeps } from './deps'
import { branchNameForRun, canonicalDiffHash, idempotencyKeyFromInput } from './hash'

// ── Input shape (populated from ctx.runInput —— deep-frozen by Gateway hash-check) ──
//
// 🔴 **不许**从 `action_runs.input` 回读。#1108 Kernel Outward Hardening 把
//    执行输入沉进 `CapabilityStepContext.runInput`，Gateway 已按授权时的 hash
//    校验过一次并深冻结。capability 再走 supabase 读 `input` 就是 TOCTOU 漏洞
//    （Gateway 通过后 attacker UPDATE input → capability 读到污染值）。
//    见 `docs/specs/2026-08-19-me2-kernel-outward-execution-hardening-v1.0.md`
//    与 `src/lib/kernel/types.ts::CapabilityStepContext.runInput`。
//
//    本文件内**唯一**允许从 `ctx.runInput` 构造 RunInput 的路径 = `parseRunInput()`。
//    architecture-guard.test.ts 会静态扫本目录，禁止再次出现 `select('input')`。

interface RunInput {
  readonly page_url: string
  readonly page_version_token: string
  readonly validated_diff_hash: string
  readonly intents: readonly PageOptimizationIntent[]
  readonly do_not_touch: readonly PageOptimizationField[]
}

// ── Prior-step outputs (schema stays internal — kernel just passes them along) ──

interface PrepareOutput {
  readonly page_url: string
  readonly repo_owner: string
  readonly repo_name: string
  readonly default_branch: string
  readonly content_path: string
  readonly page_version_token: string
  readonly branch_name: string
  readonly patched_content: string
  readonly diff_changes: readonly {
    field: PageOptimizationField
    before: string
    after: string
    changed: boolean
  }[]
}

interface CommitOutput {
  readonly commit_created: true
}

interface OpenPrOutput {
  readonly pr_number: number
  readonly pr_url: string
}

// ── Run receipt markers（写进 commit message / PR body，用于**所有权证明**） ──
//
// 🔴 branch 名按 input 派生是**必要非充分**的所有权证明 —— 客户仓库里恰好有个
//    同前缀分支就会被 422 幂等接管；同 head 上别人开个 PR 就会被 open_pr 422
//    fallback 采用。真正的所有权凭据 = 我们在 commit message 与 PR body 里写的
//    run receipt marker（`[kernel run <runId>]` + PR body 里的 `kernel_run_id` +
//    `authorization_decision_id`）。任何 close / delete 前必须先证明目标 artefact
//    带着我们的 marker，否则一律 fail-closed。

function commitMessageOwnedByRun(message: string, runId: string): boolean {
  // 🔴 blocker 5: marker 是 `[kernel run <runId>]` —— 结尾的 `]` 是天然边界，
  //    子字符串攻击 e.g. `[kernel run ${runId}extra]` 不会命中，因为 `<runId>]`
  //    要求 runId 后紧跟 `]` 而不是 `extra`。
  return message.includes(`[kernel run ${runId}]`)
}

function prBodyOwnedByRun(body: string, runId: string, decisionId: string): boolean {
  // 🔴 blocker 5: 必须**按独立完整行精确匹配**，禁 substring includes ——
  //    否则 `- kernel_run_id: ${runId}extra` 会被 `.includes(...)` 命中。
  //    按 \r\n / \n 双分隔 + trim `\r`，保证 CRLF/LF 兼容都做整行比较。
  const runIdLine = `- kernel_run_id: ${runId}`
  const decisionIdLine = `- authorization_decision_id: ${decisionId}`
  const lines = body.split(/\r?\n/).map((l) => l.replace(/\r$/, ''))
  return lines.includes(runIdLine) && lines.includes(decisionIdLine)
}

// ── Loading helpers (server-side only, ctx-scoped) ────────────────────────────

/**
 * 🔴 从**已由 Gateway hash-check + 深度冻结**的 `ctx.runInput` 构造 RunInput。
 *
 *   纯函数、不查 DB —— 唯一入口，见上方 architecture-guard 说明。
 *   缺字段或类型不对 → `INVALID_INPUT` fail-closed（不许 RetryableCapabilityError
 *   —— Gateway 已经验过 hash，这里的缺字段是**代码 bug 或 schema 漂移**，重试
 *   永远不会好起来）。
 */
function parseRunInput(runInput: Readonly<Record<string, unknown>>): RunInput {
  const pageUrl = runInput.page_url
  const versionToken = runInput.page_version_token
  const diffHash = runInput.validated_diff_hash
  const intents = runInput.intents
  const doNotTouch = runInput.do_not_touch
  if (
    typeof pageUrl !== 'string' ||
    typeof versionToken !== 'string' ||
    typeof diffHash !== 'string' ||
    !Array.isArray(intents) ||
    !Array.isArray(doNotTouch)
  ) {
    throw new KernelError('INVALID_INPUT', '执行输入缺字段或类型不对（ctx.runInput）')
  }
  return {
    page_url: pageUrl,
    page_version_token: versionToken,
    validated_diff_hash: diffHash,
    intents: intents as readonly PageOptimizationIntent[],
    do_not_touch: doNotTouch as readonly PageOptimizationField[],
  }
}

async function loadDecisionExists(sb: SupabaseClient, decisionId: string): Promise<boolean> {
  const { data, error } = await sb
    .from('authorization_decisions')
    .select('id')
    .eq('id', decisionId)
    .limit(1)
  if (error) throw new RetryableCapabilityError(`回读授权决策失败：${error.message}`)
  return ((data ?? []) as unknown as Array<{ id: string }>).length === 1
}

// ── Protected-page gate ───────────────────────────────────────────────────────

/** Throws KernelError('INVALID_INPUT') when the page is protected / unknown — this capability has no override. */
async function assertPageWritable(
  deps: PageApplyOptimizationDeps,
  clientId: string,
  pageUrl: string,
  filePath: string | null,
): Promise<void> {
  const identity = mergeIdentities(
    identityFromUrl(pageUrl),
    ...(filePath ? [identityFromUrl(filePath, 'file')] : []),
  )
  try {
    await deps.createPageGuard(clientId).assert(identity, { targetType: 'static_html_page' })
  } catch (err) {
    if (err instanceof ProtectedPageError) {
      throw new KernelError('INVALID_INPUT', `protected_page：该页在保护名单内（或名单无法核实），自动流程不得改动（${err.decision}）`)
    }
    throw err
  }
}

// ── Step: prepare ─────────────────────────────────────────────────────────────

async function stepPrepare(
  deps: PageApplyOptimizationDeps,
  args: { runId: string; clientId: string; input: RunInput },
): Promise<CapabilityStepResult> {
  const input = args.input

  const conn = await deps.resolveGithubConnection(args.clientId)
  if (!conn) {
    throw new KernelError(
      'INVALID_INPUT',
      '这个客户没有已连接的 GitHub CMS —— 先在 Settings 里连上',
    )
  }

  const pathResult = resolveStaticHtmlPath(input.page_url, [...conn.contentPaths])
  // Protected-page gate FIRST (also before reporting a path failure): the SYSTEM actor can never override.
  await assertPageWritable(deps, args.clientId, input.page_url, pathResult.ok ? pathResult.filePath : null)
  if (!pathResult.ok) {
    throw new KernelError('INVALID_INPUT', `解析目标文件路径失败：${pathResult.reason}`)
  }

  const gh = deps.createGithubClient(conn.plainToken)
  const file = await gh.getFileContent(conn.repoOwner, conn.repoName, pathResult.filePath, conn.defaultBranch)

  // 🔴 §4.1 step 1：page_version_token 严格相等，不等即 stale_snapshot。
  if (file.sha !== input.page_version_token) {
    throw new KernelError(
      'INVALID_INPUT',
      'stale_snapshot：授权时刻的 blob SHA 跟现在读到的不一致，世界变了；请重跑 pipeline',
      {
        detail: {
          expected_page_version_token: input.page_version_token,
          actual_blob_sha: file.sha,
        },
      },
    )
  }

  // 🔴 §4.1 step 2：用现有 shared runtime 重跑 draft/diff/validate。
  const snapshot: GithubPageSnapshot = {
    ok: true,
    provider: 'github',
    fetchedAt: new Date().toISOString(),
    rawContent: file.decodedContent,
    versionToken: file.sha,
  }
  const draft: PageDraftResult = draftPageChange(snapshot, input.intents)
  if (!draft.ok) throw new KernelError('INVALID_INPUT', `draft 失败：${draft.reason}`)

  const diff: PageDiffResult = diffPageChange(snapshot, draft)
  if (!diff.ok) throw new KernelError('INVALID_INPUT', `diff 失败：${diff.reason}`)

  // 🔴 §4.1 step 4：doNotTouch 与 diff 无交集。**先于其它 assertion 检查**，
  //    让"违反 doNotTouch"这条最具体的错误明确落回 do_not_touch_violation，
  //    而不是被后面 validatePageChange 内部的 doNotTouch 检查吞成 pipeline_regression。
  const changedFields = new Set(diff.changes.filter((c) => c.changed).map((c) => c.field))
  const forbidden = input.do_not_touch.filter((f) => changedFields.has(f))
  if (forbidden.length > 0) {
    throw new KernelError(
      'INVALID_INPUT',
      `do_not_touch_violation：字段 [${forbidden.join(',')}] 在 doNotTouch 名单内但被 diff 改动`,
    )
  }

  // 🔴 §4.1 step 3：capability 自己重算 hash，跟 caller 传的严格相等。
  const recomputed = canonicalDiffHash(diff.changes)
  if (recomputed !== input.validated_diff_hash) {
    throw new KernelError(
      'INVALID_INPUT',
      'pipeline_regression：capability 重算 diff hash 跟 caller 传的对不上',
      { detail: { expected: input.validated_diff_hash, actual: recomputed } },
    )
  }

  // 生成 patched content 交给 commit step。
  const byField = new Map(input.intents.map((i) => [i.field, i.proposedValue]))
  const metaTitle =
    byField.get('meta_title') ?? extractGithubFieldValue(file.decodedContent, 'meta_title')
  const metaDescription =
    byField.get('meta_description') ??
    extractGithubFieldValue(file.decodedContent, 'meta_description')
  if (metaTitle === null || metaDescription === null) {
    throw new KernelError('INVALID_INPUT', '目标页面无 <title> 或 meta description，起草失败')
  }
  const patch = patchStaticHtmlPage(file.decodedContent, {
    metaTitle,
    metaDescription,
    ...(byField.has('content_html') ? { htmlBody: byField.get('content_html')! } : {}),
  })
  if (!patch.ok) {
    throw new KernelError('INVALID_INPUT', `patchStaticHtmlPage 失败：${patch.reason}`)
  }

  const idKey = idempotencyKeyFromInput(input.page_url, input.page_version_token, input.validated_diff_hash)
  const output: PrepareOutput = {
    page_url: input.page_url,
    repo_owner: conn.repoOwner,
    repo_name: conn.repoName,
    default_branch: conn.defaultBranch,
    content_path: pathResult.filePath,
    page_version_token: input.page_version_token,
    branch_name: branchNameForRun(idKey),
    patched_content: patch.content,
    diff_changes: diff.changes.map((c) => ({
      field: c.field,
      before: c.before,
      after: c.after,
      changed: c.changed,
    })),
  }
  return { costActualUsd: 0, output: output as unknown as Record<string, unknown> }
}

// ── Step: commit ──────────────────────────────────────────────────────────────

async function stepCommit(
  sb: SupabaseClient,
  deps: PageApplyOptimizationDeps,
  args: { runId: string; clientId: string; priorOutputs: Readonly<Record<string, Record<string, unknown>>> },
): Promise<CapabilityStepResult> {
  const prep = args.priorOutputs.prepare as unknown as PrepareOutput | undefined
  if (!prep) throw new KernelError('INVALID_STATE', 'prepare 产物不见了')

  const conn = await deps.resolveGithubConnection(args.clientId)
  if (!conn) throw new KernelError('INVALID_INPUT', '客户 GitHub 连接消失')

  // Re-check right before the first write: the list may have changed since prepare ran.
  await assertPageWritable(deps, args.clientId, prep.page_url, prep.content_path)

  const gh = deps.createGithubClient(conn.plainToken)

  // 分支若已存在则跳过创建（provider-native 幂等：重跑同一 idempotency-key 命同分支）。
  let baseSha: string
  try {
    baseSha = await gh.getBranchSha(prep.repo_owner, prep.repo_name, prep.default_branch)
  } catch (e) {
    throw new RetryableCapabilityError(
      `读取 base 分支 SHA 失败：${e instanceof Error ? e.message : String(e)}`,
    )
  }
  // 🔴 blocker 3：createBranch + identity marker commit 必须**原子**——
  //    这样 branch 一旦被观察到，tip commit message 一定含 `[kernel run <runId>]`。
  //    再也不能靠 `tip === baseSha` 单独证明所有权（即便匹配也可能是第三方巧合
  //    从 main 建了同名空分支）。
  const IDENTITY_MARKER_MSG = `chore(page): identity marker [kernel run ${args.runId}]`
  try {
    await gh.createBranchWithMarker(
      prep.repo_owner, prep.repo_name, prep.branch_name, baseSha, IDENTITY_MARKER_MSG,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!/422|already exists|Reference already exists/i.test(msg)) {
      throw new RetryableCapabilityError(`createBranchWithMarker 失败：${msg}`)
    }

    // existing-ref 422 recovery：唯一合法路径 = tip commit message 含本 run marker
    //（identity marker commit **或** 后续 content commit 里带的同 marker）。
    // 读 tip SHA 或 tip commit message 任一失败 → fail-closed。
    let existingTipSha = ''
    try {
      existingTipSha = await gh.getBranchSha(prep.repo_owner, prep.repo_name, prep.branch_name)
    } catch (readErr) {
      throw new KernelError(
        'INVALID_STATE',
        `existing_branch_ownership_indeterminate：createBranchWithMarker 422 但回读 tip SHA 失败：${readErr instanceof Error ? readErr.message : String(readErr)}`,
        { detail: { reason: 'existing_branch_ownership_indeterminate', createBranchError: msg } },
      )
    }
    let tipMessage: string
    try {
      const tip = await gh.getCommit(prep.repo_owner, prep.repo_name, existingTipSha)
      tipMessage = tip.message
    } catch (commitErr) {
      throw new KernelError(
        'INVALID_STATE',
        `existing_branch_ownership_indeterminate：读 tip commit 失败：${commitErr instanceof Error ? commitErr.message : String(commitErr)}`,
        { detail: { reason: 'existing_branch_ownership_indeterminate', branchTipSha: existingTipSha } },
      )
    }
    if (!commitMessageOwnedByRun(tipMessage, args.runId)) {
      throw new KernelError(
        'INVALID_STATE',
        `existing_branch_not_owned_by_run：branch ${prep.branch_name} 存在但 tip commit message 无本 run marker`,
        { detail: { reason: 'existing_branch_not_owned_by_run', branchTipSha: existingTipSha } },
      )
    }
    // tip 带本 run marker → 是我们的 branch（identity marker 或已 commit 的 content）
  }

  // commitFile 用旧 blob SHA 作乐观并发令牌。有两条正常路径需要区分：
  //   (a) main 从 prepare 到 commit 之间被别人推动了：blob 不再是 page_version_token，
  //       GitHub 会 409/422 —— 这是**真 stale**，必须 fail-closed，不能被吞成"成功"。
  //   (b) 本 run 的 commit step 之前已经成功过一次，现在是重试：branch 上的 blob
  //       已经是我们的 patched 内容，用 page_version_token 再 commit 也会 409/422 ——
  //       这是**真幂等**，应当当成 commit_created:true。
  //
  // 靠错误消息里有没有 "sha" 或 "conflict" 无法区分两者。唯一可靠的判据是**回读
  // branch 上现在的文件内容**：等于 patched_content 就是 (b) 幂等；否则就是 (a) 真冲突。
  try {
    await gh.commitFile(
      prep.repo_owner,
      prep.repo_name,
      prep.content_path,
      prep.branch_name,
      prep.patched_content,
      `chore(page): apply optimization ${prep.content_path} [kernel run ${args.runId}]`,
      prep.page_version_token,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // 回读 branch 上现在的内容，判断是 (b) 幂等还是 (a) 真冲突
    let branchContent: string | null = null
    try {
      const now = await gh.getFileContent(
        prep.repo_owner, prep.repo_name, prep.content_path, prep.branch_name,
      )
      branchContent = now.decodedContent
    } catch {
      // 回读也失败 → 无法证明是幂等，保守走真冲突路径
    }
    if (branchContent === prep.patched_content) {
      // (b) 幂等：前一次尝试已 commit 成功，本次是 retry，接受为成功
    } else {
      // (a) 真 stale：main 在 prepare 到 commit 之间移动过，OCC 拒绝。
      // branch 已经在上一步被创建（或以 idempotent 422 命中同名分支），是**孤儿**。
      throw new KernelError(
        'INVALID_STATE',
        'commit 冲突：main 在授权与执行之间移动过（stale_snapshot_at_commit），拒绝执行；' +
          '需要重跑 pipeline 从新 snapshot 出发',
        { detail: { commitFileError: msg } },
      )
    }
  }

  const output: CommitOutput = { commit_created: true }
  return { costActualUsd: 0, output: output as unknown as Record<string, unknown> }
}

// ── Step: open_pr ─────────────────────────────────────────────────────────────

async function stepOpenPr(
  _sb: SupabaseClient,
  deps: PageApplyOptimizationDeps,
  args: { runId: string; clientId: string; decisionId: string; priorOutputs: Readonly<Record<string, Record<string, unknown>>> },
): Promise<CapabilityStepResult> {
  const prep = args.priorOutputs.prepare as unknown as PrepareOutput | undefined
  if (!prep) throw new KernelError('INVALID_STATE', 'prepare 产物不见了')

  const conn = await deps.resolveGithubConnection(args.clientId)
  if (!conn) {
    throw new KernelError('INVALID_INPUT', '客户 GitHub 连接消失（open_pr 阶段）')
  }

  const gh = deps.createGithubClient(conn.plainToken)

  const body = [
    `Automated page optimization by Magic Engine Kernel.`,
    ``,
    `- kernel_run_id: ${args.runId}`,
    `- authorization_decision_id: ${args.decisionId}`,
    `- page: ${prep.content_path}`,
    `- page_version_token (blob SHA before): ${prep.page_version_token}`,
    ``,
    `Changed fields:`,
    ...prep.diff_changes
      .filter((c) => c.changed)
      .map((c) => `- ${c.field}: "${c.before}" → "${c.after}"`),
    ``,
    `Draft PR. Do not auto-merge. See spec: docs/specs/2026-08-19-me2-page-optimization-apply-action-v1.0.md`,
  ].join('\n')

  // 🔴 每一条路径（happy path 与 422 recovery）都必须通过 getPullRequestDetail
  //    验证 draft/state/head/base/body receipt 全部符合本 run；不再"取
  //    listPullRequestsByHead 第一个"。
  let prNumber: number
  let prUrl: string
  try {
    const created = await gh.createPullRequest(prep.repo_owner, prep.repo_name, {
      title: `chore(page): apply optimization on ${prep.content_path}`,
      body,
      head: prep.branch_name,
      base: prep.default_branch,
      draft: true,
    })
    prNumber = created.number
    prUrl = created.html_url
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!/422|already/i.test(msg)) {
      throw new RetryableCapabilityError(`pr_open_failed：${msg}`)
    }
    // 422 recovery：网络模糊成功场景（同 run 已创建 PR 但 output 未持久化）——
    // 查 open PRs by head，逐个用 getPullRequestDetail 核对 receipt 全对才 adopt。
    let candidates: Array<{ number: number; html_url: string }>
    try {
      candidates = await gh.listPullRequestsByHead(prep.repo_owner, prep.repo_name, prep.branch_name)
    } catch (lookupErr) {
      throw new KernelError(
        'INVALID_STATE',
        `pr_open_failed：createPullRequest 报"已存在"但查询也失败：${lookupErr instanceof Error ? lookupErr.message : String(lookupErr)}`,
        { detail: { originalError: msg } },
      )
    }
    let adopted: { number: number; html_url: string } | null = null
    for (const cand of candidates) {
      let d
      try {
        d = await gh.getPullRequestDetail(prep.repo_owner, prep.repo_name, cand.number)
      } catch {
        continue
      }
      if (
        d.draft === true && d.state === 'open' && d.merged === false &&
        d.headRef === prep.branch_name && d.baseRef === prep.default_branch &&
        prBodyOwnedByRun(d.body, args.runId, args.decisionId)
      ) {
        adopted = { number: d.number, html_url: d.htmlUrl }
        break
      }
    }
    if (!adopted) {
      throw new KernelError(
        'INVALID_STATE',
        `pr_open_failed：createPullRequest 报"已存在"但按 head=${prep.branch_name} 找不到 draft+open+head+base+receipt 全对的 PR —— 拒绝 adopt 不属于本 run 的 PR`,
        { detail: { originalError: msg, candidatesInspected: candidates.length } },
      )
    }
    prNumber = adopted.number
    prUrl = adopted.html_url
  }

  // 🔴 happy-path 也再回读一次 detail 做**创建后自检**（同一份 receipt 校验）——
  //    挡"createPullRequest 网络模糊成功但 GitHub 实际返回了别的 PR"或 provider
  //    合约违约（draft 被剥离等）。
  let detail
  try {
    detail = await gh.getPullRequestDetail(prep.repo_owner, prep.repo_name, prNumber)
  } catch (readErr) {
    throw new RetryableCapabilityError(
      `pr_open_readback_failed：${readErr instanceof Error ? readErr.message : String(readErr)}`,
    )
  }
  const receiptOk =
    detail.draft === true && detail.state === 'open' && detail.merged === false &&
    detail.headRef === prep.branch_name && detail.baseRef === prep.default_branch &&
    prBodyOwnedByRun(detail.body, args.runId, args.decisionId)
  if (!receiptOk) {
    throw new KernelError(
      'INVALID_STATE',
      `pr_open_receipt_mismatch：PR #${prNumber} receipt 不符（draft=${detail.draft} state=${detail.state} merged=${detail.merged} head=${detail.headRef} base=${detail.baseRef}）`,
      {
        detail: {
          reason: 'pr_receipt_mismatch', prNumber, prUrl,
          expectedHead: prep.branch_name, expectedBase: prep.default_branch,
          actualHead: detail.headRef, actualBase: detail.baseRef,
          actualDraft: detail.draft, actualState: detail.state,
        },
      },
    )
  }

  const output: OpenPrOutput = { pr_number: prNumber, pr_url: prUrl }
  return { costActualUsd: 0, output: output as unknown as Record<string, unknown> }
}

// ── Step: record（执行 §8.1 五条 execution-integrity 断言） ────────────────────

async function stepRecord(
  sb: SupabaseClient,
  deps: PageApplyOptimizationDeps,
  args: { runId: string; clientId: string; decisionId: string; input: RunInput; priorOutputs: Readonly<Record<string, Record<string, unknown>>> },
): Promise<CapabilityStepResult> {
  const prep = args.priorOutputs.prepare as unknown as PrepareOutput | undefined
  const opened = args.priorOutputs.open_pr as unknown as OpenPrOutput | undefined
  if (!prep || !opened) throw new KernelError('INVALID_STATE', '前置步骤产物不齐')

  const conn = await deps.resolveGithubConnection(args.clientId)
  if (!conn) {
    throw new KernelError('INVALID_INPUT', '客户 GitHub 连接消失（record 阶段）')
  }

  const gh = deps.createGithubClient(conn.plainToken)

  const checks: VerificationResult['checks'] = []
  const record = (name: string, passed: boolean, detail?: string) =>
    checks.push({ name, passed, ...(detail ? { detail } : {}) })

  // ① PR 确实创建
  let prState: { state: 'open' | 'closed'; merged: boolean; mergedAt: string | null } | null = null
  try {
    prState = await gh.getPullRequestState(prep.repo_owner, prep.repo_name, opened.pr_number)
  } catch (e) {
    record('PR 可回读', false, e instanceof Error ? e.message : String(e))
  }
  record(
    'PR 状态为 open',
    prState !== null && prState.state === 'open' && prState.merged === false,
    prState ? `state=${prState.state} merged=${prState.merged}` : undefined,
  )

  // ② PR 基于批准时的版本（重读 base main 上的 blob SHA，等于 page_version_token）
  //    这里不 GET /pulls/{number}/files（会带来大 patch），而是直接对比 main 上的 blob。
  //    commitFile 已把 blob SHA 当乐观令牌传给 GitHub —— main 若在授权→apply 间移动过，
  //    commit 阶段就 409 了；这里再验一次做 belt-and-suspenders。
  let mainSha = ''
  try {
    const mainFile = await gh.getFileContent(prep.repo_owner, prep.repo_name, prep.content_path, prep.default_branch)
    mainSha = mainFile.sha
  } catch (e) {
    record('base main blob 可回读', false, e instanceof Error ? e.message : String(e))
  }
  record(
    'PR 基于 approved 版本（main blob = page_version_token）',
    mainSha === prep.page_version_token,
    mainSha ? `main_sha=${mainSha} expected=${prep.page_version_token}` : undefined,
  )

  // ③ PR diff 等于 approved validated diff（读 PR 分支 head 的文件，字段级重算 hash）
  //    逐字段对比 base main 上的值（approved before）与 head 上的值（after），
  //    只保留 changed 的条目算 hash —— approved diff 里 changed=true 的正是这些。
  let integrityChangedOnly: PrepareOutput['diff_changes'] = []
  try {
    const headFile = await gh.getFileContent(prep.repo_owner, prep.repo_name, prep.content_path, prep.branch_name)
    const baseFile = await gh.getFileContent(prep.repo_owner, prep.repo_name, prep.content_path, prep.default_branch)
    integrityChangedOnly = PAGE_OPTIMIZATION_FIELDS.map((field) => {
      const before = extractGithubFieldValue(baseFile.decodedContent, field) ?? ''
      const after = extractGithubFieldValue(headFile.decodedContent, field) ?? ''
      return { field, before, after, changed: before !== after }
    }).filter((c) => c.changed)
  } catch (e) {
    record('PR head/base blob 可回读', false, e instanceof Error ? e.message : String(e))
  }
  const approvedHash = canonicalDiffHash(prep.diff_changes.filter((c) => c.changed))
  const integrityChangedHash = canonicalDiffHash(integrityChangedOnly)
  record(
    'PR diff = approved validated diff',
    integrityChangedHash === approvedHash,
    `pr=${integrityChangedHash} approved=${approvedHash}`,
  )

  // ④ doNotTouch 字段：head 值 = base 值（未变化）
  const doNotTouchViolations: string[] = []
  try {
    const headFile = await gh.getFileContent(prep.repo_owner, prep.repo_name, prep.content_path, prep.branch_name)
    const baseFile = await gh.getFileContent(prep.repo_owner, prep.repo_name, prep.content_path, prep.default_branch)
    // 🔴 do_not_touch 从 ctx.runInput（Gateway 已 hash-check + 深冻结）读，
    //    **绝不**回查 action_runs.input（TOCTOU；见文件顶部说明）。
    for (const field of args.input.do_not_touch) {
      const before = extractGithubFieldValue(baseFile.decodedContent, field) ?? ''
      const after = extractGithubFieldValue(headFile.decodedContent, field) ?? ''
      if (before !== after) doNotTouchViolations.push(field)
    }
  } catch (e) {
    record('doNotTouch 字段可读取', false, e instanceof Error ? e.message : String(e))
  }
  record(
    'doNotTouch 字段被守住',
    doNotTouchViolations.length === 0,
    doNotTouchViolations.length > 0 ? `违反字段：${doNotTouchViolations.join(',')}` : undefined,
  )

  // ⑤ receipt / lineage 可回读 —— 两条独立断言：
  //    (5a) `output.run_reference` 能被 provider 反查命中（PR 真实存在，且 output
  //         字符串本身自洽）—— 用 pr_number 独立再取一次 PR，避免依赖 step ①
  //         的结果。
  //    (5b) `authorization_decisions.id` 命中（本 capability 由 Kernel ctx 承接，
  //         正常路径下这条恒真；但把它写下来，让 append-only 表被误删或迁移出问题
  //         时能就地看见）。
  const expectedRunRef = `pr:${prep.repo_owner}/${prep.repo_name}#${opened.pr_number}`
  let runRefResolvable = false
  try {
    // 独立再取一次（跟 step ① 的 getPullRequestState 是不同一次网络往返）
    const again = await gh.getPullRequestState(prep.repo_owner, prep.repo_name, opened.pr_number)
    runRefResolvable = again.state === 'open' || again.state === 'closed'
  } catch (e) {
    // e 落到 detail
    record('output.run_reference 可反查', false, e instanceof Error ? e.message : String(e))
  }
  record('output.run_reference 可反查', runRefResolvable, expectedRunRef)

  // 🔴 子牙复审 (2026-08-19) 修正：loadDecisionExists 抛错时**不**外抛
  //    RetryableCapabilityError（会跳过 verification 汇总），改成落一条
  //    failed check。这样一来无论 Supabase 瞬时错还是 decision 行真丢，
  //    都走 verification failed 路径。
  let decisionOk = false
  try {
    decisionOk = await loadDecisionExists(sb, args.decisionId)
    record('authorization_decisions 行可回读', decisionOk, decisionOk ? undefined : args.decisionId)
  } catch (e) {
    record(
      'authorization_decisions 行可回读',
      false,
      `回读授权决策失败：${e instanceof Error ? e.message : String(e)}`,
    )
  }

  const failed = checks.filter((c) => !c.passed)
  const verification: VerificationResult = {
    method: 'page_apply_integrity',
    passed: failed.length === 0,
    checks,
    ...(failed.length > 0
      ? {
          failure_reason: failed
            .map((c) => `${c.name}${c.detail ? `（${c.detail}）` : ''}`)
            .join('；'),
        }
      : {}),
  }

  return {
    costActualUsd: 0,
    verification,
    output: {
      provider: 'github',
      run_reference: `pr:${prep.repo_owner}/${prep.repo_name}#${opened.pr_number}`,
      pr_url: opened.pr_url,
    },
  }
}

// ── Rollback handler (provider_native · GitHub Draft PR close + branch delete) ─
//
// 🔴 契约（`OutwardRollbackHandler`）由 #1108 Kernel Outward Hardening 冻结：
//    - 三态返回（provider_native ok=true/false、noop）
//    - Gateway 已在调本 handler **之前**查 `action_run_steps(step_key='rollback')` lineage；
//      命中即跳过 handler → 本 handler **只**处理"第一次真调用"和"崩溃后接管重调"
//    - 幂等义务：同 run 多次调用不许把 provider 弄坏
//    - 抛异常 = failed（Gateway 会 catch 并落 lineage）；handler **禁抛** RetryableCapabilityError
//
// 🔴 Rollback 目标 identity **只**来自：
//    (a) 上游 step 的 priorOutputs（deterministic branchName + pr_number/url）
//    (b) `ctx.runInput`（deep-frozen；用于 branch prefix 校验的 idempotency 派生）
//    绝不从任何外部/caller-provided 数字读 PR number 或 branch name。
//
// 🔴 v1 只处理 GitHub。不建 provider abstraction —— 未来 WordPress 走**另一个**
//    action + 另一个 capability + 另一个 rollback handler，不是把本函数扩泛型。

async function rollbackHandler(
  deps: PageApplyOptimizationDeps,
  step: CapabilityStepContext,
  _priorOutputsArg: Readonly<Record<string, Record<string, unknown>>>,
): Promise<OutwardRollbackResult> {
  // 🔴 Gateway 传两次 priorOutputs（step.priorOutputs 与第二参数）—— 值相同，
  //    永远以 step.priorOutputs 为准（跟 CapabilityStepHandler 一致）。
  const priorOutputs = step.priorOutputs
  const prep = priorOutputs.prepare as unknown as PrepareOutput | undefined
  const opened = priorOutputs.open_pr as unknown as OpenPrOutput | undefined

  const runId = step.ctx.runId
  const decisionId = step.ctx.decisionId

  // prep 都没成 → provider 零副作用 → 真 noop
  if (!prep) {
    return { ok: true, rollbackKind: 'noop', detail: { reason: 'prepare 未完成' } }
  }

  // ── 静态身份闸（未开始 live 前）─────────────────────────────────────────
  const OWNED_BRANCH_RE = /^me\/page-apply\/[0-9a-f]{24}$/
  if (!OWNED_BRANCH_RE.test(prep.branch_name)) {
    return {
      ok: false, rollbackKind: 'provider_native',
      detail: { branch_name: prep.branch_name, reason: 'branch_prefix_not_owned' },
      failure_reason: `拒绝 rollback：branch_name 不符合 me/page-apply/<24hex>`,
    }
  }
  let expectedBranch: string
  try {
    const ri = parseRunInput(step.runInput)
    const idKey = idempotencyKeyFromInput(ri.page_url, ri.page_version_token, ri.validated_diff_hash)
    expectedBranch = branchNameForRun(idKey)
  } catch (e) {
    return {
      ok: false, rollbackKind: 'provider_native',
      detail: { thrown: e instanceof Error ? e.message : String(e), reason: 'run_input_shape_invalid' },
      failure_reason: `拒绝 rollback：ctx.runInput 形状不对`,
    }
  }
  if (expectedBranch !== prep.branch_name) {
    return {
      ok: false, rollbackKind: 'provider_native',
      detail: { prior_branch: prep.branch_name, expected: expectedBranch, reason: 'branch_not_derived_from_runinput' },
      failure_reason: `拒绝 rollback：prep.branch_name 跟 ctx.runInput 重算不一致`,
    }
  }

  const conn = await deps.resolveGithubConnection(step.ctx.clientId)
  if (!conn) {
    return {
      ok: false, rollbackKind: 'provider_native',
      detail: { clientId: step.ctx.clientId, reason: 'connection_missing' },
      failure_reason: `拒绝 rollback：客户 GitHub 连接消失`,
    }
  }
  const gh = deps.createGithubClient(conn.plainToken)

  const detail: Record<string, unknown> = {
    branch_name: prep.branch_name,
    repo: `${prep.repo_owner}/${prep.repo_name}`,
    kernel_run_id: runId,
  }

  // ── (LIVE-1) live default_branch ─ 绝不信 prep.default_branch ────────────
  let liveDefaultBranch: string
  try {
    const repoInfo = await gh.getRepo(prep.repo_owner, prep.repo_name)
    liveDefaultBranch = repoInfo.default_branch
    detail.live_default_branch = liveDefaultBranch
  } catch (e) {
    return {
      ok: false, rollbackKind: 'provider_native',
      detail: { ...detail, reason: 'live_default_read_failed' },
      failure_reason: `拒绝 rollback：无法读 live default_branch：${e instanceof Error ? e.message : String(e)}`,
    }
  }
  if (prep.branch_name === liveDefaultBranch) {
    return {
      ok: false, rollbackKind: 'provider_native',
      detail: { ...detail, reason: 'branch_equals_live_default' },
      failure_reason: `拒绝 rollback：branch_name === live default_branch (${liveDefaultBranch})`,
    }
  }

  // ── (LIVE-2) branch 是否真实存在 ─ 决定 noop / cleanup ─────────────────
  let branchTipSha: string | null = null
  try {
    branchTipSha = await gh.getBranchSha(prep.repo_owner, prep.repo_name, prep.branch_name)
  } catch (e) {
    if (e instanceof GitHubApiError && e.status === 404) {
      branchTipSha = null
    } else {
      return {
        ok: false, rollbackKind: 'provider_native',
        detail: { ...detail, reason: 'live_branch_read_failed' },
        failure_reason: `拒绝 rollback：读 live branch SHA 失败：${e instanceof Error ? e.message : String(e)}`,
      }
    }
  }
  detail.live_branch_present = branchTipSha !== null

  // ── (LIVE-3) branch 存在则验所有权 ─ 只认 tip commit message 里的 run marker ─
  //    🔴 blocker 4：**禁止** `branchTipSha === prep.page_version_token`。
  //    branch tip commit SHA 与 page blob SHA 是**两种不同的 Git 对象**，即便偶然
  //    相等也不构成所有权证明。ownership 只走 getCommit(tip).message → marker。
  //    任一读取失败 → truthful failure（不允许猜测 noop 或 delete）。
  let branchOwnedByThisRun = false
  if (branchTipSha !== null) {
    let tipMessage: string
    try {
      const tip = await gh.getCommit(prep.repo_owner, prep.repo_name, branchTipSha)
      tipMessage = tip.message
    } catch (e) {
      return {
        ok: false, rollbackKind: 'provider_native',
        detail: { ...detail, branch_tip: branchTipSha, reason: 'tip_commit_read_failed' },
        failure_reason: `拒绝 rollback：读 branch tip commit 失败：${e instanceof Error ? e.message : String(e)}`,
      }
    }
    if (commitMessageOwnedByRun(tipMessage, runId)) {
      branchOwnedByThisRun = true
      detail.branch_ownership = 'tip_has_run_marker'
    } else {
      detail.branch_ownership = 'tip_missing_run_marker'
    }
  }

  // ── (LIVE-4) 查 same-head PR 全部状态（open + closed + merged）─────────
  //    🔴 blocker 1：任何 list / detail 读取失败 → 立即 fail-closed，禁止 close/delete。
  //    🔴 blocker 1：任一候选 PR 无法证明属于本 run → 立即 fail-closed（不共享 branch 上删）。
  //    🔴 blocker 2：只有 owned + open + draft=true 才 close；owned + open + draft=false 或
  //                  merged 或状态未知 → fail-closed 零写入。
  interface OwnedPr { number: number; state: 'open' | 'closed'; merged: boolean; mergedAt: string | null; draft: boolean; headRef: string; baseRef: string; body: string }
  const inspect = async (n: number): Promise<OwnedPr> => {
    // 不做 404 兜底：blocker 1 要求 detail 读取失败即 fail-closed。
    const d = await gh.getPullRequestDetail(prep.repo_owner, prep.repo_name, n)
    return { number: d.number, state: d.state, merged: d.merged, mergedAt: d.mergedAt, draft: d.draft, headRef: d.headRef, baseRef: d.baseRef, body: d.body }
  }
  type PrClass = 'merged' | 'owned_open_draft' | 'owned_open_ready_for_review' | 'owned_closed_unmerged' | 'not_owned' | 'unknown_state'
  const classify = (pd: OwnedPr): PrClass => {
    if (pd.merged === true) return 'merged'
    // 🔴 runtime state 必须**严格**是 'open' 或 'closed'（provider 契约违约防御）——
    //    禁止「不是 closed 就当 open」。任何未知值 → unknown_state → fail-closed。
    if (pd.state !== 'open' && pd.state !== 'closed') return 'unknown_state'
    const receiptOk =
      pd.headRef === prep.branch_name &&
      pd.baseRef === liveDefaultBranch &&
      prBodyOwnedByRun(pd.body, runId, decisionId)
    if (!receiptOk) return 'not_owned'
    if (pd.state === 'closed') return 'owned_closed_unmerged'
    // state === 'open'
    if (pd.draft !== true) return 'owned_open_ready_for_review'
    return 'owned_open_draft'
  }

  const prsToClose: OwnedPr[] = []
  const mergedBlockers: OwnedPr[] = []
  const seenPrNumbers = new Set<number>()

  const notedOpenedPr = async (): Promise<OutwardRollbackResult | null> => {
    if (!opened) return null
    detail.pr_number_by_opened = opened.pr_number
    detail.pr_url_by_opened = opened.pr_url
    let pd: OwnedPr
    try {
      pd = await inspect(opened.pr_number)
    } catch (e) {
      if (e instanceof GitHubApiError && e.status === 404) {
        detail.pr_state_by_opened = '404_not_found'
        return null // 404 幂等；不算失败
      }
      return {
        ok: false, rollbackKind: 'provider_native',
        detail: { ...detail, reason: 'live_pr_read_failed', pr_number: opened.pr_number },
        failure_reason: `拒绝 rollback：读 PR #${opened.pr_number} 失败：${e instanceof Error ? e.message : String(e)}`,
      }
    }
    seenPrNumbers.add(pd.number)
    const cls = classify(pd)
    detail.pr_classification_by_opened = cls
    if (cls === 'merged') { mergedBlockers.push(pd); return null }
    if (cls === 'not_owned') {
      return {
        ok: false, rollbackKind: 'provider_native',
        detail: { ...detail, reason: 'pr_not_owned_by_run', pr_head: pd.headRef, pr_base: pd.baseRef },
        failure_reason: `拒绝 rollback：PR #${opened.pr_number} head/base/body receipt 不符本 run`,
      }
    }
    if (cls === 'owned_open_ready_for_review') {
      return {
        ok: false, rollbackKind: 'provider_native',
        detail: { ...detail, reason: 'pr_ready_for_review', pr_number: pd.number },
        failure_reason: `拒绝 rollback：PR #${opened.pr_number} 已被人 mark ready-for-review (draft=false)，v1 不自动 close`,
      }
    }
    if (cls === 'unknown_state') {
      return {
        ok: false, rollbackKind: 'provider_native',
        detail: { ...detail, reason: 'pr_state_unknown', pr_number: pd.number, actual_state: pd.state },
        failure_reason: `拒绝 rollback：PR #${opened.pr_number} state 既非 'open' 也非 'closed'（provider 契约违约）`,
      }
    }
    if (cls === 'owned_open_draft') prsToClose.push(pd)
    // owned_closed_unmerged → 跳过 PR 动作，稍后照常处理 owned branch
    return null
  }
  const openedResult = await notedOpenedPr()
  if (openedResult) return openedResult

  // list state=all；🔴 blocker 1：list 失败 → 立即 fail-closed
  let candidates: Array<{ number: number }>
  try {
    candidates = await gh.listPullRequestsByHead(prep.repo_owner, prep.repo_name, prep.branch_name, 'all')
  } catch (e) {
    return {
      ok: false, rollbackKind: 'provider_native',
      detail: { ...detail, reason: 'list_head_prs_failed' },
      failure_reason: `拒绝 rollback：listPullRequestsByHead(state=all) 失败：${e instanceof Error ? e.message : String(e)}`,
    }
  }
  for (const cand of candidates) {
    if (seenPrNumbers.has(cand.number)) continue
    let pd: OwnedPr
    try {
      pd = await inspect(cand.number)
    } catch (e) {
      // 🔴 blocker A：list 已枚举出的 candidate，随后 detail 读取任何错误
      //    （**包括 404**）都必须立即 fail-closed。禁止 `continue` 忽略。
      //    (opened.pr_number 的 404 幂等语义在 notedOpenedPr 里保留 —— 那是
      //    prior output 明确记录的场景，语义不同。)
      const isApi404 = e instanceof GitHubApiError && e.status === 404
      return {
        ok: false, rollbackKind: 'provider_native',
        detail: {
          ...detail,
          reason: isApi404 ? 'listed_candidate_detail_404' : 'live_pr_read_failed',
          pr_number: cand.number,
        },
        failure_reason: isApi404
          ? `拒绝 rollback：listPullRequestsByHead 枚举出 PR #${cand.number}，但随后 detail 读取 404 —— 状态不可读，禁止 close/delete`
          : `拒绝 rollback：读 PR #${cand.number} 失败：${e instanceof Error ? e.message : String(e)}`,
      }
    }
    seenPrNumbers.add(pd.number)
    const cls = classify(pd)
    if (cls === 'merged') { mergedBlockers.push(pd); continue }
    if (cls === 'not_owned') {
      // 🔴 blocker 1：候选 PR 无法证明属于本 run → 不能忽略后继续删共享 branch
      return {
        ok: false, rollbackKind: 'provider_native',
        detail: { ...detail, reason: 'foreign_pr_on_owned_head', pr_number: pd.number, pr_head: pd.headRef, pr_base: pd.baseRef },
        failure_reason: `拒绝 rollback：head=${prep.branch_name} 上挂着不属于本 run 的 PR #${pd.number}`,
      }
    }
    if (cls === 'owned_open_ready_for_review') {
      return {
        ok: false, rollbackKind: 'provider_native',
        detail: { ...detail, reason: 'pr_ready_for_review', pr_number: pd.number },
        failure_reason: `拒绝 rollback：owned head 上的 PR #${pd.number} 已被 mark ready-for-review`,
      }
    }
    if (cls === 'unknown_state') {
      return {
        ok: false, rollbackKind: 'provider_native',
        detail: { ...detail, reason: 'pr_state_unknown', pr_number: pd.number, actual_state: pd.state },
        failure_reason: `拒绝 rollback：PR #${pd.number} state 既非 'open' 也非 'closed'（provider 契约违约）`,
      }
    }
    if (cls === 'owned_open_draft') prsToClose.push(pd)
    // owned_closed_unmerged → 已关闭，不动
  }

  // ── merged PR 撞到本 run 的 head → truthful failure，零 provider write ─
  if (mergedBlockers.length > 0) {
    return {
      ok: false, rollbackKind: 'provider_native',
      detail: {
        ...detail, reason: 'merged_pr_on_owned_head',
        merged_prs: mergedBlockers.map((p) => ({ number: p.number, mergedAt: p.mergedAt })),
      },
      failure_reason: `拒绝 rollback：head=${prep.branch_name} 上挂着已 merge 的 PR (${mergedBlockers.map((p) => `#${p.number}`).join(',')})，v1 不做 post-merge revert；分支也不删`,
    }
  }

  // ── branch 存在但被别人 commit 过（非本 run）→ 拒绝 delete ─────────────
  if (branchTipSha !== null && !branchOwnedByThisRun) {
    return {
      ok: false, rollbackKind: 'provider_native',
      detail: { ...detail, reason: 'branch_tampered_not_owned', branch_tip: branchTipSha },
      failure_reason: `拒绝 rollback：branch ${prep.branch_name} 存在但 tip 既非 page_version_token 也不带本 run marker`,
    }
  }

  // ── truthful noop：live 上确认 branch 不在 且 无本 run 相关 PR 需要动 ──
  if (branchTipSha === null && prsToClose.length === 0) {
    return {
      ok: true, rollbackKind: 'noop',
      detail: { ...detail, reason: 'live_check_shows_zero_side_effect' },
    }
  }

  // ── close 所有 owned open PR；close 失败即返回 fail，不进入 delete ────
  const closedPrs: number[] = []
  for (const p of prsToClose) {
    try {
      await gh.closePullRequest(prep.repo_owner, prep.repo_name, p.number)
      closedPrs.push(p.number)
    } catch (e) {
      if (e instanceof GitHubApiError && e.status === 404) {
        closedPrs.push(p.number)
      } else {
        return {
          ok: false, rollbackKind: 'provider_native',
          detail: { ...detail, reason: 'close_pr_failed', pr_number: p.number, closed_so_far: closedPrs },
          failure_reason: `closePullRequest #${p.number} 失败：${e instanceof Error ? e.message : String(e)}`,
        }
      }
    }
  }
  detail.closed_prs = closedPrs

  // ── delete branch：仅当 branch live 存在且 owned ─ 404 幂等 ok ──────────
  if (branchTipSha !== null && branchOwnedByThisRun) {
    try {
      await gh.deleteBranch(prep.repo_owner, prep.repo_name, prep.branch_name)
      detail.branch_state = 'deleted_by_rollback'
    } catch (e) {
      if (e instanceof GitHubApiError && e.status === 404) {
        detail.branch_state = '404_at_delete'
      } else {
        return {
          ok: false, rollbackKind: 'provider_native',
          detail: { ...detail, reason: 'delete_branch_failed' },
          failure_reason: `deleteBranch 失败：${e instanceof Error ? e.message : String(e)}`,
        }
      }
    }
  } else if (branchTipSha === null) {
    detail.branch_state = 'already_absent'
  }

  return { ok: true, rollbackKind: 'provider_native', detail }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createPageApplyOptimizationCapability(
  sb: SupabaseClient,
  overrideDeps?: Partial<PageApplyOptimizationDeps>,
): CapabilityImplementation {
  const deps: PageApplyOptimizationDeps = { ...defaultDeps(), ...(overrideDeps ?? {}) }

  return {
    actionKey: 'page.apply_optimization_request',
    version: 1,
    steps: {
      async prepare({ ctx, runInput }) {
        return stepPrepare(deps, {
          runId: ctx.runId,
          clientId: ctx.clientId,
          input: parseRunInput(runInput),
        })
      },
      async commit({ ctx, priorOutputs }) {
        return stepCommit(sb, deps, { runId: ctx.runId, clientId: ctx.clientId, priorOutputs })
      },
      async open_pr({ ctx, priorOutputs }) {
        return stepOpenPr(sb, deps, {
          runId: ctx.runId,
          clientId: ctx.clientId,
          decisionId: ctx.decisionId,
          priorOutputs,
        })
      },
      async record({ ctx, runInput, priorOutputs }) {
        return stepRecord(sb, deps, {
          runId: ctx.runId,
          clientId: ctx.clientId,
          decisionId: ctx.decisionId,
          input: parseRunInput(runInput),
          priorOutputs,
        })
      },
    },
    rollback: (step, priorOutputs) => rollbackHandler(deps, step, priorOutputs),
  }
}
