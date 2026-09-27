/**
 * GET /api/workbench/today/reconciliation-preview (#1169 WP1)
 */

import { describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({ guardGlobalAdmin: vi.fn() }))
vi.mock('@/lib/auth/require-admin', () => ({ guardGlobalAdmin: mocks.guardGlobalAdmin }))

import { GET } from '../route'

describe('GET /api/workbench/today/reconciliation-preview', () => {
  it('rejects a non-global-admin caller via the same guardGlobalAdmin gate as /api/workbench/today', async () => {
    mocks.guardGlobalAdmin.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))

    const res = await GET()

    expect(res.status).toBe(403)
  })

  it('returns before/after counts, unresolved clusters and reason-coded suppressions for the frozen fixture', async () => {
    mocks.guardGlobalAdmin.mockResolvedValue(null)

    const json = await (await GET()).json()

    expect(json.before).toBe(280)
    expect(json.after).toBe(json.unresolvedClusters.length)
    expect(json.after).toBeLessThan(json.before)
    expect(json.totalSuppressed).toBeGreaterThan(0)
    expect(json.before).toBe(json.totalUnresolvedOccurrences + json.totalSuppressed)
  })
})
