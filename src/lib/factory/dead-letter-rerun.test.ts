import { describe, expect, it, vi } from 'vitest'
import {
  AUTO_RERUN_LIMIT,
  HELD_FROM_AUTO_RERUN,
  classifyFailure,
  nextReviewRef,
  planDeadLetter,
  runDeadLetterRerun,
  type DeadLetterRow,
  type DeadLetterStore,
} from './dead-letter-rerun'

const HELD = '90506421-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function row(over: Partial<DeadLetterRow> = {}): DeadLetterRow {
  return {
    id: 'order-1',
    client_id: 'client-1',
    reject_reason: 'ENOENT missing local file',
    review_ref: null,
    brief: null,
    reclaim_count: 0,
    ...over,
  }
}

describe('classifyFailure', () => {
  it('empty or non-text reasons are unreadable', () => {
    expect(classifyFailure(null)).toBe('unreadable')
    expect(classifyFailure('   ')).toBe('unreadable')
    expect(classifyFailure(413)).toBe('unreadable')
  })

  it('file-too-large stays out of the rerun bucket', () => {
    expect(classifyFailure('413 Payload Too Large')).toBe('too_large')
    expect(classifyFailure('文件太大 50MB')).toBe('too_large')
  })
})

describe('planDeadLetter', () => {
  it('reruns a missing file once, then stops at the limit', () => {
    const first = planDeadLetter(row())
    expect(first).toMatchObject({ action: 'rerun', nextCount: 1, reclaimCount: 1 })
    const second = planDeadLetter(row({ review_ref: { auto_rerun_count: 1 } }))
    expect(second).toMatchObject({ action: 'rerun', nextCount: 2 })
    const stopped = planDeadLetter(row({ review_ref: { auto_rerun_count: AUTO_RERUN_LIMIT } }))
    expect(stopped.action).toBe('escalate')
  })

  it('does not rerun a file that is too large', () => {
    expect(planDeadLetter(row({ reject_reason: '413 Payload Too Large' })).action).toBe('escalate')
  })

  it('holds the named work orders', () => {
    expect(HELD_FROM_AUTO_RERUN).toEqual(['90506421', '3f79a2ce'])
    expect(planDeadLetter(row({ id: HELD })).action).toBe('hold')
    expect(planDeadLetter(row({ id: '3f79a2ce-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })).action).toBe('hold')
  })

  it('a broken count is unreadable, not zero', () => {
    expect(planDeadLetter(row({ review_ref: { auto_rerun_count: '2' } })).action).toBe('unread')
    expect(planDeadLetter(row({ reclaim_count: '1' })).action).toBe('unread')
    expect(planDeadLetter(row({ brief: [] })).action).toBe('unread')
    expect(planDeadLetter(row({ reject_reason: '' })).action).toBe('unread')
  })

  it('merges the rerun note into the existing review ref', () => {
    expect(nextReviewRef({ reviewer: 'kept' }, 1, 'ENOENT', '2026-10-27T00:00:00.000Z')).toMatchObject({
      reviewer: 'kept',
      auto_rerun_count: 1,
      auto_rerun_prev_reject: 'ENOENT',
      revived_by: 'factory-dead-letter-rerun',
    })
  })
})

describe('runDeadLetterRerun', () => {
  it('a dry run plans a rerun and does not call the writer', async () => {
    const store: DeadLetterStore = { list: async () => ({ ok: true, rows: [row()] }), rerun: vi.fn() }
    const summary = await runDeadLetterRerun(store, { dryRun: true, at: '2026-10-27T00:00:00.000Z' })
    expect(summary).toMatchObject({ ok: true, planned: 1, rerun: 0, failed: 0 })
    expect(store.rerun).not.toHaveBeenCalled()
  })

  it('an unreadable failure is not success', async () => {
    const store: DeadLetterStore = {
      list: async () => ({ ok: true, rows: [row({ reject_reason: null })] }),
      rerun: vi.fn(),
    }
    const summary = await runDeadLetterRerun(store, { dryRun: false })
    expect(summary.ok).toBe(false)
    expect(summary.reason).toBe('读不到')
    expect(summary.unread).toBe(1)
    expect(store.rerun).not.toHaveBeenCalled()
  })

  it('a list that cannot be read is not an empty success', async () => {
    const store: DeadLetterStore = { list: async () => ({ ok: false, reason: '' }), rerun: vi.fn() }
    const summary = await runDeadLetterRerun(store, { dryRun: false })
    expect(summary).toMatchObject({ ok: false, processed: 0, reason: '读不到' })
  })

  it('a failed write is not success', async () => {
    const store: DeadLetterStore = {
      list: async () => ({ ok: true, rows: [row()] }),
      rerun: async () => ({ ok: false, reason: 'db down' }),
    }
    const summary = await runDeadLetterRerun(store, { dryRun: false })
    expect(summary).toMatchObject({ ok: false, failed: 1, rerun: 0, reason: 'db down' })
  })
})
