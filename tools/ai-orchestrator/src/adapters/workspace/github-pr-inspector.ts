/**
 * GitHub-backed workspace inspector.
 *
 * Used when the run has a pull request: GitHub's own file list is the record of
 * what the branch contains, independent of both the model's self-report and of
 * whatever state a runner's working tree happens to be in.
 *
 * The fingerprint here is the PR file's `sha` (the blob), which gives the same
 * round-over-round delta property the git inspector gets from `hash-object`.
 */

import type { GitHubClient } from '../github/client'
import type { WorkspaceInspector, WorkspaceState } from './inspector'

export class GitHubPullRequestInspector implements WorkspaceInspector {
  readonly name = 'github-pr'

  constructor(
    private readonly client: GitHubClient,
    private readonly prNumber: number
  ) {}

  async capture(): Promise<WorkspaceState> {
    // Both throw rather than return a partial view. A capture that silently
    // dropped page two would hand the policy layer a file list it believes is
    // complete, which is the failure this whole module exists to avoid.
    const [listing, pr] = await Promise.all([
      this.client.listPullRequestFiles(this.prNumber),
      this.client.getPullRequest(this.prNumber),
    ])

    const fingerprints: Record<string, string> = {}
    for (const file of listing.files) fingerprints[file.filename] = file.sha

    return {
      head_sha: pr?.head_sha ?? null,
      branch: pr?.head_ref ?? null,
      file_fingerprints: fingerprints,
      pull_request: pr,
      // Auditable: how many pages were walked and how many files came back.
      source: `github:pr-files(pages=${listing.pages_read},files=${listing.file_count})`,
      remote: pr ? { ref: pr.head_ref, head_sha: pr.head_sha } : null,
      remote_readable: true,
    }
  }
}

/**
 * Prefer GitHub's file list once a PR exists; fall back to the local git view
 * before then. Both are authoritative; neither is the model.
 */
export function selectInspector(args: {
  prNumber: number | null
  github: GitHubClient
  local: WorkspaceInspector
}): WorkspaceInspector {
  return args.prNumber === null
    ? args.local
    : new GitHubPullRequestInspector(args.github, args.prNumber)
}
