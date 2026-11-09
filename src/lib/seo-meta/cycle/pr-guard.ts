/**
 * SEO Meta-Cycle v1 — PR idempotency for the apply step (step 4).
 *
 * 子牙 finding #2: event replay must not open a second PR for the same
 * candidate. Branch names are DETERMINISTIC (weekKey + slug), so idempotency
 * is a lookup, not a database flag — mirrors flywheel-seo-weekly.ts's
 * `recentlySnapshotted` "check before you spend" pattern, applied to PRs
 * instead of provider calls.
 *
 * PM 2026-09-20 精简拍板: orphaned-PR cleanup (closing stale PRs from
 * earlier weeks) was cut — at ≤3 pages/week for one client, open PRs don't
 * meaningfully accumulate, and it was unexercised code with no real bug
 * pressure behind it. If usage ever grows past that, this is the file to
 * bring it back into.
 */

import type { GithubClient } from '@/lib/cms/github-client'

export const META_CYCLE_BRANCH_PREFIX = 'feat/me-seo-meta-cycle-'

function sanitizeSlugForBranch(slug: string): string {
  return slug.replace(/[^a-z0-9-]/gi, '-').toLowerCase().slice(0, 60)
}

/** Deterministic per (weekKey, slug) — same candidate in the same cycle always maps to the same branch. */
export function metaCycleBranchName(weekKey: string, slug: string): string {
  return `${META_CYCLE_BRANCH_PREFIX}${weekKey}-${sanitizeSlugForBranch(slug)}`
}

export interface PrGuardDecision {
  readonly branch: string
  readonly action: 'reuse_existing' | 'open_new'
  readonly existingPr: { number: number; html_url: string } | null
}

/**
 * Read-only decision function — the caller applies it (opens the PR or not)
 * as its own explicit step.run so the side effect stays visible to
 * Inngest's replay model.
 */
export async function resolvePrGuard(
  github: Pick<GithubClient, 'listPullRequestsByHead'>,
  owner: string,
  repo: string,
  weekKey: string,
  slug: string,
): Promise<PrGuardDecision> {
  const branch = metaCycleBranchName(weekKey, slug)

  // state='all' — an already-merged PR for this exact branch still counts
  // (idempotent against event replay after a successful run, not just
  // against replay before the PR was ever created).
  const exact = await github.listPullRequestsByHead(owner, repo, branch, 'all')
  if (exact.length > 0) {
    return { branch, action: 'reuse_existing', existingPr: { number: exact[0].number, html_url: exact[0].html_url } }
  }

  return { branch, action: 'open_new', existingPr: null }
}
