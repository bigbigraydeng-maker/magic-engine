import { KernelError } from '@/lib/kernel/errors'
import type {
  CapabilityImplementation,
  CapabilityStepContext,
  CapabilityStepResult,
  OutwardRollbackResult,
} from '@/lib/kernel/types'
import {
  cancelWithSocialProvider,
  inspectSocialPublishingProvider,
  isValidSocialScheduleInput,
  querySocialPublication,
  scheduleWithSocialProvider,
  type SocialPostIdentity,
} from '@/lib/social/social-publishing-provider'

interface RunInput {
  readonly content_post_id: string
  readonly account_ref: string
  readonly platform: string
  readonly text: string
  readonly approved_content_sha256: string
  readonly scheduled_at: string
}

interface ScheduleOutput {
  readonly provider_id: string
  readonly provider_job_id: string
  readonly provider_post_id: string
  readonly content_post_id: string
  readonly account_ref: string
  readonly platform: string
  readonly content_sha256: string
  readonly scheduled_at: string
}

export interface LocalSocialCapabilityConfig {
  readonly provider: unknown
  readonly gate: { readonly enabled: boolean; readonly scope: 'local_test' | 'disabled' }
}

function parseInput(value: Readonly<Record<string, unknown>>): RunInput {
  const keys: readonly (keyof RunInput)[] = [
    'content_post_id', 'account_ref', 'platform', 'text',
    'approved_content_sha256', 'scheduled_at',
  ]
  if (keys.some((key) => typeof value[key] !== 'string' || !value[key].trim())) {
    throw new KernelError('INVALID_INPUT', 'Social Action 输入缺字段或含空值')
  }
  return {
    content_post_id: value.content_post_id as string,
    account_ref: value.account_ref as string,
    platform: value.platform as string,
    text: value.text as string,
    approved_content_sha256: value.approved_content_sha256 as string,
    scheduled_at: value.scheduled_at as string,
  }
}

function requireProvider(provider: unknown): string {
  const result = inspectSocialPublishingProvider(provider)
  if (result.status === 'not_ready') {
    throw new KernelError(
      'INVALID_STATE',
      `NOT READY: Social provider ${result.operation}/${result.reason}`,
    )
  }
  return result.value.providerId
}

function readScheduleOutput(value: unknown): ScheduleOutput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const keys: readonly (keyof ScheduleOutput)[] = [
    'provider_id', 'provider_job_id', 'provider_post_id', 'content_post_id',
    'account_ref', 'platform', 'content_sha256', 'scheduled_at',
  ]
  if (keys.some((key) => typeof row[key] !== 'string' || !row[key].trim())) return null
  return row as unknown as ScheduleOutput
}

function receiptIdentity(
  step: CapabilityStepContext,
  receipt: ScheduleOutput,
): SocialPostIdentity | null {
  const input = parseInput(step.runInput)
  if (receipt.content_post_id !== input.content_post_id ||
      receipt.account_ref !== input.account_ref || receipt.platform !== input.platform ||
      receipt.content_sha256 !== input.approved_content_sha256 ||
      receipt.scheduled_at !== input.scheduled_at) return null
  return {
    clientId: step.ctx.clientId,
    contentPostId: input.content_post_id,
    providerPostId: receipt.provider_post_id,
    accountRef: input.account_ref,
    platform: input.platform,
  }
}

async function preflight(
  provider: unknown,
  step: CapabilityStepContext,
): Promise<CapabilityStepResult> {
  const input = parseInput(step.runInput)
  const valid = isValidSocialScheduleInput({
    clientId: step.ctx.clientId,
    contentPostId: input.content_post_id,
    accountRef: input.account_ref,
    platform: input.platform,
    text: input.text,
    approvedContentSha256: input.approved_content_sha256,
    scheduledAt: input.scheduled_at,
  })
  if (!valid) throw new KernelError('INVALID_INPUT', 'Social Action 文本指纹或时间无效')
  return { output: { provider_id: requireProvider(provider), local_only: true } }
}

async function schedule(
  provider: unknown,
  step: CapabilityStepContext,
): Promise<CapabilityStepResult> {
  const input = parseInput(step.runInput)
  const providerId = requireProvider(provider)
  const result = await scheduleWithSocialProvider(provider, {
    clientId: step.ctx.clientId,
    contentPostId: input.content_post_id,
    accountRef: input.account_ref,
    platform: input.platform,
    text: input.text,
    approvedContentSha256: input.approved_content_sha256,
    scheduledAt: input.scheduled_at,
  })
  if (result.status === 'not_ready') {
    throw new KernelError('INVALID_STATE', `NOT READY: Social schedule ${result.reason}`)
  }
  return { output: {
    provider_id: providerId,
    provider_job_id: result.value.providerJobId,
    provider_post_id: result.value.providerPostId,
    content_post_id: input.content_post_id,
    account_ref: result.value.accountRef,
    platform: result.value.platform,
    content_sha256: result.value.contentSha256,
    scheduled_at: result.value.scheduledAt,
  } }
}

async function verify(
  provider: unknown,
  step: CapabilityStepContext,
): Promise<CapabilityStepResult> {
  const receipt = readScheduleOutput(step.priorOutputs.schedule)
  const identity = receipt ? receiptIdentity(step, receipt) : null
  if (!receipt || !identity || requireProvider(provider) !== receipt.provider_id) {
    throw new KernelError('INVALID_STATE', 'NOT READY: 缺少本次 run 的精确 schedule 回执')
  }
  const result = await querySocialPublication(provider, identity)
  if (result.status === 'not_ready') {
    throw new KernelError('INVALID_STATE', `NOT READY: Social query ${result.reason}`)
  }
  const hashMatches = result.value.contentSha256 === receipt.content_sha256
  const statusMatches = ['scheduled', 'published'].includes(result.value.publicationStatus)
  const passed = hashMatches && statusMatches
  return {
    output: {
      ...receipt,
      publication_status: result.value.publicationStatus,
      observed_at: result.value.observedAt,
    },
    verification: {
      method: 'social_schedule_integrity',
      passed,
      checks: [
        { name: 'exact_post_identity', passed: true },
        { name: 'approved_content_hash', passed: hashMatches },
        { name: 'publication_scheduled_or_live', passed: statusMatches },
      ],
      ...(passed ? {} : { failure_reason: '精确帖子状态或批准内容指纹不匹配' }),
    },
  }
}

async function rollback(
  provider: unknown,
  step: CapabilityStepContext,
  outputs: Readonly<Record<string, Record<string, unknown>>>,
): Promise<OutwardRollbackResult> {
  const receipt = readScheduleOutput(outputs.schedule)
  if (!receipt) {
    if (outputs.preflight) return {
      ok: false,
      rollbackKind: 'provider_native',
      detail: { reason: 'exact_schedule_receipt_unavailable' },
      failure_reason: '排程可能已发生但没有精确 providerPostId；禁止猜测撤销目标',
    }
    return { ok: true, rollbackKind: 'noop', detail: { reason: 'schedule_not_reached' } }
  }
  const identity = receiptIdentity(step, receipt)
  const inspection = inspectSocialPublishingProvider(provider)
  if (!identity || inspection.status === 'not_ready' ||
      inspection.value.providerId !== receipt.provider_id) return {
    ok: false,
    rollbackKind: 'provider_native',
    detail: { reason: 'exact_schedule_identity_unusable' },
    failure_reason: '本次 run 的精确排程身份不完整或 provider 不匹配；未调用撤销',
  }
  const result = await cancelWithSocialProvider(provider, identity)
  if (result.status === 'not_ready') return {
    ok: false,
    rollbackKind: 'provider_native',
    detail: { provider_post_id: identity.providerPostId, reason: result.reason },
    failure_reason: `精确帖子撤销 NOT READY: ${result.reason}`,
  }
  return {
    ok: true,
    rollbackKind: 'provider_native',
    detail: {
      provider_post_id: result.value.providerPostId,
      cancellation_status: result.value.cancellationStatus,
      cancelled_at: result.value.cancelledAt,
    },
  }
}

export function createLocalSocialScheduleCapability(
  config: LocalSocialCapabilityConfig,
): CapabilityImplementation | null {
  const enabled = config.gate.enabled && config.gate.scope === 'local_test' &&
    process.env.NODE_ENV !== 'production'
  if (!enabled) return null
  return {
    actionKey: 'social.schedule_approved_post',
    version: 1,
    steps: {
      preflight: (step) => preflight(config.provider, step),
      schedule: (step) => schedule(config.provider, step),
      verify: (step) => verify(config.provider, step),
    },
    rollback: (step, outputs) => rollback(config.provider, step, outputs),
  }
}
