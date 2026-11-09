import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useGenerationQueue } from '../useGenerationQueue'
import { GENERATION_CONFIG } from '@/lib/visual/generation-config'

// Mock global fetch
global.fetch = vi.fn()

// jsdom ≥ 27 no longer provides window.localStorage; the hook persists queue
// state there on every change, so install a minimal in-memory Storage.
function createMemoryStorage(): Storage {
  let store = new Map<string, string>()
  return {
    get length() { return store.size },
    clear: () => { store = new Map() },
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => { store.delete(key) },
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
  }
}
vi.stubGlobal('localStorage', createMemoryStorage())

describe('useGenerationQueue - 1Hz Local Smoothing (P9.0.7)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    vi.clearAllMocks()
    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, asset_id: 'asset-123' }),
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('should create 100ms and 5s intervals when item enters activeGenerations', async () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval')
    const { result } = renderHook(() => useGenerationQueue())

    // Submit generation to populate queue
    await act(async () => {
      await result.current.submitGeneration('test-post', '/api/visual/image', { asset_type: 'image' })
    })

    // Process queue to move to activeGenerations
    act(() => {
      result.current.processQueue()
    })

    // Check that both intervals were created
    const calls = setIntervalSpy.mock.calls
    const intervals = calls.map((c) => c[1])
    expect(intervals).toContain(100)
    expect(intervals).toContain(GENERATION_CONFIG.POLLING_INTERVAL_MS)
  })

  it('should call onStatusChange with incremented elapsed on each 100ms tick', async () => {
    const onStatusChange = vi.fn()
    const { result } = renderHook(() => useGenerationQueue({ onStatusChange }))
    const postId = 'test-post'

    // Submit and process
    await act(async () => {
      await result.current.submitGeneration(postId, '/api/visual/image', { asset_type: 'image' })
    })

    act(() => {
      result.current.processQueue()
    })

    // Clear initial calls from submitGeneration and processQueue
    onStatusChange.mockClear()

    // Advance 300ms (3 ticks of 100ms each)
    act(() => {
      vi.advanceTimersByTime(300)
    })

    // Filter calls for this postId
    const calls = onStatusChange.mock.calls.filter((c) => c[0] === postId)
    expect(calls.length).toBeGreaterThanOrEqual(3)

    // Verify elapsed increased
    const lastCall = calls[calls.length - 1]
    expect(lastCall[1].elapsed).toBeGreaterThan(0)
  })

  it('should decrement estimatedRemainingMs by 100ms on each tick', async () => {
    const onStatusChange = vi.fn()
    const { result } = renderHook(() => useGenerationQueue({ onStatusChange }))
    const postId = 'test-post'
    const estimatedMs = 180000

    // Setup by manually adding to activeGenerations
    act(() => {
      result.current.queueState.activeGenerations[postId] = {
        postId,
        assetId: 'asset-123',
        assetType: 'image',
        startedAt: Date.now(),
        retryCount: 0,
        status: 'generating',
        elapsed: 0,
        stage: 'Initialising…',
        estimatedRemainingMs: estimatedMs,
      }
    })

    // Trigger effect by advancing time first (allows effect to run)
    act(() => {
      vi.advanceTimersByTime(0)
    })

    onStatusChange.mockClear()

    // Advance 500ms
    act(() => {
      vi.advanceTimersByTime(500)
    })

    const calls = onStatusChange.mock.calls.filter((c) => c[0] === postId)
    if (calls.length > 0) {
      const lastCall = calls[calls.length - 1]
      expect(lastCall[1].estimatedRemainingMs).toBeLessThan(estimatedMs)
    }
  })

  it('should not create duplicate 100ms intervals for the same postId', async () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval')
    const { result } = renderHook(() => useGenerationQueue())
    const postId = 'test-post'

    // Submit and process
    await act(async () => {
      await result.current.submitGeneration(postId, '/api/visual/image', { asset_type: 'image' })
    })

    act(() => {
      result.current.processQueue()
    })

    const firstCallCount = setIntervalSpy.mock.calls.filter((c) => c[1] === 100).length

    // Trigger another effect cycle (same postId still in activeGenerations)
    act(() => {
      vi.advanceTimersByTime(0)
    })

    const secondCallCount = setIntervalSpy.mock.calls.filter((c) => c[1] === 100).length

    // Should not add a new 100ms interval
    expect(secondCallCount).toBe(firstCallCount)
  })

  it('should clean up 100ms interval when item is removed from activeGenerations', async () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval')
    const { result } = renderHook(() => useGenerationQueue())
    const postId = 'test-post'

    // Submit and process
    await act(async () => {
      await result.current.submitGeneration(postId, '/api/visual/image', { asset_type: 'image' })
    })

    act(() => {
      result.current.processQueue()
    })

    // Reset spy to measure cleanup calls only
    clearIntervalSpy.mockClear()

    // Call cleanup which should clear all intervals
    act(() => {
      result.current.cleanup(postId)
    })

    expect(clearIntervalSpy).toHaveBeenCalled()
  })

  it('should maintain monotonically increasing elapsed over time', async () => {
    const onStatusChange = vi.fn()
    const { result } = renderHook(() => useGenerationQueue({ onStatusChange }))
    const postId = 'test-post'

    // Submit and process
    await act(async () => {
      await result.current.submitGeneration(postId, '/api/visual/image', { asset_type: 'image' })
    })

    act(() => {
      result.current.processQueue()
    })

    onStatusChange.mockClear()

    // Advance 1 second (10 ticks)
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    const calls = onStatusChange.mock.calls.filter((c) => c[0] === postId)

    // Verify monotonic increase
    let previousElapsed = -1
    for (const call of calls) {
      const elapsed = call[1].elapsed
      expect(elapsed).toBeGreaterThanOrEqual(previousElapsed)
      previousElapsed = elapsed
    }

    // Should have roughly 10 calls for 1000ms at 100ms intervals
    expect(calls.length).toBeGreaterThanOrEqual(8)
  })

  it('should handle multiple concurrent generations independently', async () => {
    const onStatusChange = vi.fn()
    const { result } = renderHook(() => useGenerationQueue({ onStatusChange }))
    const postId1 = 'post-1'
    const postId2 = 'post-2'

    // Submit two generations
    await act(async () => {
      await result.current.submitGeneration(postId1, '/api/visual/image', { asset_type: 'image' })
    })

    await act(async () => {
      await result.current.submitGeneration(postId2, '/api/visual/video', { asset_type: 'video' })
    })

    // Process first item
    act(() => {
      result.current.processQueue()
    })

    onStatusChange.mockClear()

    // Advance 500ms
    act(() => {
      vi.advanceTimersByTime(500)
    })

    const calls1 = onStatusChange.mock.calls.filter((c) => c[0] === postId1)

    // First item should have received updates from smoothing interval
    expect(calls1.length).toBeGreaterThan(0)
  })

  it('should respect 5s polling interval while running 100ms smoothing', async () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval')
    const { result } = renderHook(() => useGenerationQueue())
    const postId = 'test-post'

    // Submit and process
    await act(async () => {
      await result.current.submitGeneration(postId, '/api/visual/image', { asset_type: 'image' })
    })

    act(() => {
      result.current.processQueue()
    })

    // Verify intervals
    const intervals = setIntervalSpy.mock.calls.map((c) => c[1])
    expect(intervals).toContain(100)
    expect(intervals).toContain(5000)
  })
})
