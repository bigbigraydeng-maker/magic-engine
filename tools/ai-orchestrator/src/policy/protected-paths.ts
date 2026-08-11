/**
 * The self-protection surface.
 *
 * **The whole orchestrator is protected, not a hand-picked subset.** The first
 * version listed `policy/`, `prompts/` and `state-machine.ts` and left `runner.ts`,
 * `schema.ts`, the ledger, every adapter, `config/`, `digest`, `fold` and `lease`
 * writable — each of which can defeat the guards just as thoroughly. Any file that
 * can change what the orchestrator is allowed to do belongs here, and it is easier
 * to be right about "all of it" than about a list.
 *
 * Consequence, and it is intended: **the orchestrator cannot upgrade itself.**
 * Changing this tool is a separate, human-initiated, human-reviewed change.
 * `workPackageScopeSchema` refuses to parse an authorization whose allowed paths
 * overlap this surface, so a self-modifying work package cannot even be built.
 *
 * Defence in depth (weakest listed last):
 *   1. GITHUB_TOKEN has no `workflows: write`, so GitHub itself rejects any push
 *      that touches `.github/workflows/**`. This holds on GitHub Free.
 *   2. `workPackageScopeSchema` rejects an authorization that grants this surface.
 *   3. `enforceProtectedPaths` rejects the turn, using the *real* changed-file list
 *      from git or the GitHub PR — never the model's self-report.
 *   4. `ControlPlaneIntegrityChecker` re-reads the surface after each turn and
 *      halts on drift, catching changes that were made but not reported anywhere.
 *   5. Branch protection — live: no bypass, PRs required, force push and deletion
 *      blocked, unresolved conversations block merge. Required approvals stay at
 *      0 for now on purpose (the PRs are owner-authored, and nobody can approve
 *      their own PR); CODEOWNERS follows once an independent bot identity authors
 *      them. See spec §9.0.
 */

import { matchesAnyGlob, matchesGlob } from './glob'

export const PROTECTED_PATHS = [
  // Every workflow, not only ours: a run that can edit any workflow can add a
  // trigger that runs itself.
  '.github/**',
  'CODEOWNERS',
  // The orchestrator in full — source, tests, config and prompts alike.
  'tools/ai-orchestrator/**',
] as const

export function isProtectedPath(path: string): boolean {
  return matchesAnyGlob(path, PROTECTED_PATHS)
}

export function selectProtected(paths: readonly string[]): readonly string[] {
  return paths.filter(isProtectedPath)
}

// ─────────────────────────────────────────────────────────────────────────────
// Scope overlap — makes a self-modifying work package unrepresentable
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A concrete path the pattern would match. Used to test two globs for overlap
 * without implementing glob intersection: if either pattern matches the other's
 * witness, the two can reach the same file.
 */
function witnessFor(pattern: string): string {
  return pattern.split('**').join('__w__/__w__').split('*').join('__w__')
}

export function globsOverlap(a: string, b: string): boolean {
  return matchesGlob(witnessFor(a), b) || matchesGlob(witnessFor(b), a)
}

/** Allowed-path patterns that reach into the protected surface. */
export function selectSelfModifyingPatterns(allowedPaths: readonly string[]): readonly string[] {
  return allowedPaths.filter((pattern) =>
    PROTECTED_PATHS.some((protectedPattern) => globsOverlap(pattern, protectedPattern))
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Integrity checking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads the protected surface independently of anything the model says about it.
 * The git-backed implementation asks the working tree, so a run that changed a
 * control-plane file without mentioning it anywhere is still caught.
 */
export interface ControlPlaneIntegrityChecker {
  readonly name: string
  /** Protected paths that differ from the run's baseline. Empty means intact. */
  drift(): Promise<readonly string[]>
}

/** Test and scaffold double: returns whatever it was constructed with. */
export class StaticIntegrityChecker implements ControlPlaneIntegrityChecker {
  readonly name = 'static'

  constructor(private readonly drifted: readonly string[] = []) {}

  async drift(): Promise<readonly string[]> {
    return this.drifted
  }
}
