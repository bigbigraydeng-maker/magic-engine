/**
 * Where single ownership actually comes from.
 *
 * Earlier versions treated the Issue-comment lease as the exclusion mechanism.
 * It is not one. Appending a comment is not a compare-and-set: two runners
 * reading an idle ledger at the same instant both compute `acquired: true`, both
 * append, and both go on to a paid call. Checking afterwards records the
 * duplicate spend — the money is already gone.
 *
 * Rather than build a lock service for a tool that runs a handful of times a
 * week, this takes the exclusion GitHub already provides and refuses to run
 * without proof it applies:
 *
 *   GitHub Actions `concurrency: <group>` guarantees at most one job with that
 *   group is in progress. That guarantee is enforced before either process
 *   starts, which is the only place it can be enforced.
 *
 * So the runner requires an `ExclusiveRunContext`: evidence that this process is
 * a GitHub Actions job whose concurrency group is exactly the group that
 * serialises this lock key. No evidence, no provider call. A local invocation,
 * a job with a different group, or a workflow that forgot to declare
 * `concurrency` all fail closed.
 *
 * The workflow exports its own concurrency expression as `ME2_CONCURRENCY_GROUP`
 * so this check compares against the value GitHub is actually serialising on,
 * not against a string we hope matches. `workflow-supply-chain.test.ts` asserts
 * the two stay identical.
 */

export const CONCURRENCY_GROUP_ENV = 'ME2_CONCURRENCY_GROUP'

export interface ExclusiveRunContext {
  kind: 'github-actions-concurrency'
  /** The Actions run that holds the group, for the audit trail. */
  run_id: string
  concurrency_group: string
}

export type ExclusivityResult =
  | { ok: true; context: ExclusiveRunContext }
  | { ok: false; reason: string }

/** The group a workflow must serialise on for a given lock key. */
export function expectedConcurrencyGroup(issueNumber: number): string {
  return `me2-orchestrator-issue-${issueNumber}`
}

/**
 * Fail-closed verification. Every branch returns a reason a human can act on,
 * because "the run refused to start" is only useful if it says why.
 */
export function verifyExclusiveRunContext(args: {
  env: Readonly<Record<string, string | undefined>>
  issueNumber: number
}): ExclusivityResult {
  const { env, issueNumber } = args

  if (env.GITHUB_ACTIONS !== 'true') {
    return {
      ok: false,
      reason:
        'not running inside GitHub Actions, so nothing is serialising this run; ' +
        'the Issue-comment lease is an audit record, not a lock',
    }
  }

  const runId = env.GITHUB_RUN_ID
  if (!runId) {
    return { ok: false, reason: 'GITHUB_RUN_ID is absent, so the holder cannot be identified' }
  }

  const declared = env[CONCURRENCY_GROUP_ENV]
  if (!declared) {
    return {
      ok: false,
      reason:
        `${CONCURRENCY_GROUP_ENV} is not set; the workflow must export the same ` +
        'expression it uses for `concurrency.group`, or there is no proof this run is serialised',
    }
  }

  const expected = expectedConcurrencyGroup(issueNumber)
  if (declared !== expected) {
    return {
      ok: false,
      reason:
        `concurrency group "${declared}" does not serialise issue #${issueNumber} ` +
        `(expected "${expected}"); another run on a different group could execute in parallel`,
    }
  }

  return {
    ok: true,
    context: { kind: 'github-actions-concurrency', run_id: runId, concurrency_group: declared },
  }
}

/** Stable holder identity derived from the exclusive context. */
export function holderFor(context: ExclusiveRunContext): string {
  return `gha-run-${context.run_id}`
}
