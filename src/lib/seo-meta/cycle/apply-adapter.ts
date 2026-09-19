/**
 * SEO Meta-Cycle v1 — CTS repo apply adapter (L3 Connector, per the spec's
 * own tier classification §8: the six-step orchestration is L1, this file
 * is the swappable per-client "how do we actually land the change" adapter
 * plugging into it — Oztop's future WordPress adapter would implement the
 * same `ApplyAdapter` interface without touching runner.ts).
 *
 * Reuses cts-meta-pr.ts's narrow-lane file-editing primitives
 * (replaceMetaForSlug / buildSlugIndex) — those stay CTS-repo-format-specific
 * on purpose (see that file's docstring), so this adapter is the only place
 * that knows about them.
 *
 * PM 2026-09-20 精简拍板: auto-revert is cut — there is no `revert()` method
 * anymore. A regressed change becomes a manual kanban item pointing at this
 * PR's own GitHub "Revert" button (runner.ts), not new code here.
 *
 * 🔴 `applied: true` means MERGED, not just "PR opened". A PR that opened
 *    but failed to merge (CI blocked, branch protection, etc.) must NOT be
 *    treated as a live change — the caller (runner.ts) uses `applied` to
 *    decide whether to write a seo_meta_log baseline row and count the
 *    candidate as done. Logging an unmerged PR as applied would make
 *    weekly-report/build.ts claim the change is "已生效" (already live)
 *    when the live site is unchanged — a customer-data-red-line violation
 *    (CLAUDE.md §8: reported numbers must be verifiable fact). An unmerged
 *    PR is surfaced instead via `skipReason: 'pr_opened_but_not_merged'`
 *    (with prUrl/prNumber kept so the caller can route it to the manual
 *    board — see runner.ts).
 */

import type { GithubClient } from '@/lib/cms/github-client'
import { buildSlugIndex, replaceMetaForSlug } from '@/lib/seo-meta/cts-meta-pr'
import { resolvePrGuard } from './pr-guard'
import type { ApplyAdapter, ApplyAdapterResult } from './types'

export interface CtsRepoConnection {
  repoOwner: string
  repoName: string
  defaultBranch: string
  dataDir: string
}

interface FileCacheEntry {
  source: string
  sha: string
}

/**
 * Stateful per-run instance: builds the slug → file index ONCE (lazily, on
 * first apply call) and reuses it for every candidate processed in this
 * client's cycle run, instead of re-scanning the repo per candidate.
 */
export function createCtsRepoApplyAdapter(github: GithubClient, conn: CtsRepoConnection): ApplyAdapter {
  const fileCache = new Map<string, FileCacheEntry>()
  let slugIndex: Map<string, string> | null = null

  async function ensureIndex(): Promise<Map<string, string>> {
    if (slugIndex) return slugIndex
    const dir = await github
      .listDirectory(conn.repoOwner, conn.repoName, conn.dataDir, conn.defaultBranch)
      .catch(() => [])
    const dataFiles = dir.filter((e) => e.type === 'file' && /^(seo-pages|blogs).*\.ts$/.test(e.name))
    for (const entry of dataFiles) {
      const f = await github
        .getFileContent(conn.repoOwner, conn.repoName, entry.path, conn.defaultBranch)
        .catch(() => null)
      if (f) fileCache.set(entry.path, { source: f.decodedContent, sha: f.sha })
    }
    slugIndex = buildSlugIndex(Array.from(fileCache.entries()).map(([path, v]) => ({ path, source: v.source })))
    return slugIndex
  }

  type CommitAndOpenPrResult =
    | { ok: false; result: ApplyAdapterResult }
    | { ok: true; branch: string; prUrl: string; prNumber: number }

  async function commitAndOpenPr(
    slug: string,
    path: string,
    entry: FileCacheEntry,
    weekKey: string,
    prTitle: string,
    prBody: string,
  ): Promise<CommitAndOpenPrResult> {
    const guard = await resolvePrGuard(github, conn.repoOwner, conn.repoName, weekKey, slug)

    if (guard.action === 'reuse_existing' && guard.existingPr) {
      return {
        ok: false,
        result: {
          applied: false,
          prUrl: guard.existingPr.html_url,
          prNumber: guard.existingPr.number,
          branch: guard.branch,
          newTitle: '',
          newDesc: '',
          oldTitle: '',
          oldDesc: '',
          skipReason: `pr_already_exists_for_this_cycle:${guard.existingPr.number}`,
        },
      }
    }

    const baseSha = await github.getBranchSha(conn.repoOwner, conn.repoName, conn.defaultBranch)
    await github.createBranch(conn.repoOwner, conn.repoName, guard.branch, baseSha)
    await github.commitFile(
      conn.repoOwner,
      conn.repoName,
      path,
      guard.branch,
      entry.source,
      `seo: meta-cycle update for ${path.split('/').pop()} [Magic Engine]`,
      entry.sha,
    )
    const pr = await github.createPullRequest(conn.repoOwner, conn.repoName, {
      title: prTitle,
      body: prBody,
      head: guard.branch,
      base: conn.defaultBranch,
    })
    return { ok: true, branch: guard.branch, prUrl: pr.html_url ?? '', prNumber: pr.number }
  }

  return {
    channel: 'pr',

    async apply({ candidate, newTitle, newDesc, weekKey, dryRun }) {
      if (!candidate.slug) {
        return { applied: false, newTitle, newDesc, oldTitle: '', oldDesc: '', skipReason: 'no_slug' }
      }
      const index = await ensureIndex()
      const path = index.get(candidate.slug)
      const entry = path ? fileCache.get(path) : undefined
      if (!path || !entry) {
        return { applied: false, newTitle, newDesc, oldTitle: '', oldDesc: '', skipReason: 'slug_not_in_any_data_file' }
      }

      const replaced = replaceMetaForSlug(entry.source, candidate.slug, newTitle, newDesc)
      if (!replaced) {
        return { applied: false, newTitle, newDesc, oldTitle: '', oldDesc: '', skipReason: 'slug_not_in_file' }
      }

      if (dryRun) {
        return { applied: false, newTitle, newDesc, oldTitle: replaced.oldTitle, oldDesc: replaced.oldDesc, skipReason: 'dry_run' }
      }

      entry.source = replaced.updated

      const commit = await commitAndOpenPr(
        candidate.slug,
        path,
        entry,
        weekKey,
        `[Magic Engine] SEO meta-cycle: ${candidate.slug}`,
        `### /${candidate.slug}\n目标词:「${candidate.keyword}」\n- 标题: ${replaced.oldTitle}\n- → **${newTitle}**\n- 描述: ${replaced.oldDesc.slice(0, 80)}…\n- → **${newDesc}**\n\n> SEO Meta-Cycle v1 自动改动（title_rewrite）。14 天后回查效果，回归了会下发人工看板任务——点这条 PR 的 Revert 按钮再合并即可改回去。`,
      )
      if (!commit.ok) return commit.result

      const merged = await github.mergePullRequest(conn.repoOwner, conn.repoName, commit.prNumber).catch(() => false)
      const base = {
        prUrl: commit.prUrl,
        prNumber: commit.prNumber,
        branch: commit.branch,
        newTitle,
        newDesc,
        oldTitle: replaced.oldTitle,
        oldDesc: replaced.oldDesc,
      }
      return merged ? { ...base, applied: true } : { ...base, applied: false, skipReason: 'pr_opened_but_not_merged' }
    },
  }
}
