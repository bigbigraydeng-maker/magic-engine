/**
 * Per-client data freshness — the data behind the "数据新鲜度" strip at the top
 * of a client board. Interface only; no page is shipped in this PR.
 *
 * GET → for this client: which of the six pillars have current data, which have
 *       gone stale, and how many days stale.
 *
 * Scoping rule that matters for Type B (property/listing) clients such as
 * 30 Kiteroa Rothesay Bay: a stream that has NEVER received a row for this
 * client comes back as `not_connected`, never `stale`. Those clients do not run
 * SEO / GEO / social, so those pillars simply read "未接入" and can never raise
 * a false alarm — decided from the client's own data, with no client-type flag
 * to keep in sync and no per-client configuration for anyone to maintain.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { loadFreshnessRegistry, probeStream } from '@/lib/monitoring/freshness-probe'
import {
  evaluateClientStream,
  selectActiveExpectations,
  toClientPillars,
  type ClientStreamFreshness,
} from '@/lib/monitoring/data-freshness'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const now = new Date()

  try {
    const registry = await loadFreshnessRegistry()

    // Only client-scoped streams belong on a client board. Global ones
    // (industry benchmarks, cron heartbeats, the self-heartbeat) are ops
    // concerns and live in the daily PM email instead.
    const active = selectActiveExpectations(registry, now).filter((e) => e.client_column)

    const streams: ClientStreamFreshness[] = []
    for (const expectation of active) {
      const observation = await probeStream(expectation, { clientId })
      streams.push(evaluateClientStream(expectation, observation, now))
    }

    const pillars = toClientPillars(streams)
    const stalePillars = pillars.filter((p) => p.status === 'stale')

    return NextResponse.json({
      clientId,
      checkedAt: now.toISOString(),
      summary: {
        pillarsFresh: pillars.filter((p) => p.status === 'fresh').length,
        pillarsStale: stalePillars.length,
        pillarsNotConnected: pillars.filter((p) => p.status === 'not_connected').length,
        worstStaleDays: stalePillars.length
          ? Math.max(...stalePillars.map((p) => p.staleDays ?? 0))
          : null,
      },
      pillars,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
