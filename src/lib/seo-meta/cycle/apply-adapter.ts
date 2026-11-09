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
 * PM 2026-09-20（incident follow-up）: the PR body now ALWAYS includes the
 * full MetaCycleGateEvidence — search volume, difficulty, snapshot date,
 * top-3 competitor titles, this client's own SERP ranking URL, and why this
 * page/keyword was chosen. Root cause: the data was already being fetched
 * (gate.ts) but the PR body template here simply never included it — a
 * template omission, not a failed DataForSEO call. "PM 要能一眼核对" (PM
 * must be able to verify at a glance) is now a hard requirement of this
 * template, not an afterthought.
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
import { scrubString } from '@/lib/mcp/vendor-filter'
import { buildSlugIndex, replaceMetaForSlug } from '@/lib/seo-meta/cts-meta-pr'
import { firstSlugAnchorIsNested } from '@/lib/cms/slug-anchor'
import { identityFromSlug, identityFromUrl, mergeIdentities, ProtectedPageError, unresolvedIdentity, type PageWriteGuard } from '@/lib/seo/protected-pages'
import { resolvePrGuard } from './pr-guard'
import type { ApplyAdapter, ApplyAdapterResult, MetaCycleGateEvidence } from './types'

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

function buildPrBody(slug: string, keyword: string, oldTitle: string, newTitle: string, oldDesc: string, newDesc: string, evidence: MetaCycleGateEvidence): string {
  const competitors = evidence.competitorTitles.length > 0
    ? evidence.competitorTitles.map((t, i) => `  ${i + 1}. ${t}`).join('\n')
    : '  （SERP 前 3 名没有可用标题）'
  // gsc_serp 的"搜索量"其实是页面自己近 28 天的 GSC 曝光次数，不是市场月搜索量——单位标注必须跟着来源变，否则「214/月」会被误读成真实市场搜索量。
  const volumeUnit = evidence.keywordDataSource === 'gsc_serp' ? '（近 28 天 GSC 曝光次数，不是市场月搜索量）' : '/月'
  return [
    `### /${slug}`,
    `目标词:「${keyword}」`,
    `- 搜索量: ${evidence.searchVolume}${volumeUnit} · 难度: ${evidence.keywordDifficulty}/100（数据日期 ${evidence.snapshotDate}）`,
    // 这个 PR 开在客户的公开网站仓库里：来源说明换成封装名（CLAUDE.md 第三方封装名规则）。
    // 只换这一行 —— 标题、描述原文要跟网站上真实改动一字不差。
    `- 数据来源: ${scrubString(evidence.keywordDataNote)}`,
    `- 本页在 SERP 里的排名 URL: ${evidence.ctsRankingUrl ?? '（这次 SERP 结果里没查到本站排这个词）'}`,
    `- 对手前 3 名标题:`,
    competitors,
    `- 为什么选这页/这个词: ${evidence.chosenReason}`,
    '',
    `- 标题: ${oldTitle}`,
    `- → **${newTitle}**`,
    `- 描述: ${oldDesc.slice(0, 80)}…`,
    `- → **${newDesc}**`,
    '',
    '> SEO Meta-Cycle v1 自动改动（title_rewrite）。14 天后回查效果，回归了会下发人工看板任务——点这条 PR 的 Revert 按钮再合并即可改回去。',
  ].join('\n')
}

/**
 * Stateful per-run instance: builds the slug → file index ONCE (lazily, on
 * first apply call) and reuses it for every candidate processed in this
 * client's cycle run, instead of re-scanning the repo per candidate.
 */
export function createCtsRepoApplyAdapter(github: GithubClient, conn: CtsRepoConnection, pageGuard: PageWriteGuard): ApplyAdapter {
  const fileCache = new Map<string, FileCacheEntry>()
  let slugIndex: Map<string, string> | null = null

  async function ensureIndex(): Promise<Map<string, string>> {
    if (slugIndex) return slugIndex
    const dir = await github
      .listDirectory(conn.repoOwner, conn.repoName, conn.dataDir, conn.defaultBranch)
      .catch(() => [])
    // guides.ts (destination guides) is allowed by EXACT name only: its entries use metaTitle/metaDescription
    // and need the 'guide' field style — a look-alike file name must never be edited with the wrong style.
    const dataFiles = dir.filter((e) => e.type === 'file' && /^(seo-pages.*|blogs.*|guides)\.ts$/.test(e.name))
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

    async canEditSlug(slug) {
      if (!slug) return false
      const index = await ensureIndex()
      return index.has(slug)
    },

    async apply({ candidate, newTitle, newDesc, weekKey, dryRun, evidence }) {
      if (!candidate.slug) {
        return { applied: false, newTitle, newDesc, oldTitle: '', oldDesc: '', skipReason: 'no_slug' }
      }
      const index = await ensureIndex()
      const path = index.get(candidate.slug)
      const entry = path ? fileCache.get(path) : undefined
      if (!path || !entry) {
        return { applied: false, newTitle, newDesc, oldTitle: '', oldDesc: '', skipReason: 'slug_not_in_any_data_file' }
      }

      const style = path.split('/').pop() === 'guides.ts' ? 'guide' : 'default'
      const replaced = replaceMetaForSlug(entry.source, candidate.slug, newTitle, newDesc, style)
      if (!replaced) {
        return { applied: false, newTitle, newDesc, oldTitle: '', oldDesc: '', skipReason: 'slug_not_in_file' }
      }

      if (dryRun) {
        return { applied: false, newTitle, newDesc, oldTitle: replaced.oldTitle, oldDesc: replaced.oldDesc, skipReason: 'dry_run' }
      }

      // Protected-page gate: fresh read of the list right before the in-memory edit that will be committed.
      // replaceMetaForSlug edits the window of the FIRST `slug: '<x>'`; if that is a nested reference the edit
      // would land in another entry, so the page being edited is unknown.
      const identity = firstSlugAnchorIsNested(entry.source, candidate.slug, style)
        ? unresolvedIdentity('nested_slug_anchor')
        : mergeIdentities(
            identityFromSlug(candidate.slug),
            ...(candidate.pageUrl ? [identityFromUrl(candidate.pageUrl)] : []),
          )
      try {
        await pageGuard.assert(identity, { targetType: 'data_file_entry' })
      } catch (err) {
        if (err instanceof ProtectedPageError) {
          return { applied: false, newTitle, newDesc, oldTitle: replaced.oldTitle, oldDesc: replaced.oldDesc, skipReason: 'protected_page_blocked' }
        }
        throw err
      }

      const sourceBeforeEdit = entry.source
      entry.source = replaced.updated

      const commit = await commitAndOpenPr(
        candidate.slug,
        path,
        entry,
        weekKey,
        `[Magic Engine] SEO meta-cycle: ${candidate.slug}`,
        buildPrBody(candidate.slug, evidence.keyword, replaced.oldTitle, newTitle, replaced.oldDesc, newDesc, evidence),
      )
      if (!commit.ok) return commit.result

      // The list may have changed between the PR being opened and now: re-check before the auto-merge.
      try {
        await pageGuard.assert(identity, { targetType: 'data_file_entry_merge' })
      } catch (err) {
        if (err instanceof ProtectedPageError) {
          // Roll the in-memory edit back: the file cache is reused by the next candidate of this run, and its
          // commit must not smuggle this (now blocked) protected-page change into another auto-merged PR.
          entry.source = sourceBeforeEdit
          return {
            prUrl: commit.prUrl, prNumber: commit.prNumber, branch: commit.branch,
            newTitle, newDesc, oldTitle: replaced.oldTitle, oldDesc: replaced.oldDesc,
            applied: false, skipReason: 'protected_page_blocked_before_merge',
          }
        }
        throw err
      }
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
