/**
 * The shared confirmation route must not mark a go-live card authorized.
 * Opening an ad stays on the go-live decision, which keeps every check there.
 */

import { GO_LIVE_WHAT } from '@/lib/ads-strategy/paused-draft-copy'
import type { KernelDeps } from '@/lib/kernel/deps'
import { readStoredCard } from '@/lib/confirmation-card/view'

export const GO_LIVE_GENERIC_REFUSAL = '这张开投卡不能在这里点。请到「等你点头的广告」页确认。'

export async function blockGoLiveOnGenericDecision(
  kernel: Pick<KernelDeps, 'requireRun'>,
  clientId: string,
  runId: string,
): Promise<string | null> {
  const run = await kernel.requireRun(runId)
  if (run.client_id !== clientId) return null
  const stored = readStoredCard(run.input)
  if (!stored) return null
  const goLive = stored.subjectKey.startsWith('go-live:') || stored.what === GO_LIVE_WHAT
  return goLive ? GO_LIVE_GENERIC_REFUSAL : null
}
