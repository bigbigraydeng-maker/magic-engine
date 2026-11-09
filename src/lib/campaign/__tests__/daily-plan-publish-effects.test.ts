import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/workflows/inngest-event', () => ({ sendInngestEvent: vi.fn() }))
vi.mock('@/lib/meta/page-posts', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/meta/page-posts')>()),
  publishPagePhotoPost: vi.fn(),
}))

import { publishPending, type PlanRow, type PublishCandidate } from '../daily-plan-publish-effects'
import { MISSED_WINDOW_ERROR, type CampaignDailyPublishCommand } from '../daily-plan-publish'
import { PagePublishError, publishPagePhotoPost } from '@/lib/meta/page-posts'

const mockPublish = vi.mocked(publishPagePhotoPost)

const candidate: PublishCandidate = {
  date: '2026-10-12',
  idempotency_key: 'key-1',
  image_asset_id: 'asset-1',
  cta_url: 'https://example.test/x',
  message: 'hello',
  firstCommentText: 'comment',
  judgedText: 'hello comment',
  imageUrl: 'https://example.test/i.jpg',
  imageSource: null,
}

function context(overrides: { now?: Date; allowImmediate?: boolean } = {}) {
  return {
    clientId: 'c0000000-0000-0000-0000-000000000000',
    pageId: '227633594573276',
    pageToken: 'token',
    row: { id: 'plan-1' } as unknown as PlanRow,
    command: { campaign_id: 'camp-1', date_offset_days: 0 } as unknown as CampaignDailyPublishCommand,
    ...overrides,
  }
}

afterEach(() => vi.clearAllMocks())

describe('publishPending — never publishes late when the caller forbids it', () => {
  it('🔴 a slot that already passed becomes MISSED_WINDOW and the provider is never called', async () => {
    // 2026-10-12 08:00 NZ has long passed relative to this instant
    const outcome = await publishPending([candidate], context({ now: new Date('2026-10-12T05:00:00Z'), allowImmediate: false }))

    expect(mockPublish).not.toHaveBeenCalled()
    expect(outcome.published).toEqual([])
    expect(outcome.failed).toHaveLength(1)
    expect(outcome.failed[0]).toMatchObject({ date: '2026-10-12', error: MISSED_WINDOW_ERROR, certainty: 'rejected' })
  })

  it('the manual default (allowImmediate unset) still publishes immediately when the slot has passed', async () => {
    mockPublish.mockRejectedValue(new Error('stop here'))
    await publishPending([candidate], context({ now: new Date('2026-10-12T05:00:00Z') }))
    expect(mockPublish).toHaveBeenCalledTimes(1)
    expect(mockPublish.mock.calls[0][0].scheduledPublishTime).toBeUndefined()
  })

  it('a future slot is still scheduled with Facebook even when immediate publishing is forbidden', async () => {
    mockPublish.mockRejectedValue(new Error('stop here'))
    await publishPending([candidate], context({ now: new Date('2026-10-11T00:00:00Z'), allowImmediate: false }))
    expect(mockPublish).toHaveBeenCalledTimes(1)
    expect(mockPublish.mock.calls[0][0].scheduledPublishTime).toBeInstanceOf(Date)
  })
})

describe('publishPending — failure certainty is recorded', () => {
  it('a classified Graph refusal keeps its certainty', async () => {
    mockPublish.mockRejectedValue(new PagePublishError('refused', { certainty: 'rejected', httpStatus: 400 }))
    const outcome = await publishPending([candidate], context({ now: new Date('2026-10-11T00:00:00Z') }))
    expect(outcome.failed[0].certainty).toBe('rejected')
  })

  it('🔴 an unclassified error is recorded as unknown (the Post may exist)', async () => {
    mockPublish.mockRejectedValue(new Error('socket hang up'))
    const outcome = await publishPending([candidate], context({ now: new Date('2026-10-11T00:00:00Z') }))
    expect(outcome.failed[0].certainty).toBe('unknown')
  })
})

describe('publishPending — the last-moment check', () => {
  it('🔴 a check that returns false means nothing is sent and the date is recorded as ABORTED_BEFORE_SEND', async () => {
    const outcome = await publishPending([candidate], { ...context({ now: new Date('2026-10-11T00:00:00Z') }), beforeSend: async () => false })
    expect(mockPublish).not.toHaveBeenCalled()
    expect(outcome.failed[0]).toMatchObject({ error: 'ABORTED_BEFORE_SEND', certainty: 'rejected' })
  })

  it('🔴 a check that cannot run (throws) also means nothing is sent — and it is not mistaken for an uncertain send', async () => {
    const outcome = await publishPending([candidate], {
      ...context({ now: new Date('2026-10-11T00:00:00Z') }),
      beforeSend: async () => {
        throw new Error('db down')
      },
    })
    expect(mockPublish).not.toHaveBeenCalled()
    expect(outcome.failed[0]).toMatchObject({ error: 'ABORTED_BEFORE_SEND', certainty: 'rejected' })
  })

  it('a check that passes lets the send go ahead, carrying the request timeout', async () => {
    mockPublish.mockRejectedValue(new Error('stop here'))
    await publishPending([candidate], { ...context({ now: new Date('2026-10-11T00:00:00Z') }), beforeSend: async () => true, requestTimeoutMs: 45_000 })
    expect(mockPublish).toHaveBeenCalledTimes(1)
    expect(mockPublish.mock.calls[0][0].timeoutMs).toBe(45_000)
  })
})

