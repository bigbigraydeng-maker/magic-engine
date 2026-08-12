import { describe, expect, it, vi } from 'vitest'
import { waitForChecks } from '../src/poll.mjs'

// The caller now supplies "settled", because the auto-merge gate has to wait
// for every check on the sha rather than one matched by name. These tests use
// the same predicate handle-review.mjs does.
const allSettled = (runs: Array<{ status: string }>) =>
  runs.length > 0 && runs.every((run) => run.status === 'completed')

const run = (name: string, status: string, conclusion: string | null = null) => ({ name, status, conclusion })

describe('waitForChecks', () => {
  it('returns immediately when every run is already completed', async () => {
    const runs = [run('ai-orchestrator-tests', 'completed', 'success'), run('build', 'completed', 'success')]
    const fetchCheckRuns = vi.fn().mockResolvedValue(runs)
    const sleep = vi.fn().mockResolvedValue(undefined)

    const result = await waitForChecks({ fetchCheckRuns, sleep, isSettled: allSettled, maxAttempts: 5, intervalMs: 10 })

    expect(result).toEqual(runs)
    expect(fetchCheckRuns).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('keeps polling while ANY run is still in flight, not just the named one', async () => {
    // The regression this guards: the predecessor returned as soon as the one
    // check matching /ai-orchestrator/i completed, so a build still running
    // was never waited for — and under auto-merge "still running" would have
    // been evaluated as part of the merge decision.
    const pending = [run('ai-orchestrator-tests', 'completed', 'success'), run('build', 'in_progress')]
    const settled = [run('ai-orchestrator-tests', 'completed', 'success'), run('build', 'completed', 'failure')]
    const fetchCheckRuns = vi.fn().mockResolvedValueOnce(pending).mockResolvedValueOnce(settled)
    const sleep = vi.fn().mockResolvedValue(undefined)

    const result = await waitForChecks({ fetchCheckRuns, sleep, isSettled: allSettled, maxAttempts: 5, intervalMs: 10 })

    expect(result).toEqual(settled)
    expect(fetchCheckRuns).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
  })

  it('returns a settled-but-red list unchanged — deciding what red means is the gate\'s job, not the poller\'s', async () => {
    const red = [run('build', 'completed', 'failure')]
    const fetchCheckRuns = vi.fn().mockResolvedValue(red)
    const sleep = vi.fn().mockResolvedValue(undefined)

    const result = await waitForChecks({ fetchCheckRuns, sleep, isSettled: allSettled, maxAttempts: 5, intervalMs: 10 })

    expect(result).toEqual(red)
    expect(fetchCheckRuns).toHaveBeenCalledTimes(1)
  })

  it('gives up after maxAttempts, returning the last observed state without a trailing sleep', async () => {
    const inFlight = [run('ai-orchestrator-tests', 'in_progress')]
    const fetchCheckRuns = vi.fn().mockResolvedValue(inFlight)
    const sleep = vi.fn().mockResolvedValue(undefined)

    const result = await waitForChecks({ fetchCheckRuns, sleep, isSettled: allSettled, maxAttempts: 3, intervalMs: 10 })

    // Deliberately the last state, not null: `null` would make "timed out"
    // indistinguishable from "no checks exist", and both must block a merge
    // for different stated reasons.
    expect(result).toEqual(inFlight)
    expect(fetchCheckRuns).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('never treats an empty check list as settled', async () => {
    const fetchCheckRuns = vi.fn().mockResolvedValue([])
    const sleep = vi.fn().mockResolvedValue(undefined)

    const result = await waitForChecks({ fetchCheckRuns, sleep, isSettled: allSettled, maxAttempts: 2, intervalMs: 10 })

    expect(result).toEqual([])
    expect(fetchCheckRuns).toHaveBeenCalledTimes(2)
  })
})
