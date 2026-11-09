/**
 * Story publish-action registration. No Meta calls. Switches default off.
 */
import { describe, expect, it } from 'vitest'
import { SOCIAL_ACTION_TYPE } from '@/lib/flywheel/vocabulary'
import { SOCIAL_PUBLISH_STORY_ACTION_TYPE } from '@/lib/social/post-measurement-store'
import {
  isLiveSentStoryAttempt,
  parseLiveSentStoryAttempt,
  recordStoryPublishAction,
  storyPublishIdempotencyKey,
  storyPublishIdentityMismatch,
  storyPublishReconcileEnabled,
  storyPublishRegisterEnabled,
  storyReconcileEventId,
  storyRegistrationRefusal,
  type StoryItemRegistrationRow,
  type StoryPublishActionInput,
} from '@/lib/social/story-publish-action'

const CLIENT = '11111111-1111-4111-8111-111111111111'
const ITEM = '22222222-2222-4222-8222-222222222222'
const PACK = '33333333-3333-4333-8333-333333333333'
const PAGE = '12345'
const RECEIPT = 'story-receipt-1'
const SENT_AT = '2026-11-02T07:00:00.000Z'

function input(over: Partial<StoryPublishActionInput> = {}): StoryPublishActionInput {
  return {
    clientId: CLIENT,
    itemId: ITEM,
    packId: PACK,
    pageId: PAGE,
    channel: 'facebook_story',
    providerReceipt: RECEIPT,
    publishedAt: SENT_AT,
    ...over,
  }
}

function item(over: Partial<StoryItemRegistrationRow> = {}): StoryItemRegistrationRow {
  return {
    item_id: ITEM,
    pack_id: PACK,
    client_id: CLIENT,
    channel: 'facebook_story',
    account_id: PAGE,
    status: 'SENT',
    provider_receipt: RECEIPT,
    sent_at: SENT_AT,
    ...over,
  }
}

function attempt() {
  return parseLiveSentStoryAttempt({
    client_id: CLIENT,
    item_id: ITEM,
    pack_id: PACK,
    channel: 'facebook_story',
    status: 'SENT',
    mode: 'LIVE',
    provider_receipt: RECEIPT,
  })!
}

describe('story publish switches and event id', () => {
  it('only the exact string true turns a switch on', () => {
    expect(storyPublishRegisterEnabled({})).toBe(false)
    expect(storyPublishRegisterEnabled({ SOCIAL_STORY_PUBLISH_REGISTER_ENABLED: 'TRUE' })).toBe(false)
    expect(storyPublishRegisterEnabled({ SOCIAL_STORY_PUBLISH_REGISTER_ENABLED: 'true' })).toBe(true)
    expect(storyPublishReconcileEnabled({})).toBe(false)
    expect(storyPublishReconcileEnabled({ SOCIAL_STORY_PUBLISH_RECONCILE_ENABLED: '1' })).toBe(false)
    expect(storyPublishReconcileEnabled({ SOCIAL_STORY_PUBLISH_RECONCILE_ENABLED: 'true' })).toBe(true)
  })

  it('buckets the reconcile event id down to ten minutes UTC', () => {
    expect(storyReconcileEventId(new Date('2026-11-02T07:33:00.000Z'))).toBe('story-reconcile:202611020730')
    expect(storyReconcileEventId(new Date('2026-11-02T07:39:59.000Z'))).toBe('story-reconcile:202611020730')
    expect(storyReconcileEventId(new Date('2026-11-02T07:40:00.000Z'))).toBe('story-reconcile:202611020740')
  })

  it('uses one story action type in the vocabulary and the store', () => {
    expect(SOCIAL_PUBLISH_STORY_ACTION_TYPE).toBe('social.publish_story')
    expect(SOCIAL_ACTION_TYPE.PUBLISH_STORY).toBe(SOCIAL_PUBLISH_STORY_ACTION_TYPE)
    expect(storyPublishIdempotencyKey(ITEM)).toBe(`story-lite:${ITEM}`)
  })
})

describe('T10 story registration identity', () => {
  it('a matching replay is the same row', () => {
    const row = {
      id: 'action-1',
      client_id: CLIENT,
      action_type: SOCIAL_PUBLISH_STORY_ACTION_TYPE,
      expected_metric: null,
      payload: {
        source: 'story_lite',
        idempotency_key: storyPublishIdempotencyKey(ITEM),
        item_id: ITEM,
        pack_id: PACK,
        page_id: PAGE,
        channel: 'facebook_story',
        provider_receipt: RECEIPT,
        published_at: SENT_AT,
      },
    }
    expect(storyPublishIdentityMismatch(row, input())).toBeNull()
  })

  it('a different receipt on the same key fails closed', () => {
    const row = {
      client_id: CLIENT,
      action_type: SOCIAL_PUBLISH_STORY_ACTION_TYPE,
      expected_metric: null,
      payload: {
        source: 'story_lite',
        idempotency_key: storyPublishIdempotencyKey(ITEM),
        item_id: ITEM,
        pack_id: PACK,
        page_id: PAGE,
        channel: 'facebook_story',
        provider_receipt: 'other-receipt',
        published_at: SENT_AT,
      },
    }
    expect(storyPublishIdentityMismatch(row, input())).toBe('provider_receipt_mismatch')
  })

  it('a stored measure_at is not this registration', () => {
    const row = {
      client_id: CLIENT,
      action_type: SOCIAL_PUBLISH_STORY_ACTION_TYPE,
      expected_metric: null,
      payload: { measure_at: [] },
    }
    expect(storyPublishIdentityMismatch(row, input())).toBe('measure_at_present')
  })

  it('inserts no measure_at and no expected metric; a conflicting identity is not reused', async () => {
    const written: Record<string, unknown>[] = []
    const db = {
      from() {
        return {
          insert(row: Record<string, unknown>) {
            written.push(row)
            return {
              select: () => ({
                single: async () => ({ data: { id: 'action-1' }, error: null }),
              }),
            }
          },
        }
      },
    }
    const created = await recordStoryPublishAction(db as never, input())
    expect(created).toEqual({ ok: true, actionId: 'action-1', created: true })
    expect(written[0].expected_metric).toBeNull()
    expect(written[0].action_type).toBe('social.publish_story')
    expect(written[0].payload).not.toHaveProperty('measure_at')
    expect((written[0].payload as { campaign_id?: string }).campaign_id).toBeUndefined()

    const conflict = {
      from() {
        const api = {
          insert: () => ({
            select: () => ({
              single: async () => ({ data: null, error: { code: '23505', message: 'dup' } }),
            }),
          }),
          select: () => api,
          eq: () => api,
          maybeSingle: async () => ({
            data: {
              id: 'old-action',
              client_id: CLIENT,
              action_type: 'social.publish_story',
              expected_metric: null,
              payload: {
                source: 'story_lite',
                idempotency_key: storyPublishIdempotencyKey(ITEM),
                item_id: ITEM,
                pack_id: PACK,
                page_id: PAGE,
                channel: 'facebook_story',
                provider_receipt: 'other-receipt',
                published_at: SENT_AT,
              },
            },
            error: null,
          }),
        }
        return api
      },
    }
    const replay = await recordStoryPublishAction(conflict as never, input())
    expect(replay.ok).toBe(false)
    if (!replay.ok) expect(replay.field).toBe('provider_receipt_mismatch')
  })
})

describe('story registration refusal', () => {
  it('receipt, status, and page each refuse before an action row exists', () => {
    const live = attempt()
    expect(storyRegistrationRefusal(live, item({ provider_receipt: 'other' }), PAGE)).toBe('receipt_mismatch')
    expect(storyRegistrationRefusal(live, item({ status: 'BLOCKED' }), PAGE)).toBe('status_not_sent')
    expect(storyRegistrationRefusal(live, item(), null)).toBe('page_mismatch')
    expect(storyRegistrationRefusal(live, item(), '99999')).toBe('page_mismatch')
    expect(storyRegistrationRefusal(live, item(), PAGE)).toBeNull()
  })

  it('a dry run is not a live send', () => {
    expect(isLiveSentStoryAttempt({ status: 'SENT', mode: 'DRY_RUN' })).toBe(false)
    expect(isLiveSentStoryAttempt({ status: 'BLOCKED', mode: 'LIVE' })).toBe(false)
    expect(isLiveSentStoryAttempt({ status: 'RETRY_LATER', mode: 'LIVE' })).toBe(false)
    expect(parseLiveSentStoryAttempt({ status: 'SENT', mode: 'DRY_RUN' })).toBeNull()
  })
})
