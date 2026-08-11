import { randomBytes } from 'crypto'
import { getConnection } from './connection-store'
import { GithubClient, GitHubApiError } from './github-client'
import { sanitizeHtml } from './html-sanitizer'
import {
  patchStaticHtmlPage,
  resolveStaticHtmlPath,
} from './static-html-page-upgrade'
import { CMS_ACTION_TYPE } from './vocabulary'
import { supabaseAdmin } from '../supabase'

export interface GithubPageUpgradeInput {
  clientId: string
  pageId: string
  pageUrl: string
  enhancedTitle: string
  enhancedMetaTitle: string
  enhancedMetaDescription: string
  enhancedHtmlBody: string
  executionItemId?: string
}

export type GithubPageUpgradeResult =
  | {
      ok: true
      prUrl: string
      prNumber: number
      branchName: string
      filePath: string
      updatedFields: string[]
      bodyApplied: boolean
      flywheelActionId: string | null
    }
  | {
      ok: false
      code:
        | 'NO_CONNECTION'
        | 'NO_TARGET'
        | 'GITHUB_READ_ERROR'
        | 'PATCH_ERROR'
        | 'GITHUB_WRITE_ERROR'
        | 'GITHUB_PR_ERROR'
      reason: string
    }

export async function publishPageUpgradeToGithub(
  input: GithubPageUpgradeInput,
): Promise<GithubPageUpgradeResult> {
  let conn: Awaited<ReturnType<typeof getConnection>>
  try {
    conn = await getConnection(input.clientId)
  } catch {
    return { ok: false, code: 'NO_CONNECTION', reason: 'Failed to load the GitHub website connection.' }
  }
  if (!conn || !conn.connected) {
    return {
      ok: false,
      code: 'NO_CONNECTION',
      reason: 'No verified GitHub website connection is configured for this client.',
    }
  }

  const pathResult = resolveStaticHtmlPath(input.pageUrl, conn.contentPaths ?? [])
  if (!pathResult.ok) {
    return { ok: false, code: 'NO_TARGET', reason: pathResult.reason }
  }

  const github = new GithubClient(conn.plainToken)
  let source: string
  let blobSha: string
  try {
    const file = await github.getFileContent(
      conn.repoOwner,
      conn.repoName,
      pathResult.filePath,
      conn.branch,
    )
    source = file.decodedContent
    blobSha = file.sha
  } catch (err) {
    return { ok: false, code: 'GITHUB_READ_ERROR', reason: githubError('reading the target page', err) }
  }

  const patch = patchStaticHtmlPage(source, {
    metaTitle: input.enhancedMetaTitle,
    metaDescription: input.enhancedMetaDescription,
    htmlBody: sanitizeHtml(input.enhancedHtmlBody),
  })
  if (!patch.ok) {
    return { ok: false, code: 'PATCH_ERROR', reason: patch.reason }
  }

  const shortId = randomBytes(4).toString('hex')
  const safeSlug = pageSlug(input.pageUrl)
  const branchName = `feat/me-page-${safeSlug}-${shortId}`

  let baseSha: string
  try {
    baseSha = await github.getBranchSha(conn.repoOwner, conn.repoName, conn.branch)
    await github.createBranch(conn.repoOwner, conn.repoName, branchName, baseSha)
    await github.commitFile(
      conn.repoOwner,
      conn.repoName,
      pathResult.filePath,
      branchName,
      patch.content,
      `feat(website): upgrade ${safeSlug} page [Magic Engine]`,
      blobSha,
    )
  } catch (err) {
    return { ok: false, code: 'GITHUB_WRITE_ERROR', reason: githubError('creating the page upgrade branch', err) }
  }

  let pr: { number: number; html_url: string }
  try {
    pr = await github.createPullRequest(conn.repoOwner, conn.repoName, {
      title: `[Magic Engine] Page upgrade: ${safeSlug}`,
      body: buildPrBody(input, pathResult.filePath, patch.updatedFields, patch.bodyApplied),
      head: branchName,
      base: conn.branch,
    })
  } catch (err) {
    return { ok: false, code: 'GITHUB_PR_ERROR', reason: githubError('opening the page upgrade PR', err) }
  }

  let flywheelActionId: string | null = null
  const { data: action, error: actionError } = await supabaseAdmin
    .from('flywheel_actions')
    .insert({
      client_id: input.clientId,
      execution_item_id: input.executionItemId ?? null,
      flywheel: 'seo',
      action_type: CMS_ACTION_TYPE.UPDATE_EXISTING,
      execution_mode: 'third_party',
      vendor: 'github',
      payload: {
        page_id: input.pageId,
        page_url: input.pageUrl,
        file_path: pathResult.filePath,
        pr_url: pr.html_url,
        pr_number: pr.number,
        branch: branchName,
        updated_fields: patch.updatedFields,
        body_applied: patch.bodyApplied,
        status: 'pr_open',
      },
      // Attribution starts only after the PR is merged. Keeping this null avoids
      // measuring an approved proposal as though it were already live.
      expected_metric: null,
      expected_delta: null,
    })
    .select('id')
    .single()

  if (!actionError && action) flywheelActionId = (action as { id: string }).id

  return {
    ok: true,
    prUrl: pr.html_url,
    prNumber: pr.number,
    branchName,
    filePath: pathResult.filePath,
    updatedFields: patch.updatedFields,
    bodyApplied: patch.bodyApplied,
    flywheelActionId,
  }
}

function pageSlug(pageUrl: string): string {
  try {
    const path = new URL(pageUrl).pathname.replace(/^\/+|\/+$/g, '')
    return (path || 'home').replace(/[^a-z0-9-]+/gi, '-').toLowerCase().slice(0, 60)
  } catch {
    return 'page'
  }
}

function githubError(action: string, err: unknown): string {
  if (err instanceof GitHubApiError) {
    return `GitHub error while ${action}: HTTP ${err.status}. Check repository permissions.`
  }
  return `Unexpected error while ${action}.`
}

function buildPrBody(
  input: GithubPageUpgradeInput,
  filePath: string,
  updatedFields: string[],
  bodyApplied: boolean,
): string {
  return [
    '## Magic Engine — Website Page Upgrade',
    '',
    `**Live page:** ${input.pageUrl}`,
    `**Repository file:** \`${filePath}\``,
    `**Updated fields:** ${updatedFields.join(', ')}`,
    '',
    '### Safety',
    '',
    '- Created on an isolated branch; production is unchanged until this PR is reviewed and merged.',
    bodyApplied
      ? '- The page contains explicit Magic Engine managed-content markers, so the generated body was included.'
      : '- The page has no managed-content markers. Only safe metadata fields were changed; generated body content was not injected.',
    '',
    '### Generated metadata',
    '',
    `- **Page heading proposal:** ${input.enhancedTitle}`,
    `- **Meta title:** ${input.enhancedMetaTitle}`,
    `- **Meta description:** ${input.enhancedMetaDescription}`,
    '',
    '---',
    '_Generated by Magic Engine. Review the diff before merging._',
  ].join('\n')
}
