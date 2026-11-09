// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { assertClientOwnsOrigin, persistReceipt, readPageMetrics } from '../post-publish-monitor-store'
import { buildCheckEvents, classifyReceipt, emptyMetrics, parsePageProbe, PostPublishWatchStartedSchema } from '../post-publish-monitor'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'

function chain(result: { data: unknown; error: unknown }) {
  const value: Record<string, unknown> = {}
  value.select = () => value
  value.eq = () => value
  value.order = () => value
  value.limit = () => value
  value.maybeSingle = () => Promise.resolve(result)
  return value
}

describe('post-publish monitor store', () => {
  it('fails closed when the event origin is not the registered client domain', async () => {
    const db = { from: () => chain({ data: { domain: 'ctstours.co.nz' }, error: null }) }
    await expect(assertClientOwnsOrigin(db as never, CLIENT, 'https://evil.example/')).rejects.toThrow('client_origin_mismatch')
    await expect(assertClientOwnsOrigin(db as never, CLIENT, 'https://www.ctstours.co.nz/')).resolves.toBeUndefined()
  })

  it('reads only client-scoped snapshots and matches GSC full URLs to GA4 paths', async () => {
    const tables: string[] = []
    const db = { from(table: string) {
      tables.push(table)
      if (table === 'gsc_performance_snapshots') return chain({ data: { synced_at: '2026-09-19T00:00:00Z', top_pages: [{ page: 'https://www.ctstours.co.nz/guide/', clicks: 2, impressions: 30, ctr: 0.06, position: 8 }] }, error: null })
      return chain({ data: { synced_at: '2026-09-19T00:00:00Z', top_pages: [{ page: '/guide?utm=x', sessions: 7, pageviews: 11 }] }, error: null })
    } }
    const metrics = await readPageMetrics(db as never, CLIENT, 'https://www.ctstours.co.nz/guide')
    expect(tables).toEqual(['gsc_performance_snapshots', 'ga4_traffic_snapshots'])
    expect(metrics.gsc).toMatchObject({ clicks: 2, impressions: 30, position: 8 })
    expect(metrics.ga4).toMatchObject({ sessions: 7, pageviews: 11 })
  })

  it('upserts a deterministic receipt id instead of inserting duplicates', async () => {
    const upsert = vi.fn(async (_row: Record<string, unknown>, _options: { onConflict: string }) => ({ error: null }))
    const db = { from: (table: string) => { expect(table).toBe('cron_run_logs'); return { upsert } } }
    const watch = PostPublishWatchStartedSchema.parse({
      client_id: CLIENT, origin_url: 'https://www.ctstours.co.nz/', launched_at: '2026-09-17T00:00:00+12:00', no_publish: true,
      pages: [{ url: 'https://www.ctstours.co.nz/guide', role: 'guide_hub' }],
    })
    const due = buildCheckEvents(watch)[0].data
    const probe = parsePageProbe({ requestedUrl: due.page.url, status: 200, finalUrl: due.page.url, html: '<link rel="canonical" href="/guide">' })
    const receipt = classifyReceipt({ due, observedAt: '2026-09-20T00:00:00Z', probe, metrics: emptyMetrics() })
    await persistReceipt(db as never, due, receipt)
    await persistReceipt(db as never, due, receipt)
    expect(upsert).toHaveBeenCalledTimes(2)
    expect(upsert.mock.calls[0][0].id).toBe(upsert.mock.calls[1][0].id)
    expect(upsert.mock.calls[0][1]).toEqual({ onConflict: 'id' })
  })
})
