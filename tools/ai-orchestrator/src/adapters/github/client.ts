/**
 * The only GitHub surface the orchestrator is allowed to touch.
 *
 * Five methods, four of them read-only. There is deliberately no `merge`, no
 * `createRelease`, no `dispatchWorkflow` and no `updateBranchProtection` — an
 * operation that is absent from the interface cannot be reached by any amount of
 * prompt cleverness.
 *
 * `listPullRequestFiles` and `getPullRequest` exist so the runner can establish
 * what a turn actually changed without asking the model. The file `sha` is the
 * blob id, which is what lets two captures be diffed by content rather than by
 * path.
 */

export interface IssueComment {
  id: number
  author_login: string
  body: string
  created_at: string
}

/**
 * A *complete* comment list, plus the evidence that it is complete.
 *
 * Same reasoning as `PullRequestFileList`, and more consequential: these
 * comments are the run's event ledger, so a silently truncated read rebuilds the
 * run from a history that stops partway. There is no shape here that can express
 * "some of the comments".
 */
export interface IssueCommentPage {
  comments: readonly IssueComment[]
  pages_read: number
  comment_count: number
}

export interface PullRequestFacts {
  number: number
  head_sha: string
  head_ref: string
  merged: boolean
}

export interface PullRequestFile {
  filename: string
  /** Blob sha of the file at the PR head. */
  sha: string
}

/**
 * A *complete* file list, plus the evidence that it is complete.
 *
 * The page count is not decoration: a caller treating a truncated list as
 * authoritative would let a protected file sitting at position 101 pass the path
 * policy unseen. Anything short of every page is an error, never a partial
 * answer, so there is no shape in this type that can express "some of the files".
 */
export interface PullRequestFileList {
  files: readonly PullRequestFile[]
  pages_read: number
  file_count: number
}

export interface GitHubClient {
  readonly name: string
  /** Complete ledger, in creation order. Throws rather than truncate. */
  listIssueComments(issueNumber: number): Promise<IssueCommentPage>
  /**
   * Complete label set. Throws rather than truncate — one of these is the kill
   * switch, and a missing label reads as "no kill switch", the worst direction
   * for a truncation to fail in.
   *
   * No page count here, unlike the two lists above: labels answer a yes/no
   * question, so there is nothing a reviewer would audit beyond "did the stop
   * label appear".
   */
  listIssueLabels(issueNumber: number): Promise<readonly string[]>
  createIssueComment(issueNumber: number, body: string): Promise<IssueComment>
  /** Complete changed-file list for a PR, with blob ids. Throws rather than truncate. */
  listPullRequestFiles(prNumber: number): Promise<PullRequestFileList>
  /** Authoritative commit/branch/merge facts for a PR. */
  getPullRequest(prNumber: number): Promise<PullRequestFacts | null>
}
