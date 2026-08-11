/**
 * Pilot is hard-scoped to a single Issue on a single repository. Nothing here
 * reads a config file or an env var to widen scope — generalizing beyond
 * Issue #910 is a separate, separately-authorized change (see README).
 */
export const TARGET_ISSUE_NUMBER = 910

/** Hard stop. Round 5 never happens — the 4th round's reply is the last one. */
export const MAX_ROUNDS = 4

/**
 * Repository-owner comments only trigger a relay when they contain this
 * phrase. Anywhere in the comment body is enough; it is not a slash command
 * parsed by GitHub, just a marker this tool looks for.
 */
export const RELAY_PHRASE = '/relay-codex'

/** Default GITHUB_TOKEN identity for `issue_comment` events raised by a workflow run. */
export const WORKFLOW_BOT_LOGIN = 'github-actions[bot]'

export interface RelayConfig {
  readonly targetIssueNumber: number
  readonly maxRounds: number
  readonly relayPhrase: string
  readonly workflowBotLogin: string
  /**
   * Exact `user.login` values trusted as "Claude posted this". Bot identity
   * naming is a discovery fact, not a guess this code should encode as truth
   * — see README "Open verification items". Confirm against a real comment
   * from `anthropics/claude-code-action` on this repository before the pilot
   * goes live, and correct this list (not the guard logic) if it is wrong.
   */
  readonly trustedBotLogins: readonly string[]
}

export const DEFAULT_CONFIG: RelayConfig = {
  targetIssueNumber: TARGET_ISSUE_NUMBER,
  maxRounds: MAX_ROUNDS,
  relayPhrase: RELAY_PHRASE,
  workflowBotLogin: WORKFLOW_BOT_LOGIN,
  trustedBotLogins: ['claude[bot]'],
}
