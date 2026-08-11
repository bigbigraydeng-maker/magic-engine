import { describe, expect, it, vi } from 'vitest'
import { waitForRequiredCheck } from '../src/poll.mjs'

const pattern = /ai-orchestrator/i

describe('waitForRequiredCheck', () => {
  it('returns immediately when the required check is already completed', async () => {
    const fetchCheckRuns = vi.fn().mockResolvedValue([{ name: 'ai-orchestrator-tests', status: 'completed', conclusion: 'success' }])
    const sleep = vi.fn().mockResolvedValue(undefined)

    const result = await waitForRequiredCheck({ fetchCheckRuns, sleep, pattern, maxAttempts: 5, intervalMs: 10 })

    expect(result).toEqual({ name: 'ai-orchestrator-tests', status: 'completed', conclusion: 'success' })
    expect(fetchCheckRuns).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('polls until the check completes, sleeping between attempts', async () => {
    const fetchCheckRuns = vi
      .fn()
      .mockResolvedValueOnce([{ name: 'ai-orchestrator-tests', status: 'in_progress', conclusion: null }])
      .mockResolvedValueOnce([{ name: 'ai-orchestrator-tests', status: 'in_progress', conclusion: null }])
      .mockResolvedValueOnce([{ name: 'ai-orchestrator-tests', status: 'completed', conclusion: 'failure' }])
    const sleep = vi.fn().mockResolvedValue(undefined)

    const result = await waitForRequiredCheck({ fetchCheckRuns, sleep, pattern, maxAttempts: 5, intervalMs: 10 })

    expect(result).toEqual({ name: 'ai-orchestrator-tests', status: 'completed', conclusion: 'failure' })
    expect(fetchCheckRuns).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('gives up after maxAttempts and returns null without a trailing sleep', async () => {
    const fetchCheckRuns = vi.fn().mockResolvedValue([{ name: 'ai-orchestrator-tests', status: 'in_progress', conclusion: null }])
    const sleep = vi.fn().mockResolvedValue(undefined)

    const result = await waitForRequiredCheck({ fetchCheckRuns, sleep, pattern, maxAttempts: 3, intervalMs: 10 })

    expect(result).toBeNull()
    expect(fetchCheckRuns).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('ignores check runs that do not match the required-check pattern', async () => {
    const fetchCheckRuns = vi.fn().mockResolvedValue([{ name: 'Cloudflare Pages', status: 'completed', conclusion: 'success' }])
    const sleep = vi.fn().mockResolvedValue(undefined)

    const result = await waitForRequiredCheck({ fetchCheckRuns, sleep, pattern, maxAttempts: 2, intervalMs: 10 })

    expect(result).toBeNull()
    expect(fetchCheckRuns).toHaveBeenCalledTimes(2)
  })
})
