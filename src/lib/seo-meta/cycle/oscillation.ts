/**
 * SEO Meta-Cycle v1 — oscillation cap (子牙 finding #3).
 *
 * If the same slug keeps getting auto-reverted (regress → revert → regress
 * again), the cycle must stop fighting itself and hand the page to the
 * manual review board instead of auto-fixing it forever.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** After this many consecutive auto-reverts on the same slug, force manual review. */
export const OSCILLATION_CAP = 2

export interface OscillationCheck {
  readonly forceManual: boolean
  readonly revertCount: number
  readonly reason: string | null
}

/**
 * Reads the latest seo_meta_log row for (clientId, slug) and checks its
 * revert_count against OSCILLATION_CAP.
 *
 * Fail-closed like recentlySnapshotted (src/lib/flywheel/seo-weekly.ts): a
 * lookup failure forces manual review rather than risking another automated
 * write on a slug we can't currently read the history of.
 */
export async function checkOscillationCap(
  supabase: SupabaseClient,
  clientId: string,
  slug: string,
  /** Same channel filter runStep1CheckDue's own read uses — without it, a row
   *  written by a DIFFERENT apply channel (e.g. the legacy wp-cron flow still
   *  scheduled through 2026-09-28 alongside this rollout) could look "newer"
   *  than this channel's real history and reset revert_count to 0, weakening
   *  the cap it exists to enforce. */
  channel: 'pr' | 'wp_plugin',
): Promise<OscillationCheck> {
  const { data, error } = await supabase
    .from('seo_meta_log')
    .select('revert_count')
    .eq('client_id', clientId)
    .eq('page_slug', slug)
    .eq('applied_channel', channel)
    .order('optimised_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    return { forceManual: true, revertCount: -1, reason: `oscillation_lookup_failed:${error.message}` }
  }

  const revertCount = (data as { revert_count?: number } | null)?.revert_count ?? 0
  if (revertCount >= OSCILLATION_CAP) {
    return {
      forceManual: true,
      revertCount,
      reason: `slug has been auto-reverted ${revertCount} times already (cap ${OSCILLATION_CAP}) — routing to manual review instead of reverting again`,
    }
  }
  return { forceManual: false, revertCount, reason: null }
}
