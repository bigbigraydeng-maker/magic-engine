import { beforeEach, describe, expect, it, vi } from 'vitest'
import { logRejection, resetRejectLog, MAX_REJECT_LOGS_PER_WINDOW } from '../reject-log'

describe('logRejection', () => {
  beforeEach(() => resetRejectLog())

  it('logs up to the per-minute cap and silently counts the rest', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (let i = 0; i < MAX_REJECT_LOGS_PER_WINDOW + 30; i++) logRejection('k', 'line', 1_000)
    expect(spy).toHaveBeenCalledTimes(MAX_REJECT_LOGS_PER_WINDOW)
    spy.mockRestore()
  })

  it('reports how many were suppressed once the window rolls over, then logs again', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (let i = 0; i < MAX_REJECT_LOGS_PER_WINDOW + 5; i++) logRejection('k', 'line', 1_000)
    logRejection('k', 'fresh', 1_000 + 60_000)
    const text = spy.mock.calls.flat().map(String)
    expect(text.some((t) => t.includes('5 similar rejection(s) not logged'))).toBe(true)
    expect(text[text.length - 1]).toBe('fresh')
    spy.mockRestore()
  })

  it('buckets are per key: one noisy reason does not hide another', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (let i = 0; i < MAX_REJECT_LOGS_PER_WINDOW + 10; i++) logRejection('a', 'a-line', 1_000)
    logRejection('b', 'b-line', 1_000)
    expect(spy.mock.calls.flat().map(String)).toContain('b-line')
    spy.mockRestore()
  })

  it('the suppressed notice carries only the key and a count', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (let i = 0; i < MAX_REJECT_LOGS_PER_WINDOW + 1; i++) logRejection('signature_mismatch:env', 'x', 5)
    logRejection('signature_mismatch:env', 'y', 5 + 60_000)
    const notice = spy.mock.calls.flat().map(String).find((t) => t.includes('not logged'))
    expect(notice).toBe('[webhooks/whatsapp] 1 similar rejection(s) not logged in the last minute (signature_mismatch:env)')
    spy.mockRestore()
  })
})
