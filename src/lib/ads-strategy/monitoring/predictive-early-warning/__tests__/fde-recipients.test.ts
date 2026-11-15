import { describe, expect, it, vi } from 'vitest'
import { loadFdeEmailsForClient } from '../fde-recipients'

describe('loadFdeEmailsForClient', () => {
  it('returns only internal fde rows', async () => {
    const sb = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(async () => ({
              data: [
                { email: 'staff@magicengine.com.au', access_type: 'fde' },
                { email: 'client@customer.example', access_type: 'fde' },
                { email: 'team2@magicengine.com.au', access_type: 'fde' },
              ],
              error: null,
            })),
          })),
        })),
      })),
    }
    const r = await loadFdeEmailsForClient(sb as never, 'client-1')
    expect(r.emails.sort()).toEqual(['staff@magicengine.com.au', 'team2@magicengine.com.au'].sort())
    expect(r.skippedNonInternal).toBe(1)
  })
})