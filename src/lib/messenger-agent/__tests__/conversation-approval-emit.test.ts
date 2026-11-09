/**
 * Tests for F3 `conversation.approval.emit`（Issue #1586）.
 *
 * #1585（F2）hasn't landed yet, so there is no real `step.waitForEvent` to
 * integrate against. What we CAN verify without it: the emitted event's
 * shape is exactly what F2's documented consumer expression needs —
 * `step.waitForEvent('conversation/reply.approved', { if: 'async.data.draft_id
 * == "${draftId}"' })` (design doc §Layer 4 F2 Step 7). That `if` expression
 * only works if the event name is `conversation/reply.approved` and the event
 * payload has `data.draft_id` set to the exact draft id string — this suite
 * asserts both, plus the idempotency/dedup id and the reject path's explicit
 * non-involvement (see route tests for that side).
 */

import { describe, expect, it, vi } from 'vitest'
import {
  CONVERSATION_REPLY_APPROVED_EVENT,
  emitConversationApprovalEvent,
} from '../conversation-approval-emit'

describe('emitConversationApprovalEvent', () => {
  it('emits the exact event name and draft_id shape F2\'s waitForEvent `if` expression matches on', async () => {
    const send = vi.fn().mockResolvedValue({ event_ids: ['evt_1'] })

    await emitConversationApprovalEvent(
      {
        draftId: 'draft-123',
        clientId: 'client-abc',
        conversationId: 'convo-xyz',
        decidedByEmail: 'ray@magicengine.cloud',
      },
      { send },
    )

    expect(send).toHaveBeenCalledTimes(1)
    const [event] = send.mock.calls[0]
    expect(event.name).toBe('conversation/reply.approved')
    expect(event.name).toBe(CONVERSATION_REPLY_APPROVED_EVENT)
    // 🔴 变异守卫：F2 的 `if: 'async.data.draft_id == "${draftId}"'` 表达式只认
    // `data.draft_id` 这个字段名——如果这里改成 draftId(驼峰)或者塞进别的字段，
    // F2 会永远匹配不到，卡到 4 小时超时都不会被发现。
    expect(event.data.draft_id).toBe('draft-123')
    expect(event.data.client_id).toBe('client-abc')
    expect(event.data.conversation_id).toBe('convo-xyz')
    expect(event.data.decided_by_email).toBe('ray@magicengine.cloud')
  })

  it('derives the event id from draftId so retries/double-clicks dedupe instead of double-firing', async () => {
    const send = vi.fn().mockResolvedValue({ event_ids: ['evt_1'] })

    await emitConversationApprovalEvent(
      { draftId: 'draft-123', clientId: 'c', conversationId: 'v', decidedByEmail: 'a@b.com' },
      { send },
    )
    await emitConversationApprovalEvent(
      { draftId: 'draft-123', clientId: 'c', conversationId: 'v', decidedByEmail: 'a@b.com' },
      { send },
    )

    const ids = send.mock.calls.map(([event]) => event.id)
    expect(ids[0]).toBe(ids[1])
    expect(ids[0]).toContain('draft-123')
  })

  it('two different drafts get two different event ids (dedup key is not globally shared)', async () => {
    const send = vi.fn().mockResolvedValue({ event_ids: ['evt_1'] })

    await emitConversationApprovalEvent(
      { draftId: 'draft-A', clientId: 'c', conversationId: 'v', decidedByEmail: 'a@b.com' },
      { send },
    )
    await emitConversationApprovalEvent(
      { draftId: 'draft-B', clientId: 'c', conversationId: 'v', decidedByEmail: 'a@b.com' },
      { send },
    )

    const ids = send.mock.calls.map(([event]) => event.id)
    expect(ids[0]).not.toBe(ids[1])
  })

  it('propagates a send failure rather than swallowing it (caller must know approval notification failed)', async () => {
    const send = vi.fn().mockRejectedValue(new Error('INNGEST_EVENT_SEND_FAILED:500'))

    await expect(
      emitConversationApprovalEvent(
        { draftId: 'draft-123', clientId: 'c', conversationId: 'v', decidedByEmail: 'a@b.com' },
        { send },
      ),
    ).rejects.toThrow('INNGEST_EVENT_SEND_FAILED')
  })
})
