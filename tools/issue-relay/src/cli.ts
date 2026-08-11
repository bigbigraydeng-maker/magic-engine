/**
 * Workflow entrypoint. Each exported `cmd*` function is a thin side-effecting
 * shell around the pure `decide`/`buildRelayPrompt` logic in this directory —
 * kept thin on purpose so the branching that matters is covered by
 * `tests/decide.test.ts` without a network call.
 *
 * Every command reads its inputs from environment variables set by the
 * workflow step, never from `process.argv` interpolated out of `${{ }}` —
 * see `.github/workflows/issue-relay-pilot.yml` for why.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { GitHubClient } from './github-client'
import { decide, type CommentLike } from './decide'
import { buildMarker } from './marker'
import { buildRelayPrompt } from './prompt'
import { DEFAULT_CONFIG } from './config'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`missing required env var: ${name}`)
  return value
}

function repoFromEnv(): { owner: string; repo: string } {
  const [owner, repo] = requireEnv('GITHUB_REPOSITORY').split('/')
  if (!owner || !repo) throw new Error(`malformed GITHUB_REPOSITORY: ${process.env.GITHUB_REPOSITORY}`)
  return { owner, repo }
}

function clientFromEnv(): GitHubClient {
  const { owner, repo } = repoFromEnv()
  return new GitHubClient({ token: requireEnv('GITHUB_TOKEN'), owner, repo })
}

function writeOutput(name: string, value: string): void {
  const path = requireEnv('GITHUB_OUTPUT')
  appendFileSync(path, `${name}=${value}\n`)
}

interface IssueCommentEvent {
  issue: { number: number; pull_request?: unknown }
  comment: { id: number; body: string; user: { login: string; type: string } | null; author_association: string }
}

function readEvent(): IssueCommentEvent {
  return JSON.parse(readFileSync(requireEnv('GITHUB_EVENT_PATH'), 'utf8')) as IssueCommentEvent
}

/**
 * Compute the decision for the current trigger event and publish it as step
 * outputs. Never posts a comment itself — posting is a separate, later step
 * so a mid-run failure (e.g. Codex invocation) never leaves a half-written
 * side effect attributed to this step.
 */
export async function cmdPrepare(): Promise<void> {
  const event = readEvent()

  if (event.issue.pull_request) {
    writeOutput('decision', 'skip')
    writeOutput('reason', 'is_pull_request')
    return
  }
  if (event.issue.number !== DEFAULT_CONFIG.targetIssueNumber) {
    writeOutput('decision', 'skip')
    writeOutput('reason', 'not_target_issue')
    return
  }

  const client = clientFromEnv()
  const history = await client.listIssueComments(event.issue.number)

  const trigger: CommentLike = {
    id: event.comment.id,
    body: event.comment.body,
    login: event.comment.user?.login ?? 'unknown',
    userType: event.comment.user?.type ?? 'User',
    authorAssociation: event.comment.author_association,
  }

  const decision = decide(trigger, history, DEFAULT_CONFIG)
  writeOutput('decision', decision.kind)
  writeOutput('source_comment_id', String(trigger.id))

  if (decision.kind === 'skip') {
    writeOutput('reason', decision.reason)
    return
  }

  if (decision.kind === 'halt') {
    return
  }

  writeOutput('round', String(decision.round))

  const promptPath = `${requireEnv('RUNNER_TEMP')}/issue-relay-prompt.txt`
  writeFileSync(
    promptPath,
    buildRelayPrompt({
      issueNumber: event.issue.number,
      round: decision.round,
      maxRounds: DEFAULT_CONFIG.maxRounds,
      sourceCommentId: trigger.id,
      sourceCommentAuthor: trigger.login,
      sourceCommentBody: trigger.body,
    })
  )
  writeOutput('prompt_path', promptPath)
}

export async function cmdPostHalt(): Promise<void> {
  const client = clientFromEnv()
  const sourceCommentId = Number(requireEnv('SOURCE_COMMENT_ID'))
  const marker = buildMarker({ round: 'halt', sourceCommentId })
  const body = [
    '**NEEDS PRODUCT OWNER**',
    '',
    `This discussion has used its ${DEFAULT_CONFIG.maxRounds} automated Codex relay rounds for ` +
      `comment #${sourceCommentId}. Stopping here — a product owner needs to weigh in before another ` +
      'automated round runs.',
    '',
    marker,
  ].join('\n')
  await client.createIssueComment(DEFAULT_CONFIG.targetIssueNumber, body)
}

export async function cmdPostRelay(): Promise<void> {
  const client = clientFromEnv()
  const round = Number(requireEnv('ROUND'))
  const sourceCommentId = Number(requireEnv('SOURCE_COMMENT_ID'))
  const reply = readFileSync(requireEnv('CODEX_REPLY_FILE'), 'utf8').trim()
  const marker = buildMarker({ round, sourceCommentId })
  const body = [reply, '', `_Codex relay round ${round}/${DEFAULT_CONFIG.maxRounds}._`, '', marker].join('\n')
  await client.createIssueComment(DEFAULT_CONFIG.targetIssueNumber, body)
}

export async function cmdPostMissingCredentials(): Promise<void> {
  const client = clientFromEnv()
  const secretName = requireEnv('MISSING_SECRET_NAME')
  const body = [
    '**Codex relay: missing credentials**',
    '',
    `\`${secretName}\` is not configured, so this round cannot run. No round was consumed and no reply ` +
      'was posted, so this is retryable — configure the secret and re-run this workflow, or leave the ' +
      'next trusted comment to trigger it again.',
  ].join('\n')
  await client.createIssueComment(DEFAULT_CONFIG.targetIssueNumber, body)
}

export async function cmdPostProviderFailure(): Promise<void> {
  const client = clientFromEnv()
  const body = [
    '**Codex relay: provider invocation failed**',
    '',
    'The Codex step did not complete successfully. No round was consumed and no reply was posted, so ' +
      'this is retryable — see the workflow run log for the failure, then leave the next trusted ' +
      'comment to trigger it again.',
  ].join('\n')
  await client.createIssueComment(DEFAULT_CONFIG.targetIssueNumber, body)
}

async function main(): Promise<void> {
  const command = process.argv[2]
  switch (command) {
    case 'prepare':
      return cmdPrepare()
    case 'post-halt':
      return cmdPostHalt()
    case 'post-relay':
      return cmdPostRelay()
    case 'post-missing-credentials':
      return cmdPostMissingCredentials()
    case 'post-provider-failure':
      return cmdPostProviderFailure()
    default:
      throw new Error(`unknown command: ${command}`)
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
