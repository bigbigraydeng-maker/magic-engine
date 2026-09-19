/**
 * SEO Meta-Cycle v1 — CTS repo apply adapter (L3 Connector, per the spec's
 * own tier classification §8: the six-step orchestration is L1, this file
 * is the swappable per-client "how do we actually land the change" adapter
 * plugging into it — Oztop's future WordPress adapter would implement the
 * same `ApplyAdapter` interface without touching runner.ts).
 *
 * Reuses cts-meta-pr.ts's narrow-lane file-editing primitives
 * (replaceMetaForSlug / readMetaForSlug / buildSlugIndex) — those stay
 * CTS-repo-format-specific on purpose (see that file's docstring), so this
 * adapter is the only place that knows about them.
 *
 * 🔴 `applied: true` means MERGED, not just "PR opened". A PR that opened
 *    but failed to merge (CI blocked, branch protection, etc.) must NOT be
 *    treated as a live change — the caller (runner.ts) uses `applied` to
 *    decide whether to write a seo_meta_log baseline row and count the
 *    candidate as done. Logging an unmerged PR as applied would: (a) make
 *    weekly-report/build.ts claim the change is "已生效" (already live)
 *    when the live site is unchanged — a customer-data-red-line violation
 *    (CLAUDE.md §8: reported numbers must be verifiable fact); (b) capture
 *    a baseline_ctr/position for a title that was never actually written,
 *    so the T+14 Check step would compare live GSC data (still reflecting
 *    the OLD title) against a baseline for a change that never happened;
 *    (c) on the next cycle, a bogus "human_edited_since_last_write" skip
 *    could fire on revert, since the live content would never match what
 *    apply() thought it wrote. An unmerged PR is surfaced instead via
 *    `skipReason: 'pr_opened_but_not_merged'` (with prUrl/prNumber kept so
 *    the caller can route it to the manual board — see runner.ts).
 */

import type { GithubClient } from '@/lib/cms/github-client'
import { buildSlugIndex, readMetaForSlug, replaceMetaForSlug } from '@/lib/seo-meta/cts-meta-pr'
import { metaCycleBranchName, resolvePrGuard } from './pr-guard'
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
 * first apply/revert call) and reuses it for every candidate processed in
 * this client's cycle run, instead of re-scanning the repo per candidate.
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

  async function resolveEntry(slug: string): Promise<{ path: string; entry: FileCacheEntry } | null> {
    const index = await ensureIndex()
    const path = index.get(slug)
    const entry = path ? fileCache.get(path) : undefined
    return path && entry ? { path, entry } : null
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

    if (guard.action === 'close_orphans_then_open') {
      for (const orphan of guard.orphans) {
        await github.closePullRequest(conn.repoOwner, conn.repoName, orphan.number).catch(() => undefined)
        await github.deleteBranch(conn.repoOwner, conn.repoName, orphan.branch).catch(() => undefined)
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

  /**
   * Shared by apply() and revert(): write the new title/desc into the cached
   * file, open the PR, and merge it. Returns `applied: true` only when the
   * merge actually succeeds — see the file-header comment.
   */
  async function landEdit(
    slug: string,
    path: string,
    entry: FileCacheEntry,
    newTitle: string,
    newDesc: string,
    weekKey: string,
    buildPr: (oldTitle: string, oldDesc: string) => { title: string; body: string },
  ): Promise<ApplyAdapterResult> {
    const replaced = replaceMetaForSlug(entry.source, slug, newTitle, newDesc)
    if (!replaced) {
      return { applied: false, newTitle, newDesc, oldTitle: '', oldDesc: '', skipReason: 'slug_not_in_file' }
    }
    entry.source = replaced.updated

    const pr = buildPr(replaced.oldTitle, replaced.oldDesc)
    const commit = await commitAndOpenPr(slug, path, entry, weekKey, pr.title, pr.body)
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
    return merged
      ? { ...base, applied: true }
      : { ...base, applied: false, skipReason: 'pr_opened_but_not_merged' }
  }

  return {
    channel: 'pr',

    async apply({ candidate, newTitle, newDesc, weekKey, dryRun }) {
      if (!candidate.slug) {
        return { applied: false, newTitle, newDesc, oldTitle: '', oldDesc: '', skipReason: 'no_slug' }
      }
      const resolved = await resolveEntry(candidate.slug)
      if (!resolved) {
        return { applied: false, newTitle, newDesc, oldTitle: '', oldDesc: '', skipReason: 'slug_not_in_any_data_file' }
      }
      const { path, entry } = resolved

      if (dryRun) {
        const preview = readMetaForSlug(entry.source, candidate.slug)
        return { applied: false, newTitle, newDesc, oldTitle: preview?.title ?? '', oldDesc: preview?.desc ?? '', skipReason: 'dry_run' }
      }

      return landEdit(candidate.slug, path, entry, newTitle, newDesc, weekKey, (oldTitle, oldDesc) => ({
        title: `[Magic Engine] SEO meta-cycle: ${candidate.slug}`,
        body: `### /${candidate.slug}\n目标词:「${candidate.keyword}」\n- 标题: ${oldTitle}\n- → **${newTitle}**\n- 描述: ${oldDesc.slice(0, 80)}…\n- → **${newDesc}**\n\n> SEO Meta-Cycle v1 自动改动（title_rewrite）。14 天后回查 CTR/排名，回归会自动改回去（连续 2 次回归改进人工看板）。`,
      }))
    },

    async revert({ slug, lastWrittenTitle, lastWrittenDesc, revertToTitle, revertToDesc, weekKey, dryRun }) {
      const resolved = await resolveEntry(slug)
      if (!resolved) {
        return { applied: false, newTitle: revertToTitle, newDesc: revertToDesc, oldTitle: '', oldDesc: '', skipReason: 'slug_not_in_any_data_file' }
      }
      const { path, entry } = resolved

      // 魏征 finding #7: TRUE revert only. Confirm the live content still
      // matches what we last wrote — if a human hand-edited the slug in
      // GitHub since then, do NOT clobber it. Route to manual review instead.
      const current = readMetaForSlug(entry.source, slug)
      if (!current || current.title !== lastWrittenTitle || current.desc !== lastWrittenDesc) {
        return {
          applied: false,
          newTitle: revertToTitle,
          newDesc: revertToDesc,
          oldTitle: current?.title ?? '',
          oldDesc: current?.desc ?? '',
          skipReason: 'human_edited_since_last_write',
        }
      }

      if (dryRun) {
        return { applied: false, newTitle: revertToTitle, newDesc: revertToDesc, oldTitle: current.title, oldDesc: current.desc, skipReason: 'dry_run' }
      }

      return landEdit(slug, path, entry, revertToTitle, revertToDesc, weekKey, (oldTitle) => ({
        title: `[Magic Engine] SEO meta-cycle revert: ${slug}`,
        body: `### /${slug} — 回归后自动改回去\n- 当前（回归中）: ${oldTitle}\n- → 改回原文: **${revertToTitle}**\n\n> 上次改动 14 天后 CTR 回归，改回改动前的原文（不是重新生成）。`,
      }))
    },
  }
}
