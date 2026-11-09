import { describe, expect, it } from 'vitest'
import { countUnresolvedFailures } from '@/lib/pm-todo/data-deletion-items'

const failed = (hash: string, issuedAt: string) => ({ app_user_hash: hash, issued_at: issuedAt, status: 'failed' })

describe('countUnresolvedFailures', () => {
  it('counts a lone failure', () => {
    expect(countUnresolvedFailures([failed('h1', '2026-09-27T00:00:00.000Z')])).toBe(1)
  })

  it('does not count a failure that was later completed for the same request', () => {
    const rows = [
      failed('h1', '2026-09-27T00:00:00.000Z'),
      { app_user_hash: 'h1', issued_at: '2026-09-27T00:00:00.000Z', status: 'completed' },
    ]
    expect(countUnresolvedFailures(rows)).toBe(0)
  })

  it('does not count a failure that was later settled as no_data', () => {
    const rows = [
      failed('h1', '2026-09-27T00:00:00.000Z'),
      { app_user_hash: 'h1', issued_at: '2026-09-27T00:00:00.000Z', status: 'no_data' },
    ]
    expect(countUnresolvedFailures(rows)).toBe(0)
  })

  it('counts two different failed requests separately', () => {
    const rows = [
      failed('h1', '2026-09-27T00:00:00.000Z'),
      failed('h2', '2026-09-27T01:00:00.000Z'),
    ]
    expect(countUnresolvedFailures(rows)).toBe(2)
  })

  it('does not let a settled row for another request hide a failure', () => {
    const rows = [
      failed('h1', '2026-09-27T00:00:00.000Z'),
      { app_user_hash: 'h1', issued_at: '2026-09-27T01:00:00.000Z', status: 'completed' },
    ]
    expect(countUnresolvedFailures(rows)).toBe(1)
  })
})
