/**
 * Provider-neutral contract used by the local Social governed-action proof.
 * This module performs no network or database work and retries no operation.
 */

import { createHash } from 'node:crypto'

export type SocialPublishingOperation =
  | 'schedule'
  | 'query_publication'
  | 'cancel'
  | 'read_engagement'

export type SocialProviderNotReadyReason =
  | 'provider_invalid'
  | 'capability_missing'
  | 'input_invalid'
  | 'provider_error'
  | 'receipt_invalid'
  | 'identity_mismatch'
  | 'exact_post_id_unavailable'
  | 'cancellation_unavailable'

export interface SocialProviderNotReady {
  readonly status: 'not_ready'
  readonly operation: SocialPublishingOperation
  readonly reason: SocialProviderNotReadyReason
}

export type SocialProviderResult<T> =
  | { readonly status: 'ready'; readonly value: Readonly<T> }
  | SocialProviderNotReady

export interface SocialScheduleInput {
  readonly clientId: string
  readonly contentPostId: string
  readonly accountRef: string
  readonly platform: string
  readonly text: string
  readonly approvedContentSha256: string
  readonly scheduledAt: string
}

export interface SocialScheduleProviderResponse {
  readonly providerJobId: string
  readonly providerPostId?: string
  readonly accountRef: string
  readonly platform: string
  readonly contentSha256: string
  readonly scheduledAt: string
}

export interface SocialScheduleReceipt extends SocialScheduleProviderResponse {
  readonly providerPostId: string
}

export interface SocialPostIdentity {
  readonly clientId: string
  readonly contentPostId: string
  readonly providerPostId: string
  readonly accountRef: string
  readonly platform: string
}

export interface SocialPublicationObservation extends SocialPostIdentity {
  readonly publicationStatus: 'scheduled' | 'published' | 'cancelled' | 'failed'
  readonly observedAt: string
  readonly publishedAt: string | null
  readonly contentSha256: string
}

export interface SocialCancellationReceipt extends SocialPostIdentity {
  readonly cancellationStatus: 'cancelled' | 'already_cancelled'
  readonly cancelledAt: string
}

export interface SocialEngagementObservation extends SocialPostIdentity {
  readonly observedAt: string
  readonly likes: number
  readonly comments: number
  readonly shares: number
}

export interface SocialPublishingProvider {
  readonly providerId: string
  schedule(input: SocialScheduleInput): Promise<SocialScheduleProviderResponse>
  queryPublication(input: SocialPostIdentity): Promise<SocialPublicationObservation>
  cancel(input: SocialPostIdentity): Promise<SocialCancellationReceipt>
  readEngagement(input: SocialPostIdentity): Promise<SocialEngagementObservation>
}

type ProviderMethod = Exclude<keyof SocialPublishingProvider, 'providerId'>
const trustedFailures = new WeakSet<object>()

function notReady(
  operation: SocialPublishingOperation,
  reason: SocialProviderNotReadyReason,
): SocialProviderNotReady {
  const result = Object.freeze({ status: 'not_ready' as const, operation, reason })
  trustedFailures.add(result)
  return result
}

function ready<T extends object>(value: T): SocialProviderResult<T> {
  return Object.freeze({ status: 'ready' as const, value: Object.freeze(value) })
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function validIso(value: unknown): value is string {
  return nonEmpty(value) && !Number.isNaN(new Date(value).getTime())
}

function validIdentity(value: unknown): value is SocialPostIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return ['clientId', 'contentPostId', 'providerPostId', 'accountRef', 'platform']
    .every((key) => nonEmpty(row[key]))
}

function sameIdentity(expected: SocialPostIdentity, actual: SocialPostIdentity): boolean {
  return expected.clientId === actual.clientId &&
    expected.contentPostId === actual.contentPostId &&
    expected.providerPostId === actual.providerPostId &&
    expected.accountRef === actual.accountRef &&
    expected.platform === actual.platform
}

function getMethod(
  provider: unknown,
  method: ProviderMethod,
): ((input: never) => Promise<unknown>) | null {
  if (!provider || typeof provider !== 'object') return null
  const row = provider as Record<string, unknown>
  if (!nonEmpty(row.providerId) || typeof row[method] !== 'function') return null
  return (row[method] as (input: never) => Promise<unknown>).bind(provider)
}

function providerId(provider: unknown): string | null {
  if (!provider || typeof provider !== 'object') return null
  const value = (provider as Record<string, unknown>).providerId
  return nonEmpty(value) ? value : null
}

function operationFor(method: ProviderMethod): SocialPublishingOperation {
  if (method === 'queryPublication') return 'query_publication'
  if (method === 'readEngagement') return 'read_engagement'
  return method
}

function missingReason(method: ProviderMethod): SocialProviderNotReadyReason {
  return method === 'cancel' ? 'cancellation_unavailable' : 'capability_missing'
}

export function inspectSocialPublishingProvider(
  provider: unknown,
): SocialProviderResult<{ readonly providerId: string }> {
  const id = providerId(provider)
  if (!id) return notReady('schedule', 'provider_invalid')
  const methods: readonly ProviderMethod[] = [
    'schedule', 'queryPublication', 'cancel', 'readEngagement',
  ]
  for (const method of methods) {
    if (!getMethod(provider, method)) {
      return notReady(operationFor(method), missingReason(method))
    }
  }
  return ready({ providerId: id })
}

export function isValidSocialScheduleInput(input: SocialScheduleInput): boolean {
  const digest = createHash('sha256').update(input.text).digest('hex')
  return nonEmpty(input.clientId) && nonEmpty(input.contentPostId) &&
    nonEmpty(input.accountRef) && nonEmpty(input.platform) && nonEmpty(input.text) &&
    /^[a-f0-9]{64}$/.test(input.approvedContentSha256) &&
    digest === input.approvedContentSha256 && validIso(input.scheduledAt)
}

async function invoke(
  provider: unknown,
  method: ProviderMethod,
  input: object,
): Promise<unknown | SocialProviderNotReady> {
  const operation = operationFor(method)
  const callable = getMethod(provider, method)
  if (!callable) return notReady(operation, missingReason(method))
  try {
    return await callable(input as never)
  } catch {
    return notReady(operation, 'provider_error')
  }
}

function isTrustedFailure(value: unknown): value is SocialProviderNotReady {
  return Boolean(value && typeof value === 'object' && trustedFailures.has(value))
}

export async function scheduleWithSocialProvider(
  provider: unknown,
  input: SocialScheduleInput,
): Promise<SocialProviderResult<SocialScheduleReceipt>> {
  const inspection = inspectSocialPublishingProvider(provider)
  if (inspection.status === 'not_ready') return notReady('schedule', inspection.reason)
  if (!isValidSocialScheduleInput(input)) return notReady('schedule', 'input_invalid')
  const raw = await invoke(provider, 'schedule', input)
  if (isTrustedFailure(raw)) return raw
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return notReady('schedule', 'receipt_invalid')
  }
  const row = raw as Record<string, unknown>
  if (!nonEmpty(row.providerPostId)) {
    return notReady('schedule', 'exact_post_id_unavailable')
  }
  if (!nonEmpty(row.providerJobId) || !nonEmpty(row.accountRef) ||
      !nonEmpty(row.platform) || !nonEmpty(row.contentSha256) || !validIso(row.scheduledAt)) {
    return notReady('schedule', 'receipt_invalid')
  }
  if (row.accountRef !== input.accountRef || row.platform !== input.platform ||
      row.contentSha256 !== input.approvedContentSha256 || row.scheduledAt !== input.scheduledAt) {
    return notReady('schedule', 'identity_mismatch')
  }
  return ready({
    providerJobId: row.providerJobId,
    providerPostId: row.providerPostId,
    accountRef: row.accountRef,
    platform: row.platform,
    contentSha256: row.contentSha256,
    scheduledAt: row.scheduledAt,
  })
}

export async function querySocialPublication(
  provider: unknown,
  input: SocialPostIdentity,
): Promise<SocialProviderResult<SocialPublicationObservation>> {
  if (!providerId(provider)) return notReady('query_publication', 'provider_invalid')
  if (!validIdentity(input)) return notReady('query_publication', 'input_invalid')
  const raw = await invoke(provider, 'queryPublication', input)
  if (isTrustedFailure(raw)) return raw
  if (!validIdentity(raw) || !sameIdentity(input, raw)) {
    return notReady('query_publication', validIdentity(raw) ? 'identity_mismatch' : 'receipt_invalid')
  }
  const row = raw as SocialPublicationObservation
  const statuses: readonly SocialPublicationObservation['publicationStatus'][] = [
    'scheduled', 'published', 'cancelled', 'failed',
  ]
  const publishedAtValid = row.publicationStatus === 'published'
    ? validIso(row.publishedAt)
    : row.publishedAt === null
  if (!statuses.includes(row.publicationStatus) || !validIso(row.observedAt) ||
      !publishedAtValid || !/^[a-f0-9]{64}$/.test(row.contentSha256)) {
    return notReady('query_publication', 'receipt_invalid')
  }
  return ready({
    clientId: row.clientId,
    contentPostId: row.contentPostId,
    providerPostId: row.providerPostId,
    accountRef: row.accountRef,
    platform: row.platform,
    publicationStatus: row.publicationStatus,
    observedAt: row.observedAt,
    publishedAt: row.publishedAt,
    contentSha256: row.contentSha256,
  })
}

export async function cancelWithSocialProvider(
  provider: unknown,
  input: SocialPostIdentity,
): Promise<SocialProviderResult<SocialCancellationReceipt>> {
  if (!providerId(provider)) return notReady('cancel', 'provider_invalid')
  if (!validIdentity(input)) return notReady('cancel', 'input_invalid')
  const raw = await invoke(provider, 'cancel', input)
  if (isTrustedFailure(raw)) return raw
  if (!validIdentity(raw) || !sameIdentity(input, raw)) {
    return notReady('cancel', validIdentity(raw) ? 'identity_mismatch' : 'receipt_invalid')
  }
  const row = raw as SocialCancellationReceipt
  if (!['cancelled', 'already_cancelled'].includes(row.cancellationStatus) ||
      !validIso(row.cancelledAt)) return notReady('cancel', 'receipt_invalid')
  return ready({ ...input, cancellationStatus: row.cancellationStatus, cancelledAt: row.cancelledAt })
}

export async function readSocialEngagement(
  provider: unknown,
  input: SocialPostIdentity,
): Promise<SocialProviderResult<SocialEngagementObservation>> {
  if (!providerId(provider)) return notReady('read_engagement', 'provider_invalid')
  if (!validIdentity(input)) return notReady('read_engagement', 'input_invalid')
  const raw = await invoke(provider, 'readEngagement', input)
  if (isTrustedFailure(raw)) return raw
  if (!validIdentity(raw) || !sameIdentity(input, raw)) {
    return notReady('read_engagement', validIdentity(raw) ? 'identity_mismatch' : 'receipt_invalid')
  }
  const row = raw as SocialEngagementObservation
  const counters = [row.likes, row.comments, row.shares]
  if (!validIso(row.observedAt) || counters.some((value) => !Number.isInteger(value) || value < 0)) {
    return notReady('read_engagement', 'receipt_invalid')
  }
  return ready({
    ...input,
    observedAt: row.observedAt,
    likes: row.likes,
    comments: row.comments,
    shares: row.shares,
  })
}
