import { createHash } from 'node:crypto'
import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'
import { KernelError } from '@/lib/kernel/errors'
import type {
  CapabilityImplementation,
  CapabilityStepResult,
  OutwardRollbackResult,
  VerificationResult,
} from '@/lib/kernel/types'
import type { GrowthJsonValue } from '@/lib/growth'
import type { PageOptimizationField, PageOptimizationIntent } from '@/lib/page-optimization'
import { CTS_CLIENT_ID, inspectCtsIntentForSlug, replaceIntentForSlug } from '@/lib/seo-meta/cts-meta-source'
import {
  defaultCtsGithubDeps,
  type CtsGithubClient,
  type CtsGithubConnection,
  type PageApplyCtsGithubDeps,
} from './deps'

interface RunInput {
  readonly page_url: string
  readonly page_version_token: string
  readonly validated_diff_hash: string
  readonly intents: readonly PageOptimizationIntent[]
  readonly headline: {
    readonly proposedValue: string
    readonly semanticIntent: string
  }
  readonly do_not_touch: readonly PageOptimizationField[]
  readonly github_repo_owner: string
  readonly github_repo_name: string
  readonly github_default_branch: string
  readonly github_content_path: string
  readonly github_entry_slug: string
  readonly authorization_context: Readonly<Record<string, unknown>>
}

interface PrepareOutput {
  readonly repo_owner: string
  readonly repo_name: string
  readonly default_branch: string
  readonly content_path: string
  readonly entry_slug: string
  readonly page_version_token: string
  readonly branch_name: string
  readonly patched_content: string
  readonly before: { readonly title: string; readonly description: string; readonly h1: string }
  readonly after: { readonly title: string; readonly description: string; readonly h1: string }
  readonly diff_changes: readonly CtsIntentFieldDiff[]
}

interface CtsIntentFieldDiff {
  readonly field: 'meta_title' | 'meta_description' | 'h1'
  readonly before: string
  readonly after: string
  readonly changed: boolean
}

interface OpenPrOutput {
  readonly pr_number: number
  readonly pr_url: string
}

interface CommitOutput {
  readonly commit_sha: string
  readonly content_sha: string
}

const DATA_PATH = /^src\/lib\/data\/(?:seo-pages|blogs)[^/]*\.ts$/
const SAFE_NAME = /^[A-Za-z0-9_.-]+$/

function assertRolloutEnabled(deps: PageApplyCtsGithubDeps): void {
  if (!deps.isRolloutEnabled()) {
    throw new KernelError('INVALID_STATE', 'CTS GitHub metadata rollout 已关闭')
  }
}

function pageSlug(url: string): string | null {
  try {
    const slug = decodeURIComponent(new URL(url).pathname).split('/').filter(Boolean).at(-1) ?? ''
    return /^[a-z0-9][a-z0-9-]*$/.test(slug) ? slug : null
  } catch {
    return null
  }
}

function parseInput(value: Readonly<Record<string, unknown>>): RunInput {
  const intents = value.intents
  const doNotTouch = value.do_not_touch
  const headline = value.headline
  const context = value.authorization_context
  const strings = [
    value.page_url,
    value.page_version_token,
    value.validated_diff_hash,
    value.github_repo_owner,
    value.github_repo_name,
    value.github_default_branch,
    value.github_content_path,
    value.github_entry_slug,
  ]
  if (
    strings.some((item) => typeof item !== 'string' || !item.trim()) ||
    !Array.isArray(intents) || intents.length !== 2 ||
    !Array.isArray(doNotTouch) ||
    !headline || typeof headline !== 'object' || Array.isArray(headline) ||
    typeof (headline as Record<string, unknown>).proposedValue !== 'string' ||
    !(headline as Record<string, string>).proposedValue.trim() ||
    typeof (headline as Record<string, unknown>).semanticIntent !== 'string' ||
    !(headline as Record<string, string>).semanticIntent.trim() ||
    !context || typeof context !== 'object' || Array.isArray(context)
  ) throw new KernelError('INVALID_INPUT', 'CTS GitHub metadata 输入缺字段或类型不正确')

  const typedIntents = intents as unknown as PageOptimizationIntent[]
  const fields = typedIntents.map((intent) => intent?.field)
  if (
    !typedIntents.every((intent) => intent && typeof intent === 'object' &&
      (intent.field === 'meta_title' || intent.field === 'meta_description') &&
      typeof intent.proposedValue === 'string' && intent.proposedValue.trim()) ||
    new Set(fields).size !== 2 ||
    doNotTouch.length !== 1 || doNotTouch[0] !== 'content_html'
  ) throw new KernelError('INVALID_INPUT', 'CTS GitHub intent 只允许唯一的 title+description+H1，正文必须 do-not-touch')

  const input = {
    page_url: value.page_url as string,
    page_version_token: value.page_version_token as string,
    validated_diff_hash: value.validated_diff_hash as string,
    intents: typedIntents,
    headline: headline as RunInput['headline'],
    do_not_touch: doNotTouch as PageOptimizationField[],
    github_repo_owner: value.github_repo_owner as string,
    github_repo_name: value.github_repo_name as string,
    github_default_branch: value.github_default_branch as string,
    github_content_path: value.github_content_path as string,
    github_entry_slug: value.github_entry_slug as string,
    authorization_context: context as Readonly<Record<string, unknown>>,
  }
  if (
    !SAFE_NAME.test(input.github_repo_owner) || !SAFE_NAME.test(input.github_repo_name) ||
    !input.github_default_branch.trim() || /(?:\.\.|[\u0000-\u001f])/.test(input.github_default_branch) ||
    !DATA_PATH.test(input.github_content_path) ||
    pageSlug(input.page_url) !== input.github_entry_slug
  ) throw new KernelError('INVALID_INPUT', 'CTS GitHub repository target 不在受治理窄通道内')
  return input
}

function actualAction(input: RunInput): Record<string, unknown> {
  return {
    page_url: input.page_url,
    page_version_token: input.page_version_token,
    validated_diff_hash: input.validated_diff_hash,
    intents: input.intents,
    headline: input.headline,
    do_not_touch: input.do_not_touch,
    github_repo_owner: input.github_repo_owner,
    github_repo_name: input.github_repo_name,
    github_default_branch: input.github_default_branch,
    github_content_path: input.github_content_path,
    github_entry_slug: input.github_entry_slug,
  }
}

function assertAuthorization(
  deps: PageApplyCtsGithubDeps,
  input: RunInput,
  clientId: string,
): void {
  const context = input.authorization_context
  const { authorization_proof: proof, ...unsigned } = context
  const receipt = context.source_receipt
  const binding = context.source_binding
  const lineage = context.growth_lineage
  const authorized = context.authorized_action
  const actionDigest = context.action_digest
  const finding = lineage && typeof lineage === 'object' && !Array.isArray(lineage)
    ? (lineage as Record<string, unknown>).finding : null
  const evidence = finding && typeof finding === 'object' && !Array.isArray(finding)
    ? (finding as Record<string, unknown>).evidence : null
  const sourceId = receipt && typeof receipt === 'object' && !Array.isArray(receipt)
    ? (receipt as Record<string, unknown>).evidence_source_id : null
  const evidenceMatches = typeof sourceId === 'string' && Array.isArray(evidence) &&
    evidence.some((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false
      const source = (item as Record<string, unknown>).source
      return source && typeof source === 'object' && !Array.isArray(source) &&
        (source as Record<string, unknown>).sourceId === sourceId
    })
  const bindingMatches = binding && typeof binding === 'object' && !Array.isArray(binding) &&
    (binding as Record<string, unknown>).repo_owner === input.github_repo_owner &&
    (binding as Record<string, unknown>).repo_name === input.github_repo_name &&
    (binding as Record<string, unknown>).default_branch === input.github_default_branch &&
    (binding as Record<string, unknown>).content_path === input.github_content_path &&
    (binding as Record<string, unknown>).entry_slug === input.github_entry_slug &&
    (binding as Record<string, unknown>).version_token === input.page_version_token
  if (
    clientId !== CTS_CLIENT_ID || context.client_id !== CTS_CLIENT_ID ||
    context.validation_passed !== true || context.target_page_url !== input.page_url ||
    !receipt || typeof receipt !== 'object' || Array.isArray(receipt) ||
    (receipt as Record<string, unknown>).provider !== 'gsc' ||
    (receipt as Record<string, unknown>).country !== 'nzl' ||
    !bindingMatches || !evidenceMatches ||
    !authorized || typeof authorized !== 'object' || Array.isArray(authorized) ||
    typeof actionDigest !== 'string' ||
    actionDigest !== canonicalHashOfInput(authorized) ||
    actionDigest !== canonicalHashOfInput(actualAction(input)) ||
    !deps.verifyAuthorizationProof(unsigned as unknown as GrowthJsonValue, proof)
  ) throw new KernelError('INVALID_INPUT', 'CTS GitHub authorization_context 未绑定 evidence/source/action')
}

async function connectionFor(
  deps: PageApplyCtsGithubDeps,
  clientId: string,
  input: RunInput,
): Promise<CtsGithubConnection> {
  const connection = await deps.resolveConnection(clientId)
  if (
    !connection || connection.status !== 'connected' ||
    connection.repoOwner !== input.github_repo_owner ||
    connection.repoName !== input.github_repo_name ||
    connection.defaultBranch !== input.github_default_branch
  ) throw new KernelError('INVALID_INPUT', 'CTS GitHub connection 与已授权 repository 不一致')
  return connection
}

function diffFor(
  before: { title: string; description: string; h1: string },
  intents: readonly PageOptimizationIntent[],
  headline: RunInput['headline'],
): CtsIntentFieldDiff[] {
  const metadata: CtsIntentFieldDiff[] = intents.map((intent) => {
    const old = intent.field === 'meta_title' ? before.title : before.description
    return {
      field: intent.field as 'meta_title' | 'meta_description',
      before: old,
      after: intent.proposedValue,
      changed: old !== intent.proposedValue,
    }
  })
  return [...metadata, {
    field: 'h1',
    before: before.h1,
    after: headline.proposedValue,
    changed: before.h1 !== headline.proposedValue,
  }]
}

function branchName(input: RunInput, runId: string): string {
  return `me/cts-intent/${createHash('sha256')
    .update(`${runId}:${canonicalHashOfInput(actualAction(input))}`)
    .digest('hex').slice(0, 24)}`
}

function commitMessage(runId: string, entrySlug: string): string {
  return `[kernel run ${runId}] seo: clarify ${entrySlug} intent`
}

async function prepareStep(
  deps: PageApplyCtsGithubDeps,
  clientId: string,
  runId: string,
  input: RunInput,
): Promise<CapabilityStepResult> {
  assertRolloutEnabled(deps)
  assertAuthorization(deps, input, clientId)
  const connection = await connectionFor(deps, clientId, input)
  const client = deps.createClient(connection.plainToken)
  const file = await client.getFileContent(
    input.github_repo_owner,
    input.github_repo_name,
    input.github_content_path,
    input.github_default_branch,
  )
  if (file.sha !== input.page_version_token) {
    throw new KernelError('INVALID_INPUT', 'stale_snapshot：CTS intent source blob SHA 已变化')
  }
  const current = inspectCtsIntentForSlug(file.decodedContent, input.github_entry_slug)
  if (!current) throw new KernelError('INVALID_INPUT', 'CTS intent target 不再唯一或字段不可读')
  const before = { title: current.title, description: current.description, h1: current.h1 }
  const diff = diffFor(before, input.intents, input.headline)
  if (!diff.some(({ changed }) => changed)) throw new KernelError('INVALID_INPUT', 'CTS intent 没有实际变化')
  if (canonicalHashOfInput(diff) !== input.validated_diff_hash) {
    throw new KernelError('INVALID_INPUT', 'pipeline_regression：CTS intent diff hash 不一致')
  }
  const proposed = new Map(input.intents.map(({ field, proposedValue }) => [field, proposedValue]))
  const replacement = replaceIntentForSlug(
    file.decodedContent,
    input.github_entry_slug,
    proposed.get('meta_title') ?? '',
    proposed.get('meta_description') ?? '',
    input.headline.proposedValue,
  )
  if (!replacement) throw new KernelError('INVALID_INPUT', 'CTS intent patch 失败')
  const output: PrepareOutput = {
    repo_owner: input.github_repo_owner,
    repo_name: input.github_repo_name,
    default_branch: input.github_default_branch,
    content_path: input.github_content_path,
    entry_slug: input.github_entry_slug,
    page_version_token: input.page_version_token,
    branch_name: branchName(input, runId),
    patched_content: replacement.updated,
    before,
    after: {
      title: proposed.get('meta_title') ?? '',
      description: proposed.get('meta_description') ?? '',
      h1: input.headline.proposedValue,
    },
    diff_changes: diff,
  }
  return { output: output as unknown as Record<string, unknown>, costActualUsd: 0 }
}

function prepareOutput(prior: Readonly<Record<string, Record<string, unknown>>>): PrepareOutput {
  const output = prior.prepare as unknown as PrepareOutput | undefined
  if (!output) throw new KernelError('INVALID_STATE', 'CTS GitHub prepare output 缺失')
  return output
}

async function clientForOutput(
  deps: PageApplyCtsGithubDeps,
  clientId: string,
  input: RunInput,
): Promise<CtsGithubClient> {
  const connection = await connectionFor(deps, clientId, input)
  return deps.createClient(connection.plainToken)
}

async function commitStep(
  deps: PageApplyCtsGithubDeps,
  clientId: string,
  runId: string,
  input: RunInput,
  prior: Readonly<Record<string, Record<string, unknown>>>,
): Promise<CapabilityStepResult> {
  assertRolloutEnabled(deps)
  const prepared = prepareOutput(prior)
  const client = await clientForOutput(deps, clientId, input)
  const baseSha = await client.getBranchSha(prepared.repo_owner, prepared.repo_name, prepared.default_branch)
  await client.createBranchWithMarker(
    prepared.repo_owner,
    prepared.repo_name,
    prepared.branch_name,
    baseSha,
    `[kernel run ${runId}] CTS intent branch ownership marker`,
  )
  const receipt = await client.commitFileWithReceipt(
    prepared.repo_owner,
    prepared.repo_name,
    prepared.content_path,
    prepared.branch_name,
    prepared.patched_content,
    commitMessage(runId, prepared.entry_slug),
    prepared.page_version_token,
  )
  const liveTip = await client.getBranchSha(
    prepared.repo_owner,
    prepared.repo_name,
    prepared.branch_name,
  )
  if (liveTip !== receipt.commitSha) {
    throw new KernelError('INVALID_STATE', 'CTS GitHub commit receipt 与 branch tip 不一致')
  }
  return {
    output: { commit_sha: receipt.commitSha, content_sha: receipt.contentSha },
    costActualUsd: 0,
  }
}

function ownedPrIdentity(detail: Awaited<ReturnType<CtsGithubClient['getPullRequestDetail']>>, prepared: PrepareOutput, runId: string, decisionId: string): boolean {
  const lines = detail.body.split(/\r?\n/)
  return detail.draft && !detail.merged &&
    detail.headRef === prepared.branch_name && detail.baseRef === prepared.default_branch &&
    lines.includes(`- kernel_run_id: ${runId}`) &&
    lines.includes(`- authorization_decision_id: ${decisionId}`)
}

function ownedOpenDraftPr(detail: Awaited<ReturnType<CtsGithubClient['getPullRequestDetail']>>, prepared: PrepareOutput, runId: string, decisionId: string): boolean {
  return detail.state === 'open' && ownedPrIdentity(detail, prepared, runId, decisionId)
}

async function openPrStep(
  deps: PageApplyCtsGithubDeps,
  clientId: string,
  runId: string,
  decisionId: string,
  input: RunInput,
  prior: Readonly<Record<string, Record<string, unknown>>>,
): Promise<CapabilityStepResult> {
  assertRolloutEnabled(deps)
  const prepared = prepareOutput(prior)
  const committed = prior.commit as unknown as CommitOutput | undefined
  if (!committed) throw new KernelError('INVALID_STATE', 'CTS GitHub commit receipt 缺失')
  const client = await clientForOutput(deps, clientId, input)
  const tip = await client.getBranchSha(
    prepared.repo_owner,
    prepared.repo_name,
    prepared.branch_name,
  )
  if (tip !== committed.commit_sha) {
    throw new KernelError('INVALID_STATE', 'CTS GitHub branch 在 Draft PR 前发生漂移')
  }
  const body = [
    '## Magic Engine · CTS search-intent change',
    '',
    `- page: ${input.page_url}`,
    `- query: ${(input.authorization_context.source_receipt as Record<string, unknown>).query}`,
    `- source: ${prepared.content_path}#${prepared.entry_slug}`,
    `- kernel_run_id: ${runId}`,
    `- authorization_decision_id: ${decisionId}`,
    '',
    'Draft PR only. Human merge remains required.',
  ].join('\n')
  const pr = await client.createPullRequest(prepared.repo_owner, prepared.repo_name, {
    title: `[Magic Engine] CTS intent: ${prepared.entry_slug}`,
    body,
    head: prepared.branch_name,
    base: prepared.default_branch,
    draft: true,
  })
  const detail = await client.getPullRequestDetail(prepared.repo_owner, prepared.repo_name, pr.number)
  if (!ownedOpenDraftPr(detail, prepared, runId, decisionId)) {
    throw new KernelError('INVALID_STATE', 'CTS Draft PR receipt mismatch')
  }
  return {
    output: { pr_number: pr.number, pr_url: pr.html_url } as unknown as Record<string, unknown>,
    costActualUsd: 0,
  }
}

async function recordStep(
  deps: PageApplyCtsGithubDeps,
  clientId: string,
  runId: string,
  decisionId: string,
  input: RunInput,
  prior: Readonly<Record<string, Record<string, unknown>>>,
): Promise<CapabilityStepResult> {
  assertRolloutEnabled(deps)
  const prepared = prepareOutput(prior)
  const committed = prior.commit as unknown as CommitOutput | undefined
  const opened = prior.open_pr as unknown as OpenPrOutput | undefined
  if (!committed || !opened) {
    throw new KernelError('INVALID_STATE', 'CTS GitHub commit/open_pr receipt 缺失')
  }
  const client = await clientForOutput(deps, clientId, input)
  const [detail, files, base, head, tip] = await Promise.all([
    client.getPullRequestDetail(prepared.repo_owner, prepared.repo_name, opened.pr_number),
    client.getPullRequestFiles(prepared.repo_owner, prepared.repo_name, opened.pr_number),
    client.getFileContent(prepared.repo_owner, prepared.repo_name, prepared.content_path, prepared.default_branch),
    client.getFileContent(prepared.repo_owner, prepared.repo_name, prepared.content_path, prepared.branch_name),
    client.getBranchSha(prepared.repo_owner, prepared.repo_name, prepared.branch_name),
  ])
  const baseMeta = inspectCtsIntentForSlug(base.decodedContent, prepared.entry_slug)
  const headMeta = inspectCtsIntentForSlug(head.decodedContent, prepared.entry_slug)
  const checks: VerificationResult['checks'] = [
    { name: 'draft_pr_receipt', passed: ownedOpenDraftPr(detail, prepared, runId, decisionId) },
    { name: 'branch_tip_receipt', passed: tip === committed.commit_sha },
    {
      name: 'single_approved_file',
      passed: files.length === 1 && files[0]?.filename === prepared.content_path,
    },
    { name: 'base_blob_sha', passed: base.sha === prepared.page_version_token },
    {
      name: 'base_metadata',
      passed: baseMeta?.title === prepared.before.title &&
        baseMeta?.description === prepared.before.description &&
        baseMeta?.h1 === prepared.before.h1,
    },
    {
      name: 'head_metadata',
      passed: headMeta?.title === prepared.after.title &&
        headMeta?.description === prepared.after.description &&
        headMeta?.h1 === prepared.after.h1 &&
        head.sha === committed.content_sha &&
        head.decodedContent === prepared.patched_content,
    },
  ]
  const passed = checks.every((check) => check.passed)
  return {
    output: {
      provider: 'github',
      run_reference: `pr:${prepared.repo_owner}/${prepared.repo_name}#${opened.pr_number}`,
      pr_url: opened.pr_url,
    },
    verification: {
      method: 'page_apply_integrity',
      passed,
      checks,
      ...(passed ? {} : { failure_reason: 'CTS Draft PR 回读未匹配批准输入' }),
    },
    costActualUsd: 0,
  }
}

function errorStatus(error: unknown): number | null {
  return error && typeof error === 'object' && 'status' in error &&
    typeof (error as { status?: unknown }).status === 'number'
    ? (error as { status: number }).status : null
}

async function rollback(
  deps: PageApplyCtsGithubDeps,
  clientId: string,
  runId: string,
  decisionId: string,
  input: RunInput,
  prior: Readonly<Record<string, Record<string, unknown>>>,
): Promise<OutwardRollbackResult> {
  const prepared = prior.prepare as unknown as PrepareOutput | undefined
  if (!prepared) return { ok: true, rollbackKind: 'noop', detail: { reason: 'prepare_not_completed' } }
  try {
    assertRolloutEnabled(deps)
    const committed = prior.commit as unknown as CommitOutput | undefined
    if (!committed) {
      return {
        ok: false,
        rollbackKind: 'provider_native',
        detail: { reason: 'commit_outcome_unknown' },
        failure_reason: 'CTS rollback 拒绝：缺少不可变 commit receipt，需要人工核对 branch',
      }
    }
    const client = await clientForOutput(deps, clientId, input)
    const opened = prior.open_pr as unknown as OpenPrOutput | undefined
    const candidates = await client.listPullRequestsByHead(
      prepared.repo_owner,
      prepared.repo_name,
      prepared.branch_name,
      'all',
    )
    const details = await Promise.all(candidates.map((candidate) =>
      client.getPullRequestDetail(prepared.repo_owner, prepared.repo_name, candidate.number)))
    if (
      (details.length > 0 && !opened) ||
      (opened && (
        details.length !== 1 || details[0]?.number !== opened.pr_number ||
        !ownedPrIdentity(details[0], prepared, runId, decisionId)
      ))
    ) {
      return {
        ok: false,
        rollbackKind: 'provider_native',
        detail: { reason: 'pr_not_owned_or_merged' },
        failure_reason: 'CTS rollback 拒绝：branch 上存在 foreign、ready 或 merged PR',
      }
    }
    let tip: string | null = null
    try {
      tip = await client.getBranchSha(prepared.repo_owner, prepared.repo_name, prepared.branch_name)
    } catch (error) {
      if (errorStatus(error) !== 404) throw error
    }
    if (tip === null) {
      for (const detail of details) {
        if (detail.state === 'open') {
          await client.closePullRequest(prepared.repo_owner, prepared.repo_name, detail.number)
        }
      }
      return {
        ok: true,
        rollbackKind: details.length > 0 ? 'provider_native' : 'noop',
        detail: { reason: details.length > 0 ? 'owned_draft_closed_branch_absent' : 'branch_absent' },
      }
    }
    if (tip !== committed.commit_sha) {
      return {
        ok: false,
        rollbackKind: 'provider_native',
        detail: { reason: 'branch_not_owned' },
        failure_reason: 'CTS rollback 拒绝：branch tip 已偏离持久化 commit receipt',
      }
    }
    const commit = await client.getCommit(prepared.repo_owner, prepared.repo_name, tip)
    if (commit.message !== commitMessage(runId, prepared.entry_slug)) {
      return {
        ok: false,
        rollbackKind: 'provider_native',
        detail: { reason: 'branch_not_owned' },
        failure_reason: 'CTS rollback 拒绝：commit marker 不属于当前 Kernel run',
      }
    }
    for (const detail of details) {
      if (detail.state === 'open') {
        await client.closePullRequest(prepared.repo_owner, prepared.repo_name, detail.number)
      }
    }
    let finalTip: string | null = null
    try {
      finalTip = await client.getBranchSha(
        prepared.repo_owner,
        prepared.repo_name,
        prepared.branch_name,
      )
    } catch (error) {
      if (errorStatus(error) !== 404) throw error
    }
    if (finalTip === null) {
      return {
        ok: true,
        rollbackKind: 'provider_native',
        detail: { reason: 'owned_draft_closed_branch_already_absent' },
      }
    }
    if (finalTip !== committed.commit_sha) {
      return {
        ok: false,
        rollbackKind: 'provider_native',
        detail: { reason: 'branch_changed_during_rollback' },
        failure_reason: 'CTS rollback 拒绝：关闭 PR 后 branch tip 发生漂移，未删除 branch',
      }
    }
    await client.deleteBranch(prepared.repo_owner, prepared.repo_name, prepared.branch_name)
    return { ok: true, rollbackKind: 'provider_native', detail: { reason: 'draft_pr_closed_branch_deleted' } }
  } catch {
    return {
      ok: false,
      rollbackKind: 'provider_native',
      detail: { reason: 'rollback_failed' },
      failure_reason: 'CTS GitHub rollback 失败；需要人工核对 Draft PR/branch，禁止自动猜测',
    }
  }
}

export function createPageApplyCtsGithubCapability(
  overrides: Partial<PageApplyCtsGithubDeps> = {},
): CapabilityImplementation {
  const deps: PageApplyCtsGithubDeps = { ...defaultCtsGithubDeps(), ...overrides }
  return {
    actionKey: 'page.apply_cts_github_metadata_request',
    version: 2,
    steps: {
      prepare: ({ ctx, runInput }) => prepareStep(
        deps,
        ctx.clientId,
        ctx.runId,
        parseInput(runInput),
      ),
      commit: ({ ctx, runInput, priorOutputs }) =>
        commitStep(deps, ctx.clientId, ctx.runId, parseInput(runInput), priorOutputs),
      open_pr: ({ ctx, runInput, priorOutputs }) => openPrStep(
        deps,
        ctx.clientId,
        ctx.runId,
        ctx.decisionId,
        parseInput(runInput),
        priorOutputs,
      ),
      record: ({ ctx, runInput, priorOutputs }) => recordStep(
        deps,
        ctx.clientId,
        ctx.runId,
        ctx.decisionId,
        parseInput(runInput),
        priorOutputs,
      ),
    },
    rollback: ({ ctx, runInput }, priorOutputs) => rollback(
      deps,
      ctx.clientId,
      ctx.runId,
      ctx.decisionId,
      parseInput(runInput),
      priorOutputs,
    ),
  }
}

export type { CtsGithubClient, CtsGithubConnection, PageApplyCtsGithubDeps } from './deps'
