/**
 * Git-backed workspace inspector and control-plane integrity checker.
 *
 * Both shell out through an injected `CommandRunner`, so the tested paths never
 * touch a real repository and the Enable phase can supply the real executor
 * without changing any logic here.
 *
 * Two things this deliberately does that a naive `git diff base...HEAD` does not:
 *
 * - **reads the working tree as well as the commits.** An implementer that edits a
 *   protected file and never commits it has still edited it.
 * - **fingerprints file contents.** Comparing two captures by path alone would
 *   report a file touched in round 1 as a round 2 action, because it is still in
 *   the branch's cumulative diff. Comparing by `git hash-object` output does not.
 */

import { PROTECTED_PATHS } from '../../policy/protected-paths'
import type { ControlPlaneIntegrityChecker } from '../../policy/protected-paths'
import { DELETED_FINGERPRINT } from './inspector'
import type { PullRequestFacts, RemoteFacts, WorkspaceInspector, WorkspaceState } from './inspector'

export type CommandRunner = (command: string, args: readonly string[]) => Promise<string>

function splitLines(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function unquote(path: string): string {
  return path.replace(/^"(.*)"$/, '$1')
}

export interface ChangedPath {
  path: string
  deleted: boolean
}

/**
 * `git status --porcelain` lines look like `XY path`, or `XY old -> new` for a
 * rename. Both sides of a rename count as changed; the old side is a deletion.
 */
export function parsePorcelain(output: string): ChangedPath[] {
  const results: ChangedPath[] = []

  for (const line of output.split('\n')) {
    if (line.trim().length === 0) continue
    const code = line.slice(0, 2)
    const body = line.slice(3).trim()
    const arrow = body.indexOf(' -> ')

    if (arrow >= 0) {
      results.push({ path: unquote(body.slice(0, arrow).trim()), deleted: true })
      results.push({ path: unquote(body.slice(arrow + 4).trim()), deleted: false })
      continue
    }

    results.push({ path: unquote(body), deleted: code.includes('D') })
  }

  return results
}

/** `git diff --name-status` lines look like `M\tpath` or `R100\told\tnew`. */
export function parseNameStatus(output: string): ChangedPath[] {
  const results: ChangedPath[] = []

  for (const line of output.split('\n')) {
    if (line.trim().length === 0) continue
    const parts = line.split('\t').map((part) => part.trim())
    const status = parts[0] ?? ''

    if (status.startsWith('R') && parts.length >= 3) {
      results.push({ path: unquote(parts[1]), deleted: true })
      results.push({ path: unquote(parts[2]), deleted: false })
      continue
    }

    if (parts.length >= 2) {
      results.push({ path: unquote(parts[1]), deleted: status.startsWith('D') })
    }
  }

  return results
}

export interface GitWorkspaceInspectorOptions {
  /** The ref the run started from, e.g. `origin/main`. */
  baseRef: string
  run: CommandRunner
  /** Supplies the PR view when the run has one. */
  pullRequest?: () => Promise<PullRequestFacts | null>
}

export class GitWorkspaceInspector implements WorkspaceInspector {
  readonly name = 'git'

  constructor(private readonly options: GitWorkspaceInspectorOptions) {}

  async capture(): Promise<WorkspaceState> {
    const { baseRef, run } = this.options

    const [committed, working, sha, branch] = await Promise.all([
      run('git', ['diff', '--name-status', `${baseRef}...HEAD`]),
      run('git', ['status', '--porcelain']),
      run('git', ['rev-parse', 'HEAD']),
      run('git', ['rev-parse', '--abbrev-ref', 'HEAD']),
    ])

    const remote = await this.readRemote()

    const changed = new Map<string, boolean>()
    for (const entry of parseNameStatus(committed)) changed.set(entry.path, entry.deleted)
    // The working tree wins: a path committed as deleted but recreated on disk is
    // present, and vice versa.
    for (const entry of parsePorcelain(working)) changed.set(entry.path, entry.deleted)

    const fingerprints = await this.fingerprint(changed)
    const pullRequest = this.options.pullRequest ? await this.options.pullRequest() : null

    return {
      head_sha: sha.trim() || null,
      branch: branch.trim() || null,
      remote: remote.facts,
      remote_readable: remote.readable,
      file_fingerprints: fingerprints,
      pull_request: pullRequest,
      source: 'git:diff+status+hash-object',
    }
  }

  /**
   * Where the tracked remote ref stands right now.
   *
   * `@{upstream}` is the branch's own tracking ref, so this reports what the
   * branch actually publishes to rather than a guess. Two outcomes are different
   * and must stay different: no upstream configured (`facts: null`, readable) is
   * "nothing could have been pushed there"; a failed read (`readable: false`) is
   * "we do not know", and the policy layer refuses to proceed on that.
   */
  private async readRemote(): Promise<{ facts: RemoteFacts | null; readable: boolean }> {
    const { run } = this.options
    let ref: string
    try {
      ref = (await run('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])).trim()
    } catch {
      // No upstream configured. Nothing is tracked, so nothing can be pushed to it.
      return { facts: null, readable: true }
    }

    if (!ref) return { facts: null, readable: true }

    try {
      const sha = (await run('git', ['rev-parse', ref])).trim()
      if (!sha) return { facts: null, readable: false }
      return { facts: { ref, head_sha: sha }, readable: true }
    } catch {
      return { facts: null, readable: false }
    }
  }

  private async fingerprint(changed: Map<string, boolean>): Promise<Record<string, string>> {
    const fingerprints: Record<string, string> = {}
    const present: string[] = []

    for (const [path, deleted] of Array.from(changed.entries())) {
      if (deleted) fingerprints[path] = DELETED_FINGERPRINT
      else present.push(path)
    }

    if (present.length === 0) return fingerprints

    const sorted = [...present].sort()
    const output = await this.options.run('git', ['hash-object', '--', ...sorted])
    const hashes = splitLines(output)

    sorted.forEach((path, index) => {
      // A missing hash means git could not read the path. Treat it as changed-and
      // -unknown rather than silently dropping it from the change set.
      fingerprints[path] = hashes[index] ?? 'unreadable'
    })

    return fingerprints
  }
}

/**
 * Control-plane drift, asked of git rather than of the model.
 *
 * Scoped to the protected globs so an ordinary in-scope change does not read as
 * tampering.
 */
export class GitControlPlaneIntegrityChecker implements ControlPlaneIntegrityChecker {
  readonly name = 'git'

  constructor(private readonly options: { baseRef: string; run: CommandRunner }) {}

  async drift(): Promise<readonly string[]> {
    const { baseRef, run } = this.options
    const pathspec = PROTECTED_PATHS.map((pattern) => pattern.replace(/\/\*\*$/, ''))

    const [committed, working] = await Promise.all([
      run('git', ['diff', '--name-only', `${baseRef}...HEAD`, '--', ...pathspec]),
      run('git', ['status', '--porcelain', '--', ...pathspec]),
    ])

    const drifted = new Set<string>()
    for (const path of splitLines(committed)) drifted.add(unquote(path))
    for (const entry of parsePorcelain(working)) drifted.add(entry.path)

    return Array.from(drifted).sort()
  }
}
