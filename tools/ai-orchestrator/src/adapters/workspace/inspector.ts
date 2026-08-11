/**
 * Authoritative facts about what a turn actually did to the repository.
 *
 * The model's own `files_changed` / `commit_evidence` are a *description*. This is
 * the *record*.
 *
 * v0.2 got the record right but the *scope* wrong: it asked git for
 * `diff baseRef...HEAD`, which is everything the branch has accumulated since it
 * left main. From round 2 onward that means round 1's files are attributed to
 * round 2, `commit` is never null because HEAD always exists, and an honest
 * implementer reporting only what it just did is flagged as a liar.
 *
 * So the inspector captures **states**, and the runner diffs two of them around
 * each provider call. What a turn did is `after − before`; what the branch holds
 * in total is `after`. Policy uses both, for different questions.
 */

export interface CommitFacts {
  sha: string
  branch: string
}

export interface PullRequestFacts {
  number: number
  head_sha: string
  head_ref: string
  merged: boolean
}

/** Marks a path that exists in the change set because it was deleted. */
export const DELETED_FINGERPRINT = '<deleted>'

export interface RemoteFacts {
  /** The tracked remote ref, e.g. `origin/claude/x`. */
  ref: string
  head_sha: string
}

export interface WorkspaceState {
  head_sha: string | null
  branch: string | null
  /**
   * Where the remote ref stood at this instant, or null when the branch tracks
   * nothing. Comparing two captures is the only way to know whether a push
   * happened — HEAD moving proves a commit, not a publication.
   */
  remote: RemoteFacts | null
  /**
   * False when the remote could not be read at all. Distinct from `remote: null`
   * ("nothing is tracked, so nothing could have been pushed there") and treated
   * as fail-closed by the policy layer: not knowing is not the same as nothing.
   */
  remote_readable: boolean
  /**
   * Every path differing from the run's base ref at this instant — committed,
   * staged and unstaged alike — mapped to a content fingerprint.
   *
   * The fingerprint is what makes round-over-round deltas work: a file touched in
   * round 1 and left alone in round 2 keeps its fingerprint, so it does not show
   * up as a round 2 action. A file touched again does.
   */
  file_fingerprints: Readonly<Record<string, string>>
  pull_request: PullRequestFacts | null
  /** Provenance, e.g. `git:diff+status+hash-object`. Recorded in the ledger. */
  source: string
}

export interface WorkspaceInspector {
  readonly name: string
  capture(): Promise<WorkspaceState>
}

export interface TurnDelta {
  /** Paths this turn changed. Never includes untouched paths from earlier turns. */
  files_changed: readonly string[]
  /** Everything the branch holds versus its base ref, after this turn. */
  cumulative_files_changed: readonly string[]
  /** Non-null only when HEAD moved during this turn. */
  commit: CommitFacts | null
  /** The pull request as it stands now, for the never-merge assertion. */
  pull_request: PullRequestFacts | null
  /** True only when the pull request did not exist before this turn. */
  pull_request_opened_this_turn: boolean
  /** True when the tracked remote ref moved during this turn — i.e. a push. */
  pushed_this_turn: boolean
  remote_head_delta: {
    ref: string
    before_sha: string | null
    after_sha: string | null
  } | null
  /** False when either capture could not read the remote. Policy fails closed. */
  remote_facts_available: boolean
  source: string
}

export function diffWorkspaceStates(before: WorkspaceState, after: WorkspaceState): TurnDelta {
  const changed: string[] = []
  const paths = new Set([
    ...Object.keys(before.file_fingerprints),
    ...Object.keys(after.file_fingerprints),
  ])

  for (const path of Array.from(paths)) {
    if (before.file_fingerprints[path] !== after.file_fingerprints[path]) changed.push(path)
  }

  const headMoved = before.head_sha !== after.head_sha && after.head_sha !== null

  const remoteReadable = before.remote_readable && after.remote_readable
  const beforeRemote = before.remote?.head_sha ?? null
  const afterRemote = after.remote?.head_sha ?? null
  const remoteRef = after.remote?.ref ?? before.remote?.ref ?? null

  return {
    files_changed: changed.sort(),
    cumulative_files_changed: Object.keys(after.file_fingerprints).sort(),
    commit: headMoved && after.branch ? { sha: after.head_sha as string, branch: after.branch } : null,
    pull_request: after.pull_request,
    pull_request_opened_this_turn: before.pull_request === null && after.pull_request !== null,
    // A push is the remote moving. A local commit is HEAD moving. Conflating the
    // two is what let `can_push` look enforced while nothing checked it.
    pushed_this_turn: remoteReadable && beforeRemote !== afterRemote,
    remote_head_delta: remoteRef
      ? { ref: remoteRef, before_sha: beforeRemote, after_sha: afterRemote }
      : null,
    remote_facts_available: remoteReadable,
    source: after.source,
  }
}

/** Fixed state, for tests and for the mock-only scaffold. */
export class StaticWorkspaceInspector implements WorkspaceInspector {
  readonly name = 'static'

  private index = 0

  /** Successive captures return successive states; the last one repeats. */
  constructor(private readonly states: readonly WorkspaceState[]) {
    if (states.length === 0) throw new Error('StaticWorkspaceInspector needs at least one state')
  }

  async capture(): Promise<WorkspaceState> {
    const state = this.states[Math.min(this.index, this.states.length - 1)]
    this.index += 1
    return state
  }
}

export function emptyWorkspaceState(source = 'static:empty'): WorkspaceState {
  return {
    head_sha: null,
    branch: null,
    remote: null,
    remote_readable: true,
    file_fingerprints: {},
    pull_request: null,
    source,
  }
}
