/**
 * Real GitHub REST client — safety skeleton for the Enable phase.
 *
 * Fails closed in two ways:
 *   - no token -> `MissingSecretError` at construction, before any network call;
 *   - `readOnly` (the default) -> `createIssueComment` throws instead of writing.
 *
 * The scaffold never constructs this client: the manual workflow runs with mock
 * providers and the in-memory client, so nothing here executes today.
 */

import { LedgerWriteBlockedError, MissingSecretError } from '../../domain/errors'
import type { RepositoryRef } from '../../domain/schema'
import type {
  GitHubClient,
  IssueComment,
  IssueCommentPage,
  PullRequestFacts,
  PullRequestFile,
  PullRequestFileList,
} from './client'

export const GITHUB_TOKEN_SECRET = 'GITHUB_TOKEN'

/** GitHub's maximum. Fewer per page means more round trips, not more safety. */
export const ITEMS_PER_PAGE = 100
/** Kept for the existing tests and call sites; the walk is generic now. */
export const PR_FILES_PER_PAGE = ITEMS_PER_PAGE

/**
 * Bounds on each walk. Hitting one is an error, never a truncation.
 *
 * The comment bound is the loosest because the Issue *is* the event ledger: a
 * long-running control Issue legitimately accumulates hundreds of entries, and
 * silently dropping the newest ones would rebuild the run from a stale history.
 */
export const MAX_PR_FILE_PAGES = 30
export const MAX_ISSUE_COMMENT_PAGES = 50
export const MAX_ISSUE_LABEL_PAGES = 5

/**
 * Derived, not configured. A second item cap alongside the page cap was dead
 * code: the item check ran after the short-page return, so the page bound always
 * fired first and the item bound could never be reached.
 */
export const MAX_PR_FILES = MAX_PR_FILE_PAGES * ITEMS_PER_PAGE
export const MAX_ISSUE_COMMENTS = MAX_ISSUE_COMMENT_PAGES * ITEMS_PER_PAGE
export const MAX_ISSUE_LABELS = MAX_ISSUE_LABEL_PAGES * ITEMS_PER_PAGE

export interface RestGitHubClientConfig {
  token: string | undefined
  repository: RepositoryRef
  /** Defaults to true. Writing requires an explicit opt-in from the caller. */
  readOnly?: boolean
  baseUrl?: string
  fetchImpl?: typeof fetch
}

interface RawComment {
  id: number
  body: string | null
  created_at: string
  user: { login: string } | null
}

interface RawLabel {
  name: string
}

interface RawPullRequest {
  number: number
  merged: boolean
  head: { sha: string; ref: string }
  /** GitHub's own count. Used to prove the file walk did not skip anything. */
  changed_files?: number
}

interface RawIssue {
  /** GitHub's own comment count for this issue. */
  comments: number
  /** Inline label set, capped by GitHub at 100 entries. */
  labels?: RawLabel[]
}

interface RawPullRequestFile {
  filename: string
  sha: string
}

export class RestGitHubClient implements GitHubClient {
  readonly name = 'github-rest'

  private readonly token: string
  private readonly repository: RepositoryRef
  private readonly readOnly: boolean
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch

  constructor(config: RestGitHubClientConfig) {
    if (!config.token) throw new MissingSecretError(GITHUB_TOKEN_SECRET)

    this.token = config.token
    this.repository = config.repository
    this.readOnly = config.readOnly ?? true
    this.baseUrl = config.baseUrl ?? 'https://api.github.com'
    this.fetchImpl = config.fetchImpl ?? fetch
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.token}`,
        'x-github-api-version': '2022-11-28',
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
      },
    })

    if (!response.ok) {
      throw new Error(`GitHub API ${init?.method ?? 'GET'} ${path} failed: ${response.status}`)
    }

    return (await response.json()) as T
  }

  private get repoPath(): string {
    return `/repos/${this.repository.owner}/${this.repository.repo}`
  }

  /**
   * The one paginated read.
   *
   * Three endpoints needed this and the first two got it wrong in different
   * ways, so there is a single implementation rather than three chances to
   * forget. Its contract is deliberately narrow: **a complete list or an
   * exception, never a shorter array.** A partial answer is worse than a failure
   * because nothing downstream can tell the two apart.
   *
   * `expectedCount` is what makes this trustworthy rather than merely tidy.
   * Offset pagination cannot be made safe by ordering alone: a *removal* between
   * two page requests shifts every later entry onto a lower offset, so the walk
   * skips exactly as many items as were deleted and the shortfall surfaces as a
   * short final page — indistinguishable from a genuine end of list, and leaving
   * no duplicate for the dedupe to notice. Comparing the total against a count
   * the API itself reports is the only thing that catches it.
   */
  private async readAllPages<TRaw, TItem>(args: {
    path: string
    subject: string
    maxPages: number
    map: (raw: TRaw) => TItem
    /** Dedupe key. Later duplicates are dropped, so the first sighting wins. */
    keyOf: (item: TItem) => string
    /**
     * A lower bound on the true size, read from the API *before* the walk.
     * Reading fewer than this means the list moved underneath us. Reading more
     * is fine: entries appended during the walk are a bonus, not a gap.
     */
    expectedCount?: number
  }): Promise<{ items: TItem[]; pages_read: number }> {
    const items: TItem[] = []
    const seen = new Set<string>()

    for (let page = 1; page <= args.maxPages; page += 1) {
      const raw = await this.request<TRaw[]>(
        `${args.path}?per_page=${ITEMS_PER_PAGE}&page=${page}`
      )

      for (const entry of raw) {
        const item = args.map(entry)
        const key = args.keyOf(item)
        if (seen.has(key)) continue
        seen.add(key)
        items.push(item)
      }

      // A short page is the last page. Asking for one more would be a wasted
      // round trip on every single call.
      if (raw.length < ITEMS_PER_PAGE) {
        this.assertComplete(args.subject, items.length, args.expectedCount)
        return { items, pages_read: page }
      }
    }

    throw new Error(
      `${args.subject} exceeded ${args.maxPages} pages ` +
        `(${args.maxPages * ITEMS_PER_PAGE} entries); ` +
        'refusing to treat a truncated list as the authoritative record'
    )
  }

  private assertComplete(subject: string, got: number, expected?: number): void {
    if (expected === undefined || got >= expected) return
    throw new Error(
      `${subject}: read ${got} entries but the API reported at least ${expected}; ` +
        'the list changed during pagination and entries were skipped — ' +
        'refusing to treat the result as the authoritative record'
    )
  }

  private async getIssue(issueNumber: number): Promise<RawIssue> {
    return this.request<RawIssue>(`${this.repoPath}/issues/${issueNumber}`)
  }

  /**
   * The event ledger, in full.
   *
   * This is the most consequential of the three walks. Issue comments *are* the
   * run's state: reading only the first hundred rebuilds the run from a
   * truncated history, which can resurrect a state the run already left, an
   * authorization it already consumed, or a lease it already released. Every
   * later event simply would not exist as far as the fold is concerned.
   *
   * Two things guard it, and neither is a `sort=` parameter. An earlier version
   * sent `sort=created&direction=asc` and called it load-bearing; this endpoint
   * does not document those parameters, so an unrecognised one is simply
   * ignored and the guarantee was imaginary.
   *
   * 1. **Completeness** comes from the issue's own `comments` count, read before
   *    the walk and compared afterwards. That catches the deletion-shift case
   *    that ordering alone cannot.
   * 2. **Order** is imposed here, by sorting on comment id. GitHub ids increase
   *    monotonically, so ascending id is creation order — and unlike a request
   *    parameter, doing it ourselves cannot be silently dropped. The fold needs
   *    this: `resumeFromWaitingHuman` decides whether an authorization came
   *    *after* its wait by position, so a reordered read changes what the ledger
   *    means, not merely how it looks.
   */
  async listIssueComments(issueNumber: number): Promise<IssueCommentPage> {
    const issue = await this.getIssue(issueNumber)

    const { items, pages_read } = await this.readAllPages<RawComment, IssueComment>({
      path: `${this.repoPath}/issues/${issueNumber}/comments`,
      subject: `issue #${issueNumber} comments`,
      maxPages: MAX_ISSUE_COMMENT_PAGES,
      expectedCount: issue.comments,
      map: (comment) => ({
        id: comment.id,
        author_login: comment.user?.login ?? 'unknown',
        body: comment.body ?? '',
        created_at: comment.created_at,
      }),
      keyOf: (comment) => String(comment.id),
    })

    const comments = [...items].sort((left, right) => left.id - right.id)
    return { comments, pages_read, comment_count: comments.length }
  }

  /**
   * Every label, because one of them is the kill switch.
   *
   * A truncated label read fails in the worst direction available: the run does
   * not see `me2-orchestrator:stop` and carries on spending. Labels are returned
   * in no guaranteed order, so the stop label can sit on any page.
   */
  async listIssueLabels(issueNumber: number): Promise<readonly string[]> {
    // The issue payload carries its labels inline, capped by GitHub at 100. That
    // makes it a lower bound rather than an exact count, which is all the
    // completeness check needs — and for any realistic issue it is the exact
    // number, so a label removed mid-walk is caught.
    const issue = await this.getIssue(issueNumber)

    const { items } = await this.readAllPages<RawLabel, string>({
      path: `${this.repoPath}/issues/${issueNumber}/labels`,
      subject: `issue #${issueNumber} labels`,
      maxPages: MAX_ISSUE_LABEL_PAGES,
      expectedCount: issue.labels?.length,
      map: (label) => label.name,
      keyOf: (name) => name,
    })

    return items
  }

  /**
   * Every changed file in the pull request.
   *
   * This one is the reason `readAllPages` exists: the original stopped after the
   * first hundred, so a protected or out-of-scope file at position 101 never
   * reached `evaluateImplementerTurn` and passed the path policy unseen.
   */
  async listPullRequestFiles(prNumber: number): Promise<PullRequestFileList> {
    // `changed_files` is GitHub's own count for this PR, so the walk can prove it
    // did not skip a file rather than assume it.
    const pr = await this.request<RawPullRequest>(`${this.repoPath}/pulls/${prNumber}`)

    const { items, pages_read } = await this.readAllPages<RawPullRequestFile, PullRequestFile>({
      path: `${this.repoPath}/pulls/${prNumber}/files`,
      subject: `pull request #${prNumber} files`,
      maxPages: MAX_PR_FILE_PAGES,
      expectedCount: pr.changed_files,
      map: (file) => ({ filename: file.filename, sha: file.sha }),
      // First sighting wins, so a duplicate on a later page cannot overwrite the
      // blob sha the policy layer already reasoned about.
      keyOf: (file) => file.filename,
    })

    return { files: items, pages_read, file_count: items.length }
  }

  async getPullRequest(prNumber: number): Promise<PullRequestFacts | null> {
    const raw = await this.request<RawPullRequest>(`${this.repoPath}/pulls/${prNumber}`)
    return {
      number: raw.number,
      head_sha: raw.head.sha,
      head_ref: raw.head.ref,
      merged: raw.merged,
    }
  }

  async createIssueComment(issueNumber: number, body: string): Promise<IssueComment> {
    if (this.readOnly) {
      throw new LedgerWriteBlockedError('RestGitHubClient is in read-only mode')
    }

    const raw = await this.request<RawComment>(`${this.repoPath}/issues/${issueNumber}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    })

    return {
      id: raw.id,
      author_login: raw.user?.login ?? 'unknown',
      body: raw.body ?? '',
      created_at: raw.created_at,
    }
  }
}

/** Fail-closed factory. Returns a typed error rather than a half-built client. */
export function createRestGitHubClient(
  config: RestGitHubClientConfig
): { ok: true; client: GitHubClient } | { ok: false; error: MissingSecretError } {
  try {
    return { ok: true, client: new RestGitHubClient(config) }
  } catch (error) {
    if (error instanceof MissingSecretError) return { ok: false, error }
    throw error
  }
}
