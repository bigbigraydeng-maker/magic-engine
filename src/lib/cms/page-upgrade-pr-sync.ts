import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { getConnection } from '@/lib/cms/connection-store'
import { GithubClient } from '@/lib/cms/github-client'
import { CMS_ACTION_TYPE } from '@/lib/cms/vocabulary'
import {
  readPrNumber,
  resolvePageUpgradePrTransition,
} from '@/lib/cms/page-upgrade-pr-state'

interface PrOpenPageUpgrade {
  id: string
  client_id: string
  payload: Record<string, unknown> | null
}

export interface PageUpgradePrSyncResult {
  checked: number
  live: number
  rejected: number
  errors: number
}

export async function syncPageUpgradePullRequests(
  supabase: SupabaseClient = supabaseAdmin,
): Promise<PageUpgradePrSyncResult> {
  const result: PageUpgradePrSyncResult = { checked: 0, live: 0, rejected: 0, errors: 0 }

  const { data, error } = await supabase
    .from('flywheel_actions')
    .select('id, client_id, payload')
    .eq('flywheel', 'seo')
    .eq('vendor', 'github')
    .eq('action_type', CMS_ACTION_TYPE.UPDATE_EXISTING)
    .contains('payload', { status: 'pr_open' })

  if (error) throw new Error(`page-upgrade pr-sync read failed: ${error.message}`)

  const actions = (data ?? []) as PrOpenPageUpgrade[]
  const connByClient = new Map<
    string,
    { repoOwner: string; repoName: string; plainToken: string } | null
  >()

  for (const action of actions) {
    const prNumber = readPrNumber(action.payload)
    if (!prNumber) continue
    result.checked += 1

    try {
      if (!connByClient.has(action.client_id)) {
        const conn = await getConnection(action.client_id).catch(() => null)
        connByClient.set(
          action.client_id,
          conn && 'repoOwner' in conn
            ? {
                repoOwner: (conn as { repoOwner: string }).repoOwner,
                repoName: (conn as { repoName: string }).repoName,
                plainToken: (conn as { plainToken: string }).plainToken,
              }
            : null,
        )
      }

      const conn = connByClient.get(action.client_id)
      if (!conn) continue

      const github = new GithubClient(conn.plainToken)
      const pr = await github.getPullRequestState(conn.repoOwner, conn.repoName, prNumber)
      const checkedAt = new Date().toISOString()
      const transition = resolvePageUpgradePrTransition(pr, checkedAt)
      if (!transition) continue

      const payload = {
        ...(action.payload ?? {}),
        status: transition.status,
        ...(transition.status === 'live'
          ? { merged_at: transition.occurredAt }
          : { pr_closed_at: transition.occurredAt }),
      }

      const { data: updatedAction, error: updateError } = await supabase
        .from('flywheel_actions')
        .update({
          payload,
          expected_metric: transition.expectedMetric,
          expected_delta: transition.expectedDelta,
          ...(transition.status === 'live' ? { executed_at: transition.occurredAt } : {}),
        })
        .eq('id', action.id)
        .contains('payload', { status: 'pr_open' })
        .select('id')
        .maybeSingle()

      if (updateError) throw new Error(updateError.message)
      if (!updatedAction) continue
      if (transition.status === 'live') result.live += 1
      else result.rejected += 1
    } catch (err) {
      result.errors += 1
      console.error(
        `[page-upgrade/pr-sync] failed for action ${action.id}:`,
        err instanceof Error ? err.message : String(err),
      )
    }
  }

  return result
}
