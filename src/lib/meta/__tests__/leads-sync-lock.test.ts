import { afterEach, describe, expect, it, vi } from 'vitest'
import { claimMetaLeadsSyncRun, isOverlapSkipSummary, pickRunningOwner } from '../leads-sync-lock'

const NOW = new Date('2026-11-01T02:25:00Z')
const FRESH = 20 * 60 * 1000

afterEach(() => {
  vi.restoreAllMocks()
})

describe('isOverlapSkipSummary', () => {
  it('only matches the overlap marker', () => {
    expect(isOverlapSkipSummary({ skipped: 'overlap' })).toBe(true)
    expect(isOverlapSkipSummary({ skipped: 'page_not_verified' })).toBe(false)
    expect(isOverlapSkipSummary(null)).toBe(false)
    expect(isOverlapSkipSummary({})).toBe(false)
  })
})

describe('pickRunningOwner', () => {
  it('picks the oldest fresh row and breaks a tie by id', () => {
    const owner = pickRunningOwner([
      { id: 'b', startedAt: '2026-11-01T02:20:00Z' },
      { id: 'a', startedAt: '2026-11-01T02:20:00Z' },
      { id: 'c', startedAt: '2026-11-01T02:22:00Z' },
    ], NOW, FRESH)
    expect(owner?.id).toBe('a')
  })

  it('ignores a row older than the fresh window', () => {
    expect(pickRunningOwner([
      { id: 'stale', startedAt: '2026-11-01T02:00:00Z' },
    ], NOW, FRESH)).toBeNull()
  })
})

describe('claimMetaLeadsSyncRun', () => {
  it('does not start when a fresh run is already going', async () => {
    const start = vi.fn()
    const claim = await claimMetaLeadsSyncRun({
      now: NOW,
      freshForMs: FRESH,
      listRunning: async () => ({
        rows: [{ id: 'run-old', startedAt: '2026-11-01T02:20:00Z' }],
        readError: null,
      }),
      start,
      release: async () => null,
    })
    expect(claim).toEqual({ proceed: false, activeRunId: 'run-old' })
    expect(start).not.toHaveBeenCalled()
  })

  it('yields and deletes its own row when another run is older', async () => {
    const finish = vi.fn()
    const release = vi.fn(async () => null)
    let calls = 0
    const claim = await claimMetaLeadsSyncRun({
      now: NOW,
      freshForMs: FRESH,
      listRunning: async () => {
        calls += 1
        if (calls === 1) return { rows: [], readError: null }
        return {
          rows: [
            { id: 'run-old', startedAt: '2026-11-01T02:20:00Z' },
            { id: 'run-new', startedAt: '2026-11-01T02:25:00Z' },
          ],
          readError: null,
        }
      },
      start: async () => ({ id: 'run-new', finish }),
      release,
    })
    expect(release).toHaveBeenCalledWith('run-new')
    expect(finish).not.toHaveBeenCalled()
    expect(claim).toEqual({ proceed: false, activeRunId: 'run-old' })
  })

  it('finishes an overlap summary when the delete fails', async () => {
    const finish = vi.fn(async () => undefined)
    let calls = 0
    const claim = await claimMetaLeadsSyncRun({
      now: NOW,
      freshForMs: FRESH,
      listRunning: async () => {
        calls += 1
        if (calls === 1) return { rows: [], readError: null }
        return {
          rows: [
            { id: 'run-old', startedAt: '2026-11-01T02:20:00Z' },
            { id: 'run-new', startedAt: '2026-11-01T02:25:00Z' },
          ],
          readError: null,
        }
      },
      start: async () => ({ id: 'run-new', finish }),
      release: async () => 'delete failed',
    })
    expect(finish).toHaveBeenCalledWith({
      processed: 0,
      completed: 0,
      failed: 0,
      summary: { skipped: 'overlap', activeRunId: 'run-old' },
    })
    expect(claim).toEqual({ proceed: false, activeRunId: 'run-old' })
  })

  it('continues when the lock read fails', async () => {
    const finish = vi.fn()
    const claim = await claimMetaLeadsSyncRun({
      now: NOW,
      freshForMs: FRESH,
      listRunning: async () => ({ rows: [], readError: 'boom' }),
      start: async () => ({ id: 'run-new', finish }),
      release: async () => null,
    })
    expect(claim).toEqual({ proceed: true, finish })
  })
})
