import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  cancelWithSocialProvider,
  inspectSocialPublishingProvider,
  querySocialPublication,
  readSocialEngagement,
  scheduleWithSocialProvider,
  type SocialPostIdentity,
  type SocialPublishingProvider,
  type SocialScheduleInput,
} from '../social-publishing-provider'

const TEXT = 'A governed social post.'
const HASH = createHash('sha256').update(TEXT).digest('hex')
const scheduleInput: SocialScheduleInput = {
  clientId: 'client-1',
  contentPostId: 'content-1',
  accountRef: 'account-1',
  platform: 'facebook',
  text: TEXT,
  approvedContentSha256: HASH,
  scheduledAt: '2026-08-22T02:00:00.000Z',
}
const identity: SocialPostIdentity = {
  clientId: scheduleInput.clientId,
  contentPostId: scheduleInput.contentPostId,
  providerPostId: 'provider-post-1',
  accountRef: scheduleInput.accountRef,
  platform: scheduleInput.platform,
}

function fakeProvider(
  overrides: Partial<SocialPublishingProvider> = {},
): SocialPublishingProvider {
  return {
    providerId: 'fake-social',
    schedule: vi.fn().mockResolvedValue({
      providerJobId: 'job-1',
      providerPostId: identity.providerPostId,
      accountRef: identity.accountRef,
      platform: identity.platform,
      contentSha256: HASH,
      scheduledAt: scheduleInput.scheduledAt,
    }),
    queryPublication: vi.fn().mockResolvedValue({
      ...identity,
      publicationStatus: 'published',
      observedAt: '2026-08-22T03:00:00.000Z',
      publishedAt: '2026-08-22T02:30:00.000Z',
      contentSha256: HASH,
    }),
    cancel: vi.fn().mockResolvedValue({
      ...identity,
      cancellationStatus: 'cancelled',
      cancelledAt: '2026-08-22T04:00:00.000Z',
    }),
    readEngagement: vi.fn().mockResolvedValue({
      ...identity,
      observedAt: '2026-08-29T02:00:00.000Z',
      likes: 5,
      comments: 2,
      shares: 1,
    }),
    ...overrides,
  }
}

describe('SocialPublishingProvider local contract', () => {
  it('inspects all four operations without calling the provider', () => {
    const provider = fakeProvider()
    expect(inspectSocialPublishingProvider(provider)).toEqual({
      status: 'ready', value: { providerId: 'fake-social' },
    })
    expect(provider.schedule).not.toHaveBeenCalled()
    expect(provider.queryPublication).not.toHaveBeenCalled()
    expect(provider.cancel).not.toHaveBeenCalled()
    expect(provider.readEngagement).not.toHaveBeenCalled()
  })

  it('uses the exact identity for publication, cancellation, and engagement reads', async () => {
    const provider = fakeProvider()
    await expect(scheduleWithSocialProvider(provider, scheduleInput)).resolves.toMatchObject({
      status: 'ready', value: { providerPostId: identity.providerPostId },
    })
    await expect(querySocialPublication(provider, identity)).resolves.toMatchObject({
      status: 'ready', value: { publicationStatus: 'published' },
    })
    await expect(cancelWithSocialProvider(provider, identity)).resolves.toMatchObject({
      status: 'ready', value: { cancellationStatus: 'cancelled' },
    })
    await expect(readSocialEngagement(provider, identity)).resolves.toMatchObject({
      status: 'ready', value: { likes: 5, comments: 2, shares: 1 },
    })
    expect(provider.queryPublication).toHaveBeenCalledWith(identity)
    expect(provider.cancel).toHaveBeenCalledWith(identity)
    expect(provider.readEngagement).toHaveBeenCalledWith(identity)
  })

  it('fails closed when cancellation is unavailable and does not schedule', async () => {
    const complete = fakeProvider()
    const provider = { ...complete, cancel: undefined }
    await expect(scheduleWithSocialProvider(provider, scheduleInput)).resolves.toEqual({
      status: 'not_ready', operation: 'schedule', reason: 'cancellation_unavailable',
    })
    expect(complete.schedule).not.toHaveBeenCalled()
  })

  it('fails closed when schedule returns no exact providerPostId', async () => {
    const schedule = vi.fn().mockResolvedValue({
      providerJobId: 'job-only',
      accountRef: identity.accountRef,
      platform: identity.platform,
      contentSha256: HASH,
      scheduledAt: scheduleInput.scheduledAt,
    })
    await expect(scheduleWithSocialProvider(fakeProvider({ schedule }), scheduleInput))
      .resolves.toEqual({
        status: 'not_ready', operation: 'schedule', reason: 'exact_post_id_unavailable',
      })
    expect(schedule).toHaveBeenCalledTimes(1)
  })

  it('rejects bad content evidence before traffic and never retries failures', async () => {
    const schedule = vi.fn().mockRejectedValue(new Error('provider unavailable'))
    const provider = fakeProvider({ schedule })
    await expect(scheduleWithSocialProvider(provider, {
      ...scheduleInput,
      approvedContentSha256: 'b'.repeat(64),
    })).resolves.toEqual({
      status: 'not_ready', operation: 'schedule', reason: 'input_invalid',
    })
    expect(schedule).not.toHaveBeenCalled()
    await expect(scheduleWithSocialProvider(provider, scheduleInput)).resolves.toEqual({
      status: 'not_ready', operation: 'schedule', reason: 'provider_error',
    })
    expect(schedule).toHaveBeenCalledTimes(1)
  })

  it('rejects foreign receipt identities and malformed engagement counters', async () => {
    const foreign = fakeProvider({
      queryPublication: vi.fn().mockResolvedValue({
        ...identity,
        providerPostId: 'foreign-post',
        publicationStatus: 'published',
        observedAt: '2026-08-22T03:00:00.000Z',
        publishedAt: '2026-08-22T02:30:00.000Z',
        contentSha256: HASH,
      }),
    })
    await expect(querySocialPublication(foreign, identity)).resolves.toEqual({
      status: 'not_ready', operation: 'query_publication', reason: 'identity_mismatch',
    })
    const invalidCounters = fakeProvider({
      readEngagement: vi.fn().mockResolvedValue({
        ...identity,
        observedAt: '2026-08-29T02:00:00.000Z',
        likes: -1,
        comments: 2,
        shares: 1,
      }),
    })
    await expect(readSocialEngagement(invalidCounters, identity)).resolves.toEqual({
      status: 'not_ready', operation: 'read_engagement', reason: 'receipt_invalid',
    })
  })
})
