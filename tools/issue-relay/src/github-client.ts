/**
 * Minimal GitHub REST client, scoped to exactly what this pilot needs: read
 * an Issue's full comment history, post one comment. Uses Node's built-in
 * `fetch` — no new dependency.
 */

export interface RawComment {
  readonly id: number
  readonly body: string
  readonly login: string
  readonly userType: string
  readonly authorAssociation: string
}

const ITEMS_PER_PAGE = 100
/**
 * A long-running discussion Issue legitimately accumulates hundreds of
 * comments. Hitting this cap is an error, never a silent truncation — a
 * truncated read could miss a halt marker and relay past the round cap.
 */
const MAX_PAGES = 20

export interface GitHubClientConfig {
  readonly token: string
  readonly owner: string
  readonly repo: string
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
}

export class GitHubClient {
  private readonly token: string
  private readonly owner: string
  private readonly repo: string
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch

  constructor(config: GitHubClientConfig) {
    if (!config.token) throw new Error('GitHubClient: missing token')
    this.token = config.token
    this.owner = config.owner
    this.repo = config.repo
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
    return `/repos/${this.owner}/${this.repo}`
  }

  async listIssueComments(issueNumber: number): Promise<RawComment[]> {
    interface RawApiComment {
      id: number
      body: string | null
      user: { login: string; type: string } | null
      author_association: string
    }

    const comments: RawComment[] = []
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const raw = await this.request<RawApiComment[]>(
        `${this.repoPath}/issues/${issueNumber}/comments?per_page=${ITEMS_PER_PAGE}&page=${page}`
      )
      for (const entry of raw) {
        comments.push({
          id: entry.id,
          body: entry.body ?? '',
          login: entry.user?.login ?? 'unknown',
          userType: entry.user?.type ?? 'User',
          authorAssociation: entry.author_association,
        })
      }
      if (raw.length < ITEMS_PER_PAGE) return comments
    }
    throw new Error(
      `issue #${issueNumber} comments exceeded ${MAX_PAGES} pages; refusing to treat a truncated ` +
        'read as the authoritative history (a missed halt marker could relay past the round cap)'
    )
  }

  async createIssueComment(issueNumber: number, body: string): Promise<void> {
    await this.request(`${this.repoPath}/issues/${issueNumber}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    })
  }
}
