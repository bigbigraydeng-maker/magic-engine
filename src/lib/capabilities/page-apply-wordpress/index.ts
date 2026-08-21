import { KernelError } from '@/lib/kernel/errors'
import type {
  CapabilityImplementation,
  CapabilityStepResult,
  OutwardRollbackResult,
  VerificationResult,
} from '@/lib/kernel/types'
import {
  diffPageChange,
  draftPageChange,
  type PageOptimizationField,
  type PageOptimizationIntent,
  type WordpressPageSnapshot,
} from '@/lib/page-optimization'
import type {
  ExistingWordpressPost,
  UpdateExistingWordpressPostInput,
  WordpressPostType,
} from '@/lib/cms/wordpress-client'
import { canonicalDiffHash } from '@/lib/capabilities/page-apply-optimization/hash'
import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'
import type { GrowthJsonValue } from '@/lib/growth'
import {
  defaultWordpressDeps,
  type PageApplyWordpressDeps,
  type WordpressConnectionResolution,
} from './deps'

interface WordpressRunInput {
  readonly page_url: string
  readonly page_version_token: string
  readonly validated_diff_hash: string
  readonly intents: readonly PageOptimizationIntent[]
  readonly do_not_touch: readonly PageOptimizationField[]
  readonly wordpress_post_id: number
  readonly wordpress_post_type: WordpressPostType
  readonly authorization_context: Readonly<Record<string, unknown>>
}

interface PrepareOutput {
  readonly page_url: string
  readonly post_id: number
  readonly post_type: WordpressPostType
  readonly before_modified: string
  readonly before: { readonly seo_title: string; readonly seo_description: string }
  readonly after: { readonly seo_title: string; readonly seo_description: string }
}

interface ApplyOutput {
  readonly post_id: number
  readonly post_type: WordpressPostType
  readonly link: string
  readonly modified: string
  readonly previous_modified: string
  readonly updated_fields: readonly string[]
}

const FIELDS: ReadonlySet<string> = new Set(['meta_title', 'meta_description', 'content_html'])

function parseInput(value: Readonly<Record<string, unknown>>): WordpressRunInput {
  const intents = value.intents
  const doNotTouch = value.do_not_touch
  const postId = value.wordpress_post_id
  const postType = value.wordpress_post_type
  const context = value.authorization_context
  if (
    typeof value.page_url !== 'string' || !value.page_url.trim() ||
    typeof value.page_version_token !== 'string' || !value.page_version_token.trim() ||
    typeof value.validated_diff_hash !== 'string' || !value.validated_diff_hash.trim() ||
    !Array.isArray(intents) || intents.length === 0 ||
    !Array.isArray(doNotTouch) ||
    !Number.isInteger(postId) || (postId as number) <= 0 ||
    (postType !== 'post' && postType !== 'page') ||
    !context || typeof context !== 'object' || Array.isArray(context)
  ) {
    throw new KernelError('INVALID_INPUT', 'WordPress 页面优化输入缺字段或类型不正确')
  }
  const seen = new Set<string>()
  for (const intent of intents) {
    if (!intent || typeof intent !== 'object' || Array.isArray(intent)) {
      throw new KernelError('INVALID_INPUT', 'WordPress 页面优化 intents 形状不正确')
    }
    const candidate = intent as Record<string, unknown>
    if (!FIELDS.has(String(candidate.field)) || typeof candidate.proposedValue !== 'string') {
      throw new KernelError('INVALID_INPUT', 'WordPress 页面优化 intent 字段或值不正确')
    }
    if (candidate.field === 'content_html') {
      throw new KernelError(
        'INVALID_INPUT',
        'WordPress Page Apply v2 当前只允许 meta_title / meta_description；正文回滚尚未达到安全标准',
      )
    }
    if (seen.has(String(candidate.field))) {
      throw new KernelError('INVALID_INPUT', 'WordPress 页面优化 intent 字段重复')
    }
    seen.add(String(candidate.field))
  }
  if (doNotTouch.some((field) => typeof field !== 'string' || !FIELDS.has(field))) {
    throw new KernelError('INVALID_INPUT', 'WordPress 页面优化 do_not_touch 含非法字段')
  }
  return {
    page_url: value.page_url,
    page_version_token: value.page_version_token,
    validated_diff_hash: value.validated_diff_hash,
    intents: intents as readonly PageOptimizationIntent[],
    do_not_touch: doNotTouch as readonly PageOptimizationField[],
    wordpress_post_id: postId as number,
    wordpress_post_type: postType,
    authorization_context: context as Readonly<Record<string, unknown>>,
  }
}

function normalizedUrl(value: string): string | null {
  try {
    const url = new URL(value)
    url.hash = ''
    url.search = ''
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    return url.toString().replace(/\/$/, url.pathname === '/' ? '/' : '')
  } catch {
    return null
  }
}

function assertExactPage(post: ExistingWordpressPost, input: WordpressRunInput): void {
  if (post.postId !== input.wordpress_post_id || post.postType !== input.wordpress_post_type) {
    throw new KernelError('INVALID_INPUT', 'WordPress post identity 与已授权 target 不一致')
  }
  const expected = normalizedUrl(input.page_url)
  const actual = normalizedUrl(post.link)
  if (!expected || !actual || expected !== actual) {
    throw new KernelError(
      'INVALID_INPUT',
      `WordPress post URL 与已授权 page_url 不一致（expected=${input.page_url}, actual=${post.link}）`,
    )
  }
  if (post.status !== 'publish') {
    throw new KernelError('INVALID_INPUT', 'WordPress target 不再是已发布页面，拒绝继续写入')
  }
}

function assertAuthorizationContext(
  deps: PageApplyWordpressDeps,
  input: WordpressRunInput,
  clientId: string,
): void {
  const context = input.authorization_context
  const { authorization_proof: authorizationProof, ...unsignedContext } = context
  const receipt = context.source_receipt
  const sourceBinding = context.source_binding
  const lineage = context.growth_lineage
  const authorizedAction = context.authorized_action
  const actionDigest = context.action_digest
  const sourceId = receipt && typeof receipt === 'object' && !Array.isArray(receipt)
    ? (receipt as Record<string, unknown>).evidence_source_id
    : null
  const finding = lineage && typeof lineage === 'object' && !Array.isArray(lineage)
    ? (lineage as Record<string, unknown>).finding
    : null
  const findingHash = lineage && typeof lineage === 'object' && !Array.isArray(lineage)
    ? (lineage as Record<string, unknown>).finding_hash
    : null
  const prescription = lineage && typeof lineage === 'object' && !Array.isArray(lineage)
    ? (lineage as Record<string, unknown>).prescription
    : null
  const evidence = finding && typeof finding === 'object' && !Array.isArray(finding)
    ? (finding as Record<string, unknown>).evidence
    : null
  const evidenceContainsSource = typeof sourceId === 'string' && Array.isArray(evidence) &&
    evidence.some((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false
      const source = (item as Record<string, unknown>).source
      return source !== null && typeof source === 'object' && !Array.isArray(source) &&
        (source as Record<string, unknown>).sourceId === sourceId
    })
  const sourceBindingComplete = sourceBinding !== null && typeof sourceBinding === 'object' &&
    !Array.isArray(sourceBinding) &&
    ['client_source', 'page_ledger_source', 'connection_source', 'post_source'].every((key) => {
      const value = (sourceBinding as Record<string, unknown>)[key]
      return typeof value === 'string' && value.trim().length > 0
    })
  const actualAction = {
    page_url: input.page_url,
    page_version_token: input.page_version_token,
    validated_diff_hash: input.validated_diff_hash,
    intents: input.intents,
    do_not_touch: input.do_not_touch,
    wordpress_post_id: input.wordpress_post_id,
    wordpress_post_type: input.wordpress_post_type,
  }
  const authorizedActionMatches = authorizedAction !== null &&
    typeof authorizedAction === 'object' && !Array.isArray(authorizedAction) &&
    typeof actionDigest === 'string' &&
    actionDigest === canonicalHashOfInput(authorizedAction) &&
    actionDigest === canonicalHashOfInput(actualAction)
  if (
    context.validation_passed !== true ||
    context.client_id !== clientId ||
    context.target_page_url !== input.page_url ||
    typeof context.page_ledger_ref !== 'string' || !context.page_ledger_ref.trim() ||
    !receipt || typeof receipt !== 'object' || Array.isArray(receipt) ||
    Object.keys(receipt as object).length === 0 ||
    !sourceBindingComplete ||
    !finding || typeof finding !== 'object' || Array.isArray(finding) ||
    !prescription || typeof prescription !== 'object' || Array.isArray(prescription) ||
    typeof findingHash !== 'string' || findingHash !== canonicalHashOfInput(finding) ||
    !evidenceContainsSource ||
    !authorizedActionMatches ||
    !deps.verifyAuthorizationProof(unsignedContext as unknown as GrowthJsonValue, authorizationProof)
  ) {
    throw new KernelError(
      'INVALID_INPUT',
      'WordPress authorization_context 未绑定 validation/client/page/source/evidence lineage',
    )
  }
}

async function requireConnection(
  deps: PageApplyWordpressDeps,
  clientId: string,
): Promise<WordpressConnectionResolution> {
  const connection = await deps.resolveConnection(clientId)
  if (!connection) throw new KernelError('INVALID_INPUT', '该客户没有 WordPress 连接')
  if (connection.status !== 'connected') {
    throw new KernelError('INVALID_INPUT', 'WordPress 连接未处于 verified connected 状态')
  }
  if (!connection.yoastPluginInstalled) {
    throw new KernelError('INVALID_INPUT', 'WordPress 连接未确认 Yoast meta 可写')
  }
  if (!await deps.supportsAtomicApply(connection.config)) {
    throw new KernelError(
      'INVALID_INPUT',
      'WordPress 连接未提供 Magic Engine 原子版本检查端点；禁止退回非原子写入',
    )
  }
  return connection
}

function snapshotOf(post: ExistingWordpressPost): WordpressPageSnapshot {
  return {
    ok: true,
    provider: 'wordpress',
    fetchedAt: new Date().toISOString(),
    rawFields: {
      title: post.title,
      content: post.content,
      seoTitle: post.seoTitle ?? '',
      seoDescription: post.seoDescription ?? '',
    },
    versionToken: post.modified,
  }
}

function valuesOf(post: ExistingWordpressPost): PrepareOutput['before'] {
  return {
    seo_title: post.seoTitle ?? '',
    seo_description: post.seoDescription ?? '',
  }
}

function valuesAfter(
  before: PrepareOutput['before'],
  intents: readonly PageOptimizationIntent[],
): PrepareOutput['after'] {
  const title = intents.find(({ field }) => field === 'meta_title')?.proposedValue
  const description = intents.find(({ field }) => field === 'meta_description')?.proposedValue
  return {
    seo_title: title ?? before.seo_title,
    seo_description: description ?? before.seo_description,
  }
}

function matches(post: ExistingWordpressPost, values: PrepareOutput['before']): boolean {
  return (post.seoTitle ?? '') === values.seo_title &&
    (post.seoDescription ?? '') === values.seo_description
}

async function prepareStep(
  deps: PageApplyWordpressDeps,
  clientId: string,
  input: WordpressRunInput,
): Promise<CapabilityStepResult> {
  assertAuthorizationContext(deps, input, clientId)
  const connection = await requireConnection(deps, clientId)
  const post = await deps.readPost(
    connection.config,
    input.wordpress_post_id,
    input.wordpress_post_type,
  )
  assertExactPage(post, input)
  if (post.modified !== input.page_version_token) {
    throw new KernelError('INVALID_INPUT', 'stale_snapshot：WordPress modified 已变化，请重新准备')
  }

  const snapshot = snapshotOf(post)
  const draft = draftPageChange(snapshot, input.intents)
  if (!draft.ok) throw new KernelError('INVALID_INPUT', `draft 失败：${draft.reason}`)
  const diff = diffPageChange(snapshot, draft)
  if (!diff.ok) throw new KernelError('INVALID_INPUT', `diff 失败：${diff.reason}`)
  const changed = new Set(diff.changes.filter((item) => item.changed).map(({ field }) => field))
  if (changed.size === 0) {
    throw new KernelError('INVALID_INPUT', 'WordPress 页面优化没有任何实际字段变化')
  }
  const forbidden = input.do_not_touch.filter((field) => changed.has(field))
  if (forbidden.length > 0) {
    throw new KernelError('INVALID_INPUT', `do_not_touch_violation：${forbidden.join(',')}`)
  }
  if (canonicalDiffHash(diff.changes) !== input.validated_diff_hash) {
    throw new KernelError('INVALID_INPUT', 'pipeline_regression：WordPress diff hash 与批准输入不一致')
  }

  const before = valuesOf(post)
  const output: PrepareOutput = {
    page_url: input.page_url,
    post_id: post.postId,
    post_type: post.postType,
    before_modified: post.modified,
    before,
    after: valuesAfter(before, input.intents),
  }
  return { output: output as unknown as Record<string, unknown>, costActualUsd: 0 }
}

function updateInput(output: PrepareOutput, values: PrepareOutput['after']): UpdateExistingWordpressPostInput {
  return {
    postId: output.post_id,
    postType: output.post_type,
    ...(values.seo_title !== output.before.seo_title ? { seoTitle: values.seo_title } : {}),
    ...(values.seo_description !== output.before.seo_description
      ? { seoDescription: values.seo_description }
      : {}),
  }
}

function rollbackInput(output: PrepareOutput): UpdateExistingWordpressPostInput {
  return {
    postId: output.post_id,
    postType: output.post_type,
    ...(output.before.seo_title !== output.after.seo_title
      ? { seoTitle: output.before.seo_title }
      : {}),
    ...(output.before.seo_description !== output.after.seo_description
      ? { seoDescription: output.before.seo_description }
      : {}),
  }
}

function expectedMeta(
  output: PrepareOutput,
  values: PrepareOutput['before'] | PrepareOutput['after'],
): { readonly seoTitle?: string; readonly seoDescription?: string } {
  return {
    ...(output.before.seo_title !== output.after.seo_title
      ? { seoTitle: values.seo_title }
      : {}),
    ...(output.before.seo_description !== output.after.seo_description
      ? { seoDescription: values.seo_description }
      : {}),
  }
}

async function applyStep(
  deps: PageApplyWordpressDeps,
  clientId: string,
  input: WordpressRunInput,
  priorOutputs: Readonly<Record<string, Record<string, unknown>>>,
): Promise<CapabilityStepResult> {
  const prepared = priorOutputs.prepare as unknown as PrepareOutput | undefined
  if (!prepared) throw new KernelError('INVALID_STATE', 'WordPress prepare output 缺失')
  const connection = await requireConnection(deps, clientId)
  const current = await deps.readPost(connection.config, prepared.post_id, prepared.post_type)
  assertExactPage(current, input)
  if (current.modified !== prepared.before_modified || !matches(current, prepared.before)) {
    throw new KernelError('INVALID_INPUT', 'stale_snapshot：prepare 后 WordPress 页面又发生变化')
  }
  const result = await deps.updatePost(
    connection.config,
    updateInput(prepared, prepared.after),
    prepared.before_modified,
    expectedMeta(prepared, prepared.before),
  )
  if (result.previousModified !== prepared.before_modified) {
    throw new KernelError('INVALID_STATE', 'WordPress 原子写入返回的 previous_modified 与批准版本不一致')
  }
  const output: ApplyOutput = {
    post_id: result.postId,
    post_type: result.postType,
    link: result.link,
    modified: result.modified,
    previous_modified: result.previousModified,
    updated_fields: result.updatedFields,
  }
  return { output: output as unknown as Record<string, unknown>, costActualUsd: 0 }
}

async function verifyStep(
  deps: PageApplyWordpressDeps,
  clientId: string,
  input: WordpressRunInput,
  priorOutputs: Readonly<Record<string, Record<string, unknown>>>,
): Promise<CapabilityStepResult> {
  const prepared = priorOutputs.prepare as unknown as PrepareOutput | undefined
  const applied = priorOutputs.apply as unknown as ApplyOutput | undefined
  if (!prepared || !applied) throw new KernelError('INVALID_STATE', 'WordPress prior output 缺失')
  const connection = await requireConnection(deps, clientId)
  const current = await deps.readPost(connection.config, prepared.post_id, prepared.post_type)
  assertExactPage(current, input)
  const checks: VerificationResult['checks'] = [
    { name: 'post_identity', passed: current.postId === prepared.post_id },
    { name: 'meta_title', passed: (current.seoTitle ?? '') === prepared.after.seo_title },
    {
      name: 'meta_description',
      passed: (current.seoDescription ?? '') === prepared.after.seo_description,
    },
    { name: 'modified_token', passed: current.modified === applied.modified },
  ]
  const passed = checks.every((check) => check.passed)
  const verification: VerificationResult = {
    method: 'page_apply_integrity',
    passed,
    checks,
    ...(passed ? {} : { failure_reason: 'WordPress 回读与已批准字段不一致' }),
  }
  return {
    output: {
      provider: 'wordpress',
      run_reference: `wordpress:${prepared.post_type}:${prepared.post_id}@${current.modified}`,
      page_url: prepared.page_url,
      updated_fields: applied.updated_fields,
    },
    verification,
    costActualUsd: 0,
  }
}

async function rollback(
  deps: PageApplyWordpressDeps,
  clientId: string,
  input: WordpressRunInput,
  priorOutputs: Readonly<Record<string, Record<string, unknown>>>,
): Promise<OutwardRollbackResult> {
  const prepared = priorOutputs.prepare as unknown as PrepareOutput | undefined
  const applied = priorOutputs.apply as unknown as ApplyOutput | undefined
  if (!prepared) return { ok: true, rollbackKind: 'noop', detail: { reason: 'prepare_not_completed' } }
  try {
    const connection = await requireConnection(deps, clientId)
    const current = await deps.readPost(connection.config, prepared.post_id, prepared.post_type)
    assertExactPage(current, input)
    if (matches(current, prepared.before)) {
      return { ok: true, rollbackKind: 'noop', detail: { reason: 'already_at_before_snapshot' } }
    }
    if (!applied) {
      return {
        ok: false,
        rollbackKind: 'provider_native',
        detail: { reason: 'apply_outcome_unknown' },
        failure_reason: 'WordPress apply 没有持久化回执且页面已不在 before 状态；拒绝猜测或覆盖',
      }
    }
    if (!matches(current, prepared.after)) {
      return {
        ok: false,
        rollbackKind: 'provider_native',
        detail: { reason: 'third_party_drift_detected' },
        failure_reason: 'WordPress 当前值既不是 before 也不是 approved after；拒绝覆盖第三方改动',
      }
    }
    if (current.modified !== applied.modified) {
      return {
        ok: false,
        rollbackKind: 'provider_native',
        detail: { reason: 'post_apply_version_drift_detected' },
        failure_reason: 'WordPress modified token 已在 apply 后变化；拒绝覆盖第三方同值保存',
      }
    }
    const rollbackResult = await deps.updatePost(
      connection.config,
      rollbackInput(prepared),
      applied.modified,
      expectedMeta(prepared, prepared.after),
    )
    if (rollbackResult.previousModified !== applied.modified) {
      return {
        ok: false,
        rollbackKind: 'provider_native',
        detail: { reason: 'rollback_version_ack_mismatch' },
        failure_reason: 'WordPress 原子回滚返回的 previous_modified 与 apply 版本不一致',
      }
    }
    const restored = await deps.readPost(connection.config, prepared.post_id, prepared.post_type)
    if (!matches(restored, prepared.before)) {
      return {
        ok: false,
        rollbackKind: 'provider_native',
        detail: { reason: 'restore_verification_failed' },
        failure_reason: 'WordPress snapshot restore 后回读不一致',
      }
    }
    return { ok: true, rollbackKind: 'provider_native', detail: { reason: 'snapshot_restored' } }
  } catch (error) {
    return {
      ok: false,
      rollbackKind: 'provider_native',
      detail: { reason: 'rollback_exception' },
      failure_reason: applied
        ? 'WordPress 原子回滚失败；详细 provider 诊断仅允许进入受保护日志'
        : 'WordPress apply 结果未知且只读辨别失败；需要人工核对，禁止自动覆盖',
    }
  }
}

export function createPageApplyWordpressCapability(
  overrides: Partial<PageApplyWordpressDeps> = {},
): CapabilityImplementation {
  const deps: PageApplyWordpressDeps = { ...defaultWordpressDeps(), ...overrides }
  return {
    actionKey: 'page.apply_wordpress_optimization_request',
    version: 1,
    steps: {
      prepare: ({ ctx, runInput }) => prepareStep(deps, ctx.clientId, parseInput(runInput)),
      apply: ({ ctx, runInput, priorOutputs }) =>
        applyStep(deps, ctx.clientId, parseInput(runInput), priorOutputs),
      verify: ({ ctx, runInput, priorOutputs }) =>
        verifyStep(deps, ctx.clientId, parseInput(runInput), priorOutputs),
    },
    rollback: ({ ctx, runInput }, priorOutputs) =>
      rollback(deps, ctx.clientId, parseInput(runInput), priorOutputs),
  }
}
