/**
 * POST /api/clients/[id]/cms/publish-geo-to-github
 *
 * GitHub PR-style deployment for GEO directives — B2 (GEO-B+ Stage 1):
 * template-injection mode.
 *
 * Reads the client's connected GitHub repo + the content_targets list, then for
 * each target with role=global_head and syntax∈{html,php}:
 *   1. Fetches the file from the default branch (HEAD blobSha captured)
 *   2. Computes the hash of any existing ME-GEO marker block in the live file
 *   3. Compares against the hash recorded in geo_deployments for that target
 *      → mismatch flags EXTERNAL_DRIFT unless caller passes force_overwrite
 *   4. Generates new file content with the injector
 *   5. Closes any prior still-open PR + deletes its branch (preserves review
 *      history of the old PR instead of force-pushing)
 *   6. Creates a fresh branch + commits each file via blobSha (GitHub's
 *      native If-Match guard rejects stale SHAs → no silent overwrite if
 *      main moved between read and write)
 *   7. Opens a PR + records geo_deployments rows
 *
 * Body: { force_overwrite?: boolean }
 *
 * Response (200): {
 *   success: true,
 *   pr_url, pr_number, branch,
 *   target_paths: string[],
 * }
 *
 * Response (422 EXTERNAL_DRIFT): {
 *   success: false,
 *   code: 'EXTERNAL_DRIFT',
 *   drifted_targets: [{path, expected_hash, live_hash}],
 *   hint: 'Re-publish with force_overwrite=true to replace external edits.',
 * }
 *
 * Security: requireDashboardClientAccess (session-cookie auth)
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { getConnection } from '@/lib/cms/connection-store'
import { GithubClient, GitHubApiError } from '@/lib/cms/github-client'
import {
  injectGeoSnippet,
  readExistingInjectedHash,
  HeadTagNotFoundError,
  SnippetContainsMarkerError,
} from '@/lib/cms/snippet-injector'
import {
  findLatestLiveDeployment,
  findOpenDeployment,
  markSuperseded,
  recordDeployment,
  ConcurrentDeploymentError,
} from '@/lib/cms/geo-deployments-store'
import { generateDirectiveHtml } from '@/lib/geo/html-generator'
import type {
  CmsContentTarget,
  CmsContentTargetSyntax,
} from '@/lib/cms/vocabulary'
import type { GeoDirective } from '@/types/magic-engine'

interface RouteContext {
  params: { id: string }
}

interface DriftEntry {
  path:          string
  expected_hash: string
  live_hash:     string
}

/** Targets we know how to inject into via this code path. */
const SUPPORTED_INJECTOR_SYNTAX: ReadonlySet<CmsContentTargetSyntax> = new Set<CmsContentTargetSyntax>([
  'html',
  'php',
])

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  // Parse body (force_overwrite is the only field, all optional)
  let body: { force_overwrite?: unknown } = {}
  try {
    const raw = await req.text()
    body = raw ? JSON.parse(raw) : {}
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body', code: 'INVALID_INPUT' },
      { status: 400 },
    )
  }
  const forceOverwrite = body.force_overwrite === true

  // ── Load connection ────────────────────────────────────────────────────────
  const conn = await getConnection(clientId)
  if (!conn) {
    return NextResponse.json(
      { success: false, error: 'No GitHub repository connected', code: 'NO_CONNECTION' },
      { status: 422 },
    )
  }
  if (conn.status !== 'connected') {
    return NextResponse.json(
      { success: false, error: 'GitHub connection is not verified. Re-test in Settings.', code: 'CONNECTION_NOT_VERIFIED' },
      { status: 422 },
    )
  }

  // ── Pick injection targets ────────────────────────────────────────────────
  const eligibleTargets: CmsContentTarget[] = conn.contentTargets.filter(
    (t) => t.role === 'global_head' && SUPPORTED_INJECTOR_SYNTAX.has(t.syntax),
  )
  if (eligibleTargets.length === 0) {
    return NextResponse.json(
      {
        success: false,
        error:   'No injection targets configured. Add at least one HTML or PHP template path in Settings → Website Connection.',
        code:    'NO_TARGETS_CONFIGURED',
      },
      { status: 422 },
    )
  }

  // ── Load active directive ─────────────────────────────────────────────────
  const { data: directiveRow, error: dirErr } = await supabaseAdmin
    .from('geo_directives')
    .select('*')
    .eq('client_id', clientId)
    .eq('status', 'active')
    .maybeSingle()

  if (dirErr) {
    return NextResponse.json(
      { success: false, error: `Failed to fetch GEO directive: ${dirErr.message}` },
      { status: 500 },
    )
  }
  if (!directiveRow) {
    return NextResponse.json(
      { success: false, error: 'No active GEO directive found. Create one first.', code: 'NO_DIRECTIVE' },
      { status: 404 },
    )
  }

  const directive = directiveRow as GeoDirective
  const snippetHtml = generateDirectiveHtml(directive)

  const gh    = new GithubClient(conn.plainToken)
  const owner = conn.repoOwner
  const repo  = conn.repoName
  const base  = conn.branch || 'main'

  // ── Drift detection + per-target prep ─────────────────────────────────────
  // Read each target, compute live hash, compare against geo_deployments. If
  // any target shows drift and !forceOverwrite, refuse without touching GitHub.
  interface PreparedTarget {
    target:          CmsContentTarget
    currentContent:  string
    blobSha:         string
    nextContent:     string
    injectedHash:    string
  }

  const prepared:  PreparedTarget[] = []
  const drift:     DriftEntry[]     = []

  try {
    for (const target of eligibleTargets) {
      const file = await gh.getFileContent(owner, repo, target.path, base)
      const liveHash = readExistingInjectedHash(file.decodedContent)
      const lastDeployment = await findLatestLiveDeployment(clientId, directive.id, target.path)

      // Drift = the file currently has a ME-GEO block whose content does NOT
      // match what ME last wrote (per geo_deployments). Could be a human edit
      // inside the markers, or a state-reset on the file. We refuse unless
      // the caller explicitly opts in.
      if (
        liveHash !== null &&
        lastDeployment !== null &&
        liveHash !== lastDeployment.injected_hash &&
        !forceOverwrite
      ) {
        drift.push({
          path:          target.path,
          expected_hash: lastDeployment.injected_hash,
          live_hash:     liveHash,
        })
        continue
      }

      // MF4 (魏征 B2 review): orphan block — the file has a ME-GEO block but
      // we have no DB record of writing it. Could be (a) DB cleanup after a
      // directive archive cascaded, (b) cross-environment migration, or (c)
      // someone hand-injected a fake marker block. In every case the safe
      // default is to refuse to overwrite silently; force_overwrite lets the
      // FDE proceed once they've decided.
      if (
        liveHash !== null &&
        lastDeployment === null &&
        !forceOverwrite
      ) {
        drift.push({
          path:          target.path,
          expected_hash: 'orphan_no_record',
          live_hash:     liveHash,
        })
        continue
      }

      let injection
      try {
        injection = injectGeoSnippet(
          file.decodedContent,
          snippetHtml,
          target.syntax,
          target.path,
        )
      } catch (err) {
        if (err instanceof HeadTagNotFoundError) {
          return NextResponse.json(
            {
              success: false,
              error:   err.message,
              code:    'HEAD_TAG_NOT_FOUND',
              target:  target.path,
            },
            { status: 422 },
          )
        }
        if (err instanceof SnippetContainsMarkerError) {
          return NextResponse.json(
            {
              success: false,
              error:   err.message,
              code:    'SNIPPET_CONTAINS_MARKER',
              target:  target.path,
            },
            { status: 422 },
          )
        }
        throw err
      }

      prepared.push({
        target,
        currentContent: file.decodedContent,
        blobSha:        file.sha,
        nextContent:    injection.newContent,
        injectedHash:   injection.injectedHash,
      })
    }
  } catch (err) {
    if (err instanceof GitHubApiError) {
      if (err.status === 404) {
        return NextResponse.json(
          { success: false, error: `Template file not found in repo (${err.message}). Update content_targets in Settings.`, code: 'TEMPLATE_NOT_FOUND' },
          { status: 422 },
        )
      }
      return NextResponse.json(
        { success: false, error: `GitHub API error: ${err.message}`, code: 'GITHUB_API_ERROR' },
        { status: 502 },
      )
    }
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[publish-geo-to-github prep]', clientId, message)
    return NextResponse.json(
      { success: false, error: message, code: 'INTERNAL' },
      { status: 500 },
    )
  }

  if (drift.length > 0) {
    return NextResponse.json(
      {
        success:          false,
        code:             'EXTERNAL_DRIFT',
        error:            `${drift.length} target(s) were edited outside Magic Engine since the last publish.`,
        drifted_targets:  drift,
        hint:             'Re-publish with force_overwrite=true to replace the external edits.',
      },
      { status: 422 },
    )
  }

  // ── Close any prior still-open PR for any of these targets ────────────────
  //
  // MF5: only attempt to delete the stale branch if the PR close succeeded —
  //      otherwise we end up with the PR still open AND its branch gone, which
  //      GitHub then auto-closes with a confusing "branch deleted" status that
  //      ME's webhook (B3) has no way to reconcile.
  // MF3: markSuperseded is wrapped in try/catch and falls through on failure —
  //      a stale DB row is a self-healing condition (next publish's
  //      ConcurrentDeploymentError will re-detect and another supersede pass
  //      will tidy it), whereas a thrown exception here would surface as 500
  //      AFTER we've already mutated GitHub state.
  for (const { target } of prepared) {
    const open = await findOpenDeployment(clientId, directive.id, target.path)
    if (!open) continue

    let closeOk = false
    try {
      await gh.closePullRequest(owner, repo, open.pr_number)
      closeOk = true
    } catch (err) {
      // 404 = PR was already closed externally — that's fine, proceed to delete.
      if (err instanceof GitHubApiError && err.status === 404) {
        closeOk = true
      } else {
        console.warn('[publish-geo-to-github] failed to close stale PR', open.pr_number, err)
      }
    }

    if (closeOk) {
      try {
        await gh.deleteBranch(owner, repo, open.branch)
      } catch (err) {
        if (!(err instanceof GitHubApiError && err.status === 404)) {
          console.warn('[publish-geo-to-github] failed to delete stale branch', open.branch, err)
        }
      }
    }

    try {
      await markSuperseded(open.id)
    } catch (err) {
      console.warn('[publish-geo-to-github] markSuperseded failed for row', open.id, err)
    }
  }

  // ── Open a fresh branch + commit + PR ─────────────────────────────────────
  const shortId    = directive.id.slice(0, 8)
  const branchName = `geo-directive/${shortId}-${Date.now()}`

  // MF2 (魏征 B2 review): track whether the branch was created so we can
  // best-effort delete it if the commit-or-PR phase blows up partway through.
  // Without this a failed commitFile #N leaves a half-populated branch
  // forever — no PR, no DB record, just orphan branches piling up in the
  // client repo.
  let branchCreated = false

  try {
    const baseSha = await gh.getBranchSha(owner, repo, base)
    await gh.createBranch(owner, repo, branchName, baseSha)
    branchCreated = true

    for (const item of prepared) {
      // blobSha threading — if main moved between our earlier getFileContent
      // and now, GitHub returns 409/422 sha mismatch instead of clobbering
      // the FDE's concurrent change. Caller can retry.
      await gh.commitFile(
        owner,
        repo,
        item.target.path,
        branchName,
        item.nextContent,
        `chore(geo): inject directive ${shortId} into ${item.target.path}`,
        item.blobSha,
      )
    }

    const prTitle = `GEO Directive ${shortId} — inject into ${prepared.length} file${prepared.length === 1 ? '' : 's'}`
    const prBody  = renderPrBody(shortId, prepared.map(p => p.target.path))
    const pr = await gh.createPullRequest(owner, repo, {
      title: prTitle,
      body:  prBody,
      head:  branchName,
      base,
    })

    // Record one deployment row per target.
    //
    // MF6: the partial unique index on (client_id, directive_id, target_path)
    //      WHERE status='pending_pr' guarantees at most one in-flight row per
    //      target. A concurrent publish racing past findOpenDeployment lands
    //      here and hits 23505 → ConcurrentDeploymentError → 422.
    try {
      for (const item of prepared) {
        await recordDeployment({
          clientId,
          directiveId:  directive.id,
          targetPath:   item.target.path,
          branch:       branchName,
          prNumber:     pr.number,
          prUrl:        pr.html_url,
          injectedHash: item.injectedHash,
        })
      }
    } catch (err) {
      if (err instanceof ConcurrentDeploymentError) {
        // Roll back the GitHub side: close the PR + delete the branch so the
        // FDE doesn't see a phantom open PR with no DB tracking. This is best-
        // effort — failures are logged but don't change the response.
        try { await gh.closePullRequest(owner, repo, pr.number) } catch (e) {
          console.warn('[publish-geo-to-github] rollback closePullRequest failed', e)
        }
        try { await gh.deleteBranch(owner, repo, branchName) } catch (e) {
          console.warn('[publish-geo-to-github] rollback deleteBranch failed', e)
        }
        return NextResponse.json(
          {
            success: false,
            error:   'Another publish is already in flight for this directive. Wait for it to finish and retry.',
            code:    'CONCURRENT_PUBLISH_IN_PROGRESS',
          },
          { status: 422 },
        )
      }
      throw err
    }

    return NextResponse.json({
      success:      true,
      pr_url:       pr.html_url,
      pr_number:    pr.number,
      branch:       branchName,
      target_paths: prepared.map(p => p.target.path),
    })
  } catch (err) {
    // MF2: clean up the half-built branch so the client repo doesn't accumulate
    // orphan refs. We swallow the cleanup failure — the original error is what
    // the FDE cares about.
    if (branchCreated) {
      try {
        await gh.deleteBranch(owner, repo, branchName)
      } catch (cleanupErr) {
        console.warn('[publish-geo-to-github] failed to clean up half-built branch', branchName, cleanupErr)
      }
    }

    if (err instanceof GitHubApiError) {
      if (err.status === 409 || (err.status === 422 && /sha/i.test(err.message))) {
        return NextResponse.json(
          {
            success: false,
            error:   'Repository state changed during publish — please retry.',
            code:    'STALE_BLOB_SHA',
          },
          { status: 409 },
        )
      }
      return NextResponse.json(
        { success: false, error: `GitHub API error: ${err.message}`, code: 'GITHUB_API_ERROR' },
        { status: 502 },
      )
    }
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[publish-geo-to-github commit]', clientId, message)
    return NextResponse.json(
      { success: false, error: message, code: 'INTERNAL' },
      { status: 500 },
    )
  }
}

/**
 * MF7 (魏征 B2 review): keep the internal clientId UUID out of the PR body.
 * That description ships to the customer's GitHub repo where any collaborator
 * — or anyone they screenshot a PR to — can read it. Use the directive's
 * shortId only; it's stable, identifying, and not a route handle.
 */
function renderPrBody(directiveShortId: string, paths: string[]): string {
  return `## GEO Directive Injection

Directive \`${directiveShortId}\`

### Files updated
${paths.map(p => `- \`${p}\``).join('\n')}

### What this does
Injects the active GEO directive snippet into the \`<head>\` of each template above. The block is wrapped in \`ME-GEO-START\` / \`ME-GEO-END\` markers so subsequent updates replace it cleanly.

> Generated by Magic Engine · GEO-B+ Stage 1`
}
