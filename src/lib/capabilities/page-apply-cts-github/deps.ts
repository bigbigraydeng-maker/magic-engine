import { getConnection } from '@/lib/cms/connection-store'
import { GithubClient } from '@/lib/cms/github-client'
import { verifyConfiguredReferenceLoopAuthorizationProof } from '@/lib/reference-loop-authorization-proof'
import type { GrowthJsonValue } from '@/lib/growth'

export interface CtsGithubConnection {
  readonly status: 'connected' | 'disconnected' | 'error'
  readonly repoOwner: string
  readonly repoName: string
  readonly defaultBranch: string
  readonly plainToken: string
}

export interface CtsGithubClient {
  getFileContent(owner: string, repo: string, path: string, branch: string): Promise<{
    sha: string
    decodedContent: string
  }>
  getBranchSha(owner: string, repo: string, branch: string): Promise<string>
  createBranchWithMarker(
    owner: string,
    repo: string,
    branch: string,
    fromSha: string,
    marker: string,
  ): Promise<string>
  commitFileWithReceipt(
    owner: string,
    repo: string,
    path: string,
    branch: string,
    content: string,
    message: string,
    blobSha?: string,
  ): Promise<{ commitSha: string; contentSha: string }>
  createPullRequest(owner: string, repo: string, input: {
    title: string
    body: string
    head: string
    base: string
    draft?: boolean
  }): Promise<{ number: number; html_url: string; title: string }>
  listPullRequestsByHead(
    owner: string,
    repo: string,
    branch: string,
    state?: 'open' | 'closed' | 'all',
  ): Promise<Array<{ number: number; html_url: string; title: string }>>
  getPullRequestDetail(owner: string, repo: string, number: number): Promise<{
    number: number
    state: 'open' | 'closed'
    merged: boolean
    mergedAt: string | null
    draft: boolean
    headRef: string
    baseRef: string
    title: string
    body: string
    htmlUrl: string
  }>
  getPullRequestFiles(
    owner: string,
    repo: string,
    number: number,
  ): Promise<Array<{ filename: string; status: string }>>
  getCommit(owner: string, repo: string, sha: string): Promise<{ sha: string; message: string }>
  closePullRequest(owner: string, repo: string, number: number): Promise<void>
  deleteBranch(owner: string, repo: string, branch: string): Promise<void>
}

export interface PageApplyCtsGithubDeps {
  readonly resolveConnection: (clientId: string) => Promise<CtsGithubConnection | null>
  readonly createClient: (token: string) => CtsGithubClient
  readonly verifyAuthorizationProof: (payload: GrowthJsonValue, proof: unknown) => boolean
  readonly isRolloutEnabled: () => boolean
}

export function defaultCtsGithubDeps(): PageApplyCtsGithubDeps {
  return {
    resolveConnection: async (clientId) => {
      const connection = await getConnection(clientId)
      if (!connection || connection.provider !== 'github') return null
      return {
        status: connection.status,
        repoOwner: connection.repoOwner,
        repoName: connection.repoName,
        defaultBranch: connection.branch,
        plainToken: connection.plainToken,
      }
    },
    createClient: (token) => new GithubClient(token),
    verifyAuthorizationProof: verifyConfiguredReferenceLoopAuthorizationProof,
    isRolloutEnabled: () => process.env.CTS_GITHUB_METADATA_ACTION_ENABLED === 'true',
  }
}
