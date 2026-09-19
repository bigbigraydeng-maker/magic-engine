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
  dirty: boolean
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
      if (f) fileCache.set(entry.path, { source: f.decodedContent, sha: f.sha, dirty: false })
    }
    slugIndex = buildSlugIndex(Array.from(fileCache.entries()).map(([path, v]) => ({ path, source: v.source })))
    return slugIndex
  }

  type CommitAndOpenPrResult =
    | { ok: false; result: ApplyAdapterResult }
    | { ok: true; branchOpened: string; prUrl: string; prNumber: number }

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
    return { ok: true, branchOpened: guard.branch, prUrl: pr.html_url ?? '', prNumber: pr.number }
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
        return {
          applied: false,
          newTitle,
          newDesc,
          oldTitle: replaced.oldTitle,
          oldDesc: replaced.oldDesc,
          skipReason: 'dry_run',
        }
      }

      entry.source = replaced.updated
      entry.dirty = true

      const result = await commitAndOpenPr(
        candidate.slug,
        path,
        entry,
        weekKey,
        `[Magic Engine] SEO meta-cycle: ${candidate.slug}`,
        `### /${candidate.slug}\n目标词:「${candidate.keyword}」\n- 标题: ${replaced.oldTitle}\n- → **${newTitle}**\n- 描述: ${replaced.oldDesc.slice(0, 80)}…\n- → **${newDesc}**\n\n> SEO Meta-Cycle v1 自动改动（title_rewrite）。14 天后回查 CTR/排名，回归会自动改回去（连续 2 次回归改进人工看板）。`,
      )
      if (!result.ok) return result.result

      const merged = await github.mergePullRequest(conn.repoOwner, conn.repoName, result.prNumber).catch(() => false)
      return {
        applied: true,
        prUrl: result.prUrl,
        prNumber: result.prNumber,
        branch: result.branchOpened,
        newTitle,
        newDesc,
        oldTitle: replaced.oldTitle,
        oldDesc: replaced.oldDesc,
        skipReason: merged ? undefined : 'pr_opened_but_not_merged',
      }
    },

    async revert({ slug, lastWrittenTitle, lastWrittenDesc, revertToTitle, revertToDesc, weekKey, dryRun }) {
      const index = await ensureIndex()
      const path = index.get(slug)
      const entry = path ? fileCache.get(path) : undefined
      if (!path || !entry) {
        return { applied: false, newTitle: revertToTitle, newDesc: revertToDesc, oldTitle: '', oldDesc: '', skipReason: 'slug_not_in_any_data_file' }
      }

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

      const replaced = replaceMetaForSlug(entry.source, slug, revertToTitle, revertToDesc)
      if (!replaced) {
        return { applied: false, newTitle: revertToTitle, newDesc: revertToDesc, oldTitle: current.title, oldDesc: current.desc, skipReason: 'slug_not_in_file' }
      }
      entry.source = replaced.updated
      entry.dirty = true

      const result = await commitAndOpenPr(
        slug,
        path,
        entry,
        weekKey,
        `[Magic Engine] SEO meta-cycle revert: ${slug}`,
        `### /${slug} — 回归后自动改回去\n- 当前（回归中）: ${replaced.oldTitle}\n- → 改回原文: **${revertToTitle}**\n\n> 上次改动 14 天后 CTR 回归，改回改动前的原文（不是重新生成）。`,
      )
      if (!result.ok) return result.result

      const merged = await github.mergePullRequest(conn.repoOwner, conn.repoName, result.prNumber).catch(() => false)
      return {
        applied: true,
        prUrl: result.prUrl,
        prNumber: result.prNumber,
        branch: result.branchOpened,
        newTitle: revertToTitle,
        newDesc: revertToDesc,
        oldTitle: replaced.oldTitle,
        oldDesc: replaced.oldDesc,
        skipReason: merged ? undefined : 'pr_opened_but_not_merged',
      }
    },
  }
}
