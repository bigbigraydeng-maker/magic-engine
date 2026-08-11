/**
 * In-memory GitHub client used by the tests and by the dry-run harness.
 *
 * `writeCount` is the thing the dry-run tests assert on: it separates "the run
 * chose not to comment" from "the run tried to comment and the call failed",
 * which are the two ways an empty comment list can come about.
 */

import type {
  GitHubClient,
  IssueComment,
  IssueCommentPage,
  PullRequestFacts,
  PullRequestFile,
  PullRequestFileList,
} from './client'

export class InMemoryGitHubClient implements GitHubClient {
  readonly name = 'in-memory'

  private readonly comments: IssueComment[]
  private readonly labels: string[]
  private readonly prFiles: Map<number, PullRequestFile[]>
  private readonly pullRequests: Map<number, PullRequestFacts>
  private nextId: number

  /** Number of write calls that actually reached this client. */
  writeCount = 0

  constructor(options?: {
    comments?: readonly IssueComment[]
    labels?: readonly string[]
    startId?: number
  }) {
    this.comments = [...(options?.comments ?? [])]
    this.labels = [...(options?.labels ?? [])]
    this.prFiles = new Map()
    this.pullRequests = new Map()
    this.nextId = options?.startId ?? 1000
  }

  async listPullRequestFiles(prNumber: number): Promise<PullRequestFileList> {
    const files = [...(this.prFiles.get(prNumber) ?? [])]
    return { files, pages_read: 1, file_count: files.length }
  }

  async getPullRequest(prNumber: number): Promise<PullRequestFacts | null> {
    return this.pullRequests.get(prNumber) ?? null
  }

  /** Test helper: register the authoritative view of a pull request. */
  seedPullRequest(pr: PullRequestFacts, files: readonly PullRequestFile[]): void {
    this.pullRequests.set(pr.number, pr)
    this.prFiles.set(pr.number, [...files])
  }

  async listIssueComments(): Promise<IssueCommentPage> {
    const comments = [...this.comments]
    return { comments, pages_read: 1, comment_count: comments.length }
  }

  async listIssueLabels(): Promise<readonly string[]> {
    return [...this.labels]
  }

  async createIssueComment(_issueNumber: number, body: string): Promise<IssueComment> {
    this.writeCount += 1
    const comment: IssueComment = {
      id: this.nextId++,
      author_login: 'me2-orchestrator-bot',
      body,
      created_at: new Date().toISOString(),
    }
    this.comments.push(comment)
    return comment
  }

  /** Test helper: append a comment without counting it as an orchestrator write. */
  seedComment(comment: Omit<IssueComment, 'id'> & { id?: number }): IssueComment {
    const seeded: IssueComment = { ...comment, id: comment.id ?? this.nextId++ }
    this.comments.push(seeded)
    return seeded
  }

  addLabel(label: string): void {
    this.labels.push(label)
  }
}
