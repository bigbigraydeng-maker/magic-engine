/**
 * Blog Publisher — pushes a generated blog post to the client's GitHub repo as a PR.
 *
 * Flow:
 *  1. Load CMS connection (decrypted PAT — server only).
 *  2. Fetch the blog_post record from Supabase.
 *  3. Serialize post to Markdown with frontmatter.
 *  4. Create a feature branch.
 *  5. Commit the new file (no existing blobSha — this is a new file).
 *  6. Open a pull request.
 *  7. Record the action in flywheel_actions.
 *
 * Security: the decrypted PAT is used only within this function scope and
 * never stored in any variable that escapes to a response or log.
 */

import { randomBytes } from 'crypto'
import { getConnection } from './connection-store'
import { GithubClient, GitHubApiError } from './github-client'
import { CMS_ACTION_TYPE } from './vocabulary'
import { supabaseAdmin } from '../supabase'
import { buildBlogBodyHtml, buildArticleSchemaScript } from '../blog/html-builder'
import type { ArticleSchemaPost } from '../blog/html-builder'

const ME_BLOG_BRANCH_PREFIX = 'feat/me-blog-'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BlogPublishInput {
  clientId:        string
  blogPostId:      string
  executionItemId?: string
}

export type BlogPublishResult =
  | { ok: true;  prUrl: string; prNumber: number; branchName: string; flywheelActionId: string }
  | { ok: false; reason: string; code: BlogPublishErrorCode }

export type BlogPublishErrorCode =
  | 'NO_CONNECTION'
  | 'NO_POST'
  | 'GITHUB_BRANCH_ERROR'
  | 'GITHUB_WRITE_ERROR'
  | 'GITHUB_PR_ERROR'
  | 'FLYWHEEL_ERROR'

interface BlogPostRow {
  id:               string
  client_id:        string
  title:            string
  meta_title:       string
  meta_description: string
  slug:             string | null
  html_body:        string
  word_count:       number | null
  status:           string
  source_query_text?: string | null
  geo_html_snapshot: string | null
  featured_image_url: string | null
  pr_url?:           string | null
  pr_number?:        number | null
  // P14.C.4: schema needs publication dates so Google sees valid BlogPosting
  created_at?:      string
  updated_at?:      string
  published_at?:    string | null
}

// ─── publishBlogToGitHub ──────────────────────────────────────────────────────

export async function publishBlogToGitHub(
  input: BlogPublishInput,
): Promise<BlogPublishResult> {
  const { clientId, blogPostId, executionItemId } = input

  // Step 1: Load CMS connection
  let conn: Awaited<ReturnType<typeof getConnection>>
  try {
    conn = await getConnection(clientId)
  } catch {
    return { ok: false, reason: 'Failed to load CMS connection.', code: 'NO_CONNECTION' }
  }
  if (!conn) {
    return {
      ok:     false,
      reason: 'No GitHub CMS connection configured. Set one up in Settings → 🔗 网站连接.',
      code:   'NO_CONNECTION',
    }
  }

  // Step 2: Fetch blog post (P14.C.4 — also pulls created_at/updated_at/published_at for schema)
  const { data: post, error: postErr } = await supabaseAdmin
    .from('blog_posts')
    .select('id,client_id,title,meta_title,meta_description,slug,html_body,word_count,status,source_query_text,geo_html_snapshot,featured_image_url,created_at,updated_at,published_at')
    .eq('id', blogPostId)
    .eq('client_id', clientId)
    .single()

  if (postErr || !post) {
    return { ok: false, reason: 'Blog post not found.', code: 'NO_POST' }
  }

  const typedPost = post as BlogPostRow
  const { repoOwner, repoName, branch: defaultBranch, plainToken } = conn
  const github = new GithubClient(plainToken)

  // P14.C.4: load client domain so the JSON-LD schema can declare a canonical URL.
  // Non-fatal — schema falls back to URL-less form if domain missing.
  const { data: clientRow } = await supabaseAdmin
    .from('clients')
    .select('domain')
    .eq('id', clientId)
    .maybeSingle()
  const siteUrl = typeof clientRow?.domain === 'string' && clientRow.domain.trim()
    ? (clientRow.domain.startsWith('http') ? clientRow.domain : `https://${clientRow.domain}`)
    : ''

  // Step 3: Create feature branch
  const shortId    = randomBytes(4).toString('hex')
  const safeSlug   = (typedPost.slug ?? typedPost.id.slice(0, 8)).replace(/[^a-z0-9-]/g, '-')
  const branchName = `${ME_BLOG_BRANCH_PREFIX}${safeSlug}-${shortId}`

  let baseSha: string
  try {
    baseSha = await github.getBranchSha(repoOwner, repoName, defaultBranch)
  } catch (err) {
    return { ok: false, reason: buildGithubErr('reading branch SHA', err), code: 'GITHUB_BRANCH_ERROR' }
  }

  try {
    await github.createBranch(repoOwner, repoName, branchName, baseSha)
  } catch (err) {
    return { ok: false, reason: buildGithubErr('creating branch', err), code: 'GITHUB_BRANCH_ERROR' }
  }

  // Step 4: Commit the new blog file (no blobSha = create new file)
  const filePath    = `content/blog/${safeSlug}.md`
  const fileContent = formatBlogAsMarkdown(typedPost, siteUrl)
  const commitMsg   = `feat(blog): add "${typedPost.title}" [Magic Engine]`

  try {
    await github.commitFile(repoOwner, repoName, filePath, branchName, fileContent, commitMsg)
  } catch (err) {
    return { ok: false, reason: buildGithubErr('creating file', err), code: 'GITHUB_WRITE_ERROR' }
  }

  // Step 5: Open pull request
  let pr: { number: number; html_url: string }
  try {
    pr = await github.createPullRequest(repoOwner, repoName, {
      title: `[Magic Engine] Blog: ${typedPost.title}`,
      body:  buildPrBody(typedPost),
      head:  branchName,
      base:  defaultBranch,
    })
  } catch (err) {
    return { ok: false, reason: buildGithubErr('creating PR', err), code: 'GITHUB_PR_ERROR' }
  }

  // Step 6: Update blog_posts status to 'pr_open' and store PR details
  // Non-fatal: if this update fails we still return success (the PR was created).
  const { error: updateErr } = await supabaseAdmin
    .from('blog_posts')
    .update({ status: 'pr_open', pr_url: pr.html_url, pr_number: pr.number })
    .eq('id', blogPostId)
    .eq('client_id', clientId)

  if (updateErr) {
    console.warn('[blog-publisher] PR created but failed to update blog_posts status:', updateErr.message)
  }

  // Step 7: Record in flywheel_actions
  const { data: fa, error: faErr } = await supabaseAdmin
    .from('flywheel_actions')
    .insert({
      client_id:          clientId,
      flywheel:           'seo',
      action_type:        CMS_ACTION_TYPE.CONTENT_INSERT,
      execution_mode:     'in_house',
      payload:            { blogPostId, filePath, prUrl: pr.html_url, prNumber: pr.number },
      execution_item_id:  executionItemId ?? null,
    })
    .select('id')
    .single()

  if (faErr || !fa) {
    return {
      ok:     false,
      reason: 'Published to GitHub but failed to record flywheel action.',
      code:   'FLYWHEEL_ERROR',
    }
  }

  return {
    ok:               true,
    prUrl:            pr.html_url,
    prNumber:         pr.number,
    branchName,
    flywheelActionId: (fa as { id: string }).id,
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBlogAsMarkdown(post: BlogPostRow, siteUrl: string): string {
  const today = new Date().toISOString().split('T')[0]
  const title = post.title.replace(/"/g, '\\"')
  const meta  = post.meta_title.replace(/"/g, '\\"')
  const desc  = post.meta_description.replace(/"/g, '\\"')

  // P14.C.4: JSON-LD BlogPosting schema lives inside the article body so the
  // client's static-site generator includes it verbatim (no template change).
  const schemaScript = buildArticleSchemaScript(post as ArticleSchemaPost, siteUrl)
  const body         = buildBlogBodyHtml(post)
  const bodyWithSchema = schemaScript ? `${body}\n\n${schemaScript}` : body

  return `---
title: "${title}"
metaTitle: "${meta}"
metaDescription: "${desc}"
slug: "${post.slug ?? ''}"
date: "${today}"
status: "draft"
wordCount: ${post.word_count ?? 0}
---

${bodyWithSchema}
`
}

function buildPrBody(post: BlogPostRow): string {
  const lines = [
    '## Magic Engine — Blog Post',
    '',
    `**Title:** ${post.title}`,
    `**Slug:** \`${post.slug ?? ''}\``,
    `**Word count:** ${post.word_count ?? 'unknown'}`,
    `**File:** \`content/blog/${(post.slug ?? post.id.slice(0, 8)).replace(/[^a-z0-9-]/g, '-')}.md\``,
    '',
    '### Meta',
    `- **Meta title:** ${post.meta_title}`,
    `- **Meta description:** ${post.meta_description}`,
  ]

  if (post.source_query_text) {
    lines.push('', `**Targeting query:** "${post.source_query_text}"`)
  }
  if (post.geo_html_snapshot) {
    lines.push('', '_This post includes a GEO directive block for AI search visibility._')
  }

  lines.push('', '---', '_Auto-generated by [Magic Engine](https://magic-engine.app). Review and merge to publish._')
  return lines.join('\n')
}

function buildGithubErr(action: string, err: unknown): string {
  if (err instanceof GitHubApiError) return `GitHub error while ${action}: ${err.message}`
  if (err instanceof Error)          return `Error while ${action}: ${err.message}`
  return `Unknown error while ${action}.`
}
