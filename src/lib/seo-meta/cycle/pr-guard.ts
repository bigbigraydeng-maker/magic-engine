/**
 * SEO Meta-Cycle v1 — PR idempotency + orphaned-PR handling for the apply
 * step (step 4).
 *
 * 子牙 finding #2: event replay must not open a second PR for the same
 * candidate. Branch names are DETERMINISTIC (weekKey + slug), so idempotency
 * is a lookup, not a database flag — mirrors flywheel-seo-weekly.ts's
 * `recentlySnapshotted` "check before you spend" pattern, applied to PRs
 * instead of provider calls.
 *
 * 魏征 finding #8: before opening a new PR for a candidate, check the repo
 * for any still-open PR from a PREVIOUS cycle touching the same slug and
 * decide to close it rather than letting automation branches pile up
 * unbounded.
 */

import type { GithubClient } from '@/lib/cms/github-client'

export const META_CYCLE_BRANCH_PREFIX = 'feat/me-seo-meta-cycle-'

const BRANCH_RE = /^feat\/me-seo-meta-cycle-(\d{4}-W\d{2})-(.+)$/

function sanitizeSlugForBranch(slug: string): string {
  return slug.replace(/[^a-z0-9-]/gi, '-').toLowerCase().slice(0, 60)
}

/** Deterministic per (weekKey, slug) — same candidate in the same cycle always maps to the same branch. */
export function metaCycleBranchName(weekKey: string, slug: string): string {
  return `${META_CYCLE_BRANCH_PREFIX}${weekKey}-${sanitizeSlugForBranch(slug)}`
}

export function parseMetaCycleBranch(ref: string): { weekKey: string; slug: string } | null {
  const m = BRANCH_RE.exec(ref)
  if (!m) return null
  return { weekKey: m[1], slug: m[2] }
}

export interface PrGuardDecision {
  readonly branch: string
  /**
   * · `reuse_existing`       — a PR (open or merged) already exists for this
   *                            exact (weekKey, slug) — do not open another.
   * · `close_orphans_then_open` — no PR for this week's branch yet, but ≥1
   *                            open PR from an earlier week touches this slug
   *                            — close those first, then open a fresh PR.
   * · `open_new`             — no exact match, no orphans, proceed normally.
   */
  readonly action: 'reuse_existing' | 'close_orphans_then_open' | 'open_new'
  readonly existingPr: { number: number; html_url: string } | null
  readonly orphans: ReadonlyArray<{ number: number; branch: string; weekKey: string }>
}

/**
 * Read-only decision function — callers apply the decision (close PRs / skip
 * opening) as their own explicit step.run so the side effect stays visible
 * to Inngest's replay model.
 */
export async function resolvePrGuard(
  github: Pick<GithubClient, 'listPullRequestsByHead' | 'listPullRequestsByBranchPrefix'>,
  owner: string,
  repo: string,
  weekKey: string,
  slug: string,
): Promise<PrGuardDecision> {
  const branch = metaCycleBranchName(weekKey, slug)

  const exact = await github.listPullRequestsByHead(owner, repo, branch, 'all')
  if (exact.length > 0) {
    return {
      branch,
      action: 'reuse_existing',
      existingPr: { number: exact[0].number, html_url: exact[0].html_url },
      orphans: [],
    }
  }

  const openUnderPrefix = await github.listPullRequestsByBranchPrefix(owner, repo, META_CYCLE_BRANCH_PREFIX)
  const orphans = openUnderPrefix
    .map((pr) => {
      const parsed = parseMetaCycleBranch(pr.head.ref)
      return parsed && parsed.slug === sanitizeSlugForBranch(slug) && parsed.weekKey !== weekKey
        ? { number: pr.number, branch: pr.head.ref, weekKey: parsed.weekKey }
        : null
    })
    .filter((v): v is { number: number; branch: string; weekKey: string } => v !== null)

  return {
    branch,
    action: orphans.length > 0 ? 'close_orphans_then_open' : 'open_new',
    existingPr: null,
    orphans,
  }
}
