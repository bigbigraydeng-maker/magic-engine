import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/require-admin', () => ({ guardGlobalAdmin: vi.fn(async () => null) }))
vi.mock('@/lib/conversions/cts-crm-sheet-sync-run', () => ({
  runCtsCrmSync: vi.fn(async () => ({ inserted: 0 })),
}))

import { runCtsCrmSync } from '@/lib/conversions/cts-crm-sheet-sync-run'
import { POST } from './route'

describe('POST sheet deal sync', () => {
  beforeEach(() => {
    delete process.env.CONVERSION_SHEET_DEAL_SYNC
    vi.mocked(runCtsCrmSync).mockClear()
  })

  it('stays off and does not run when the flag is unset', async () => {
    const res = await POST()
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ skipped: true, reason: 'sheet_deal_sync_off' })
    expect(runCtsCrmSync).not.toHaveBeenCalled()
  })

  it('runs only when the flag is on', async () => {
    process.env.CONVERSION_SHEET_DEAL_SYNC = '1'
    const res = await POST()
    expect(res.status).toBe(200)
    expect(runCtsCrmSync).toHaveBeenCalledTimes(1)
    delete process.env.CONVERSION_SHEET_DEAL_SYNC
  })
})
