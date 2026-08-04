/**
 * logPackagePublishedAction — the ads dimension no longer promises ROAS.
 *
 * It used to hard-code `ads.account.roas` for every client. A Messenger
 * lead-gen client never accumulates a ROAS row, so those actions were
 * unattributable from the moment they were written.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mockFrom } }))

import { ADS_METRIC_KEY } from '../vocabulary'
import { logPackagePublishedAction } from '../package-publish'

interface Inserted { expected_metric: string | null; flywheel: string }

/**
 * `flywheel_metrics` answers the client-level outcome lookup;
 * `flywheel_actions` captures what got written.
 */
function setup(outcomeRows: Array<{ metric_key: string }>) {
  const captured: Inserted[] = []
  mockFrom.mockImplementation((table: string) => {
    if (table === 'flywheel_metrics') {
      return {
        select: vi.fn().mockReturnThis(),
        eq:     vi.fn().mockReturnThis(),
        in:     vi.fn().mockReturnThis(),
        gte:    vi.fn().mockResolvedValue({ data: outcomeRows, error: null }),
      }
    }
    return {
      insert: vi.fn().mockImplementation((row: Inserted) => {
        captured.push(row)
        return {
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: 'action-1' }, error: null }),
          }),
        }
      }),
    }
  })
  return captured
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('logPackagePublishedAction — ads dimension', () => {
  it('uses the outcome metric this client actually has data for', async () => {
    const captured = setup([{ metric_key: ADS_METRIC_KEY.COST_PER_CONVERSATION }])

    await logPackagePublishedAction({
      packageId: 'pkg-1', clientId: 'kiteroa', dimension: 'ads',
    })

    expect(captured[0].expected_metric).toBe(ADS_METRIC_KEY.COST_PER_CONVERSATION)
    expect(captured[0].expected_metric).not.toBe(ADS_METRIC_KEY.ROAS)
  })

  it('writes NULL rather than a ROAS promise when the client has no ads outcome data', async () => {
    const captured = setup([])

    await logPackagePublishedAction({
      packageId: 'pkg-2', clientId: 'kiteroa', dimension: 'ads',
    })

    expect(captured[0].expected_metric).toBeNull()
  })

  it('leaves the other dimensions on their fixed metrics', async () => {
    const captured = setup([])

    await logPackagePublishedAction({ packageId: 'p', clientId: 'c', dimension: 'seo' })
    expect(captured[0].expected_metric).toBe('seo.domain.organic_traffic')

    await logPackagePublishedAction({ packageId: 'p', clientId: 'c', dimension: 'ai_visibility' })
    expect(captured[1].expected_metric).toBe('geo.query.mention_rate')

    await logPackagePublishedAction({ packageId: 'p', clientId: 'c', dimension: 'social' })
    expect(captured[2].expected_metric).toBe('social.posts.published_count')
  })

  it('still skips the dimensions that have no flywheel', async () => {
    const captured = setup([])
    expect(await logPackagePublishedAction({
      packageId: 'p', clientId: 'c', dimension: 'reputation',
    })).toBeNull()
    expect(captured).toHaveLength(0)
  })
})
