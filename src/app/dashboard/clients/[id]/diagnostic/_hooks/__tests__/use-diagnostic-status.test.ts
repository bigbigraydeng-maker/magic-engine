/**
 * useDiagnosticStatus hook tests
 * TDD: RED → GREEN → REFACTOR
 *
 * Scenarios:
 * 1. Starts fetching immediately when runId is provided
 * 2. Returns status=running while run is in progress
 * 3. Stops polling when status=completed
 * 4. Stops polling when status=failed — exposes error
 * 5. Polls every 3 seconds while status=running
 * 6. Pauses polling when page is hidden, resumes on visible
 * 7. Cleans up interval on unmount
 * 8. Does nothing when runId is null
 */

import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useDiagnosticStatus } from '../use-diagnostic-status'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CLIENT_ID = 'client-123'
const RUN_ID = 'run-abc'

function makeRun(status: string, extra: Record<string, unknown> = {}) {
  return { id: RUN_ID, status, overall_score: null, dimension_scores: null, error_message: null, ...extra }
}

function makeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  // shouldAdvanceTime=true lets RTL's waitFor internal timers still fire
  vi.useFakeTimers({ shouldAdvanceTime: true })
  global.fetch = vi.fn()
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useDiagnosticStatus()', () => {
  // =========================================================================
  // 1. Fetches immediately when runId provided
  // =========================================================================
  it('fetches status immediately on mount when runId is set', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse({ success: true, run: makeRun('running') }),
    )

    renderHook(() => useDiagnosticStatus(CLIENT_ID, RUN_ID))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledOnce()
    })

    expect(global.fetch).toHaveBeenCalledWith(
      `/api/clients/${CLIENT_ID}/diagnostic/runs/${RUN_ID}/status`,
    )
  })

  // =========================================================================
  // 2. Returns status=running while in progress
  // =========================================================================
  it('returns status=running while run is in progress', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeResponse({ success: true, run: makeRun('running') }),
    )

    const { result } = renderHook(() => useDiagnosticStatus(CLIENT_ID, RUN_ID))

    await waitFor(() => {
      expect(result.current.status).toBe('running')
    })
  })

  // =========================================================================
  // 3. Stops polling when status=completed
  // =========================================================================
  it('stops polling when status=completed', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeResponse({ success: true, run: makeRun('running') }))
      .mockResolvedValueOnce(makeResponse({ success: true, run: makeRun('completed', { overall_score: 72 }) }))
      .mockResolvedValue(makeResponse({ success: true, run: makeRun('completed', { overall_score: 72 }) }))

    const { result } = renderHook(() => useDiagnosticStatus(CLIENT_ID, RUN_ID))

    // First poll → running
    await waitFor(() => expect(result.current.status).toBe('running'))

    // Advance 3s → second poll → completed
    await act(async () => { vi.advanceTimersByTime(3000) })
    await waitFor(() => expect(result.current.status).toBe('completed'))

    const callsAtCompletion = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length

    // Advance another 3s — no more calls expected
    await act(async () => { vi.advanceTimersByTime(3000) })
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAtCompletion)
  })

  // =========================================================================
  // 4. Status=failed stops polling and sets error
  // =========================================================================
  it('stops polling and exposes error when status=failed', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeResponse({ success: true, run: makeRun('failed', { error_message: 'collector crashed' }) }),
    )

    const { result } = renderHook(() => useDiagnosticStatus(CLIENT_ID, RUN_ID))

    await waitFor(() => {
      expect(result.current.status).toBe('failed')
      expect(result.current.error).toBe('collector crashed')
    })

    const callsAtFailure = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length
    await act(async () => { vi.advanceTimersByTime(3000) })
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAtFailure)
  })

  // =========================================================================
  // 5. Polls every 3 seconds while running
  // =========================================================================
  it('polls every 3 seconds while status is running', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeResponse({ success: true, run: makeRun('running') }),
    )

    renderHook(() => useDiagnosticStatus(CLIENT_ID, RUN_ID))

    // Initial call
    await waitFor(() => expect(global.fetch).toHaveBeenCalledOnce())

    // Advance 3s → 2nd call
    await act(async () => { vi.advanceTimersByTime(3000) })
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2))

    // Advance another 3s → 3rd call
    await act(async () => { vi.advanceTimersByTime(3000) })
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3))
  })

  // =========================================================================
  // 6. Pauses on page hidden, resumes on visible
  // =========================================================================
  it('pauses polling when page becomes hidden and resumes when visible', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeResponse({ success: true, run: makeRun('running') }),
    )

    renderHook(() => useDiagnosticStatus(CLIENT_ID, RUN_ID))
    await waitFor(() => expect(global.fetch).toHaveBeenCalledOnce())

    // Simulate page hidden
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))

    const callsBeforeHide = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length
    await act(async () => { vi.advanceTimersByTime(9000) }) // 3 intervals — all should be paused
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBeforeHide)

    // Simulate page visible again
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))

    await waitFor(() => {
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(callsBeforeHide)
    })
  })

  // =========================================================================
  // 7. Cleans up on unmount
  // =========================================================================
  it('clears the polling interval on unmount', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeResponse({ success: true, run: makeRun('running') }),
    )

    const { unmount } = renderHook(() => useDiagnosticStatus(CLIENT_ID, RUN_ID))
    await waitFor(() => expect(global.fetch).toHaveBeenCalledOnce())

    unmount()
    const callsAtUnmount = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length

    await act(async () => { vi.advanceTimersByTime(9000) })
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAtUnmount)
  })

  // =========================================================================
  // 8. Does nothing when runId is null
  // =========================================================================
  it('makes no fetch calls when runId is null', async () => {
    const { result } = renderHook(() => useDiagnosticStatus(CLIENT_ID, null))

    await act(async () => { vi.advanceTimersByTime(9000) })
    expect(global.fetch).not.toHaveBeenCalled()
    expect(result.current.status).toBeNull()
  })
})
