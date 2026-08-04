/**
 * PR-channel result sync (2026-08-01 root fix, part 2).
 *
 * A blog post published via the GitHub channel enters status 'pr_open' and —
 * before this module — stayed there forever: ME never learned whether the
 * human merged or closed the PR. That breaks two things:
 *   · the content-duplicate gate can't trust blog_posts as a registry
 *   · outcome attribution never starts for the published article
 *
 * Daily (patrol hygiene), every pr_open post polls its PR:
 *   merged        → status 'published' (the article is live; the weekly
 *                   crawl folds it into client_site_pages within a week)
 *   closed unmerged → status 'rejected' + pr_closed marker (human said no)
 *   still open    → untouched
 *
 * Per-client GitHub credentials come from the CMS connection store; clients
 * without a github connection are skipped (their posts can't be pr_open).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { getConnection } from '@/lib/cms/connection-store'
import { GithubClient } from '@/lib/cms/github-client'

interface PrOpenPost {
  id: string
  client_id: string
  pr_number: number | null
  quality_check: Record<string, unknown> | null
}

export interface PrSyncResult {
  checked: number
  published: number
  rejected: number
  errors: number
}

export async function syncPrOpenPosts(
  supabase: SupabaseClient = supabaseAdmin,
): Promise<PrSyncResult> {
  const result: PrSyncResult = { checked: 0, published: 0, rejected: 0, errors: 0 }

  const { data, error } = await supabase
    .from('blog_posts')
    .select('id, client_id, pr_number, quality_check')
    .eq('status', 'pr_open')

  if (error) throw new Error(`pr-sync read failed: ${error.message}`)

  const posts = (data ?? []) as PrOpenPost[]
  if (posts.length === 0) return result

  // One connection fetch per client, not per post.
  const connByClient = new Map<
    string,
    { repoOwner: string; repoName: string; plainToken: string } | null
  >()

  for (const post of posts) {
    if (!post.pr_number) continue
    result.checked += 1

    try {
      if (!connByClient.has(post.client_id)) {
        const conn = await getConnection(post.client_id).catch(() => null)
        connByClient.set(
          post.client_id,
          conn && 'repoOwner' in conn
            ? {
                repoOwner: (conn as { repoOwner: string }).repoOwner,
                repoName: (conn as { repoName: string }).repoName,
                plainToken: (conn as { plainToken: string }).plainToken,
              }
            : null,
        )
      }
      const conn = connByClient.get(post.client_id)
      if (!conn) continue

      const github = new GithubClient(conn.plainToken)
      const pr = await github.getPullRequestState(conn.repoOwner, conn.repoName, post.pr_number)

      if (pr.state === 'open') continue

      const nowIso = new Date().toISOString()
      const update = pr.merged
        ? { status: 'published', published_at: nowIso }
        : {
            status: 'rejected',
            quality_check: { ...(post.quality_check ?? {}), pr_closed: true, pr_closed_at: nowIso },
          }

      const { error: updateErr } = await supabase
        .from('blog_posts')
        .update(update)
        .eq('id', post.id)
        .eq('status', 'pr_open')

      if (updateErr) throw new Error(updateErr.message)
      if (pr.merged) result.published += 1
      else result.rejected += 1
    } catch (err) {
      result.errors += 1
      console.error(
        `[pr-sync] failed for post ${post.id}:`,
        err instanceof Error ? err.message : String(err),
      )
    }
  }

  return result
}
