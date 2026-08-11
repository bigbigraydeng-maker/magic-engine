/**
 * The append-only event log, stored as GitHub Issue comments.
 *
 * Each event is one comment: a human-readable line for the PM, plus a hidden
 * HTML-comment marker carrying the machine-readable payload. Run state is a fold
 * over these events, never a separately stored copy that could drift.
 *
 * Trust is split by who wrote the comment, because the two writers need opposite
 * permissions:
 *
 *   machine authors (the bot)   may write every event EXCEPT `human_authorization`
 *   human authorizers (owner)   may write ONLY `human_authorization`, and only
 *                               with `authorized_by` equal to their own login
 *
 * v0.2 had a single allowlist containing only the bot, which meant the owner's
 * own approval was discarded at decode time and a parked run could never be
 * released — the human gate was closed in both directions. Widening the one list
 * would have fixed that by also letting the bot mint its own approvals, so the
 * lists are separate and each is narrow.
 *
 * The `authorized_by == author_login` binding is what makes an authorization
 * unforgeable: a marker claiming to come from the owner is only honoured when
 * GitHub says the owner is who wrote it.
 */

import { LedgerWriteBlockedError } from '../../domain/errors'
import type { LedgerEvent } from '../../domain/schema'
import { LEDGER_SCHEMA_VERSION, ORCHESTRATOR_MARKER_NAMESPACE, ledgerEventSchema } from '../../domain/schema'
import type { GitHubClient, IssueComment } from './client'

const MARKER_PATTERN = new RegExp(
  `<!--\\s*${ORCHESTRATOR_MARKER_NAMESPACE}:${LEDGER_SCHEMA_VERSION}\\s+(\\{[\\s\\S]*?\\})\\s*-->`
)

export function encodeMarker(event: LedgerEvent): string {
  return `<!-- ${ORCHESTRATOR_MARKER_NAMESPACE}:${LEDGER_SCHEMA_VERSION} ${JSON.stringify(event)} -->`
}

function summarise(event: LedgerEvent): string {
  switch (event.event) {
    case 'run_started':
      return `🤖 **run started** · mode \`${event.mode}\` · work package \`${event.work_package_id}\``
    case 'lease_acquired':
      return event.took_over_from
        ? `🔒 **lease taken over** from \`${event.took_over_from}\` by \`${event.holder}\``
        : `🔒 **lease acquired** by \`${event.holder}\``
    case 'lease_released':
      return `🔓 **lease released** by \`${event.holder}\``
    case 'lease_retained':
      return (
        `🔐 **lease held open** by \`${event.holder}\` until ${event.retained_until} — ` +
        `${event.reason}. No further round may start before then.`
      )
    case 'turn_started':
      return (
        `⏳ **${event.actor}** started round ${event.round} · holder \`${event.holder}\`` +
        ` · reserved $${event.reserved_cost_usd.toFixed(4)} until ${event.claim_expires_at}`
      )
    case 'turn_completed':
      return `✅ **${event.actor}** finished round ${event.round}${
        event.verdict ? ` · verdict \`${event.verdict}\`` : ''
      } · cost $${event.cost_usd.toFixed(4)}`
    case 'turn_rejected':
      return `⛔️ **${event.actor}** round ${event.round} rejected — ${event.reason}`
    case 'duplicate_spend_recorded':
      return (
        `💸 **duplicate spend** · ${event.actor} round ${event.round} · ` +
        `$${event.cost_usd.toFixed(4)} spent by \`${event.holder}\` and discarded — ${event.note}`
      )
    case 'state_changed':
      return `➡️ \`${event.from}\` → \`${event.to}\` — ${event.reason}`
    case 'human_authorization':
      return `🙋 **human authorization** by \`${event.authorized_by}\` → resume as \`${event.resume_state}\``
    case 'run_finished':
      return `🏁 **run finished** · \`${event.final_state}\`${
        event.stop_reason ? ` · ${event.stop_reason}` : ''
      }`
  }
}

export function renderEventComment(event: LedgerEvent): string {
  return `${summarise(event)}\n\n${encodeMarker(event)}`
}

export interface RejectedComment {
  comment_id: number
  reason: string
}

export interface LedgerReadResult {
  events: readonly LedgerEvent[]
  /** Cursor: the highest comment id seen, trusted or not. */
  lastCommentId: number | null
  /** Markers that were found but not trusted or not valid. Surfaced, never silent. */
  rejected: readonly RejectedComment[]
  /**
   * How much of the Issue this read actually covered.
   *
   * Recorded because a ledger that was silently truncated and a ledger that is
   * genuinely short look identical from the folded state alone.
   */
  pages_read: number
  comment_count: number
}

export interface LedgerTrust {
  /** May write machine events. Never `human_authorization`. */
  machineAuthors: readonly string[]
  /** May write `human_authorization` only, and only on their own behalf. */
  humanAuthorizers: readonly string[]
}

function authorRole(trust: LedgerTrust, login: string): 'machine' | 'human' | null {
  if (trust.machineAuthors.includes(login)) return 'machine'
  if (trust.humanAuthorizers.includes(login)) return 'human'
  return null
}

export function decodeComment(
  comment: IssueComment,
  trust: LedgerTrust
): { event: LedgerEvent } | { rejected: RejectedComment } | null {
  const match = MARKER_PATTERN.exec(comment.body)
  if (!match) return null

  const role = authorRole(trust, comment.author_login)
  if (role === null) {
    return {
      rejected: {
        comment_id: comment.id,
        reason: `marker from untrusted author "${comment.author_login}"`,
      },
    }
  }

  let raw: unknown
  try {
    raw = JSON.parse(match[1])
  } catch {
    return { rejected: { comment_id: comment.id, reason: 'marker payload is not valid JSON' } }
  }

  const parsed = ledgerEventSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      rejected: {
        comment_id: comment.id,
        reason: `marker payload failed schema validation: ${parsed.error.issues
          .map((issue) => issue.message)
          .join('; ')}`,
      },
    }
  }

  const event = parsed.data

  if (role === 'machine' && event.event === 'human_authorization') {
    return {
      rejected: {
        comment_id: comment.id,
        reason: `machine author "${comment.author_login}" may not mint a human authorization`,
      },
    }
  }

  if (role === 'human' && event.event !== 'human_authorization') {
    return {
      rejected: {
        comment_id: comment.id,
        reason: `human author "${comment.author_login}" may only write human_authorization, not ${event.event}`,
      },
    }
  }

  if (event.event === 'human_authorization' && event.authorized_by !== comment.author_login) {
    return {
      rejected: {
        comment_id: comment.id,
        reason:
          `authorization claims authorized_by "${event.authorized_by}" but GitHub says ` +
          `"${comment.author_login}" wrote the comment`,
      },
    }
  }

  return { event }
}

export interface LedgerOptions {
  issueNumber: number
  trust: LedgerTrust
  /** When true the ledger records what it would post and writes nothing. */
  dryRun: boolean
}

export interface PlannedWrite {
  kind: 'issue_comment'
  issue_number: number
  body: string
}

export class IssueCommentLedger {
  readonly plannedWrites: PlannedWrite[] = []

  constructor(
    private readonly client: GitHubClient,
    private readonly options: LedgerOptions
  ) {}

  async read(): Promise<LedgerReadResult> {
    // Throws rather than return a partial ledger; a short read here would rebuild
    // the run from a history that stops partway.
    const page = await this.client.listIssueComments(this.options.issueNumber)
    const comments = page.comments
    const events: LedgerEvent[] = []
    const rejected: RejectedComment[] = []
    let lastCommentId: number | null = null

    for (const comment of comments) {
      lastCommentId = lastCommentId === null ? comment.id : Math.max(lastCommentId, comment.id)
      const decoded = decodeComment(comment, this.options.trust)
      if (!decoded) continue
      if ('event' in decoded) events.push(decoded.event)
      else rejected.push(decoded.rejected)
    }

    return {
      events,
      lastCommentId,
      rejected,
      pages_read: page.pages_read,
      comment_count: page.comment_count,
    }
  }

  async append(event: LedgerEvent): Promise<{ written: boolean }> {
    const body = renderEventComment(event)

    if (this.options.dryRun) {
      this.plannedWrites.push({ kind: 'issue_comment', issue_number: this.options.issueNumber, body })
      return { written: false }
    }

    await this.client.createIssueComment(this.options.issueNumber, body)
    return { written: true }
  }

  /** Explicit guard for callers that must never write, dry-run or not. */
  assertWritable(): void {
    if (this.options.dryRun) {
      throw new LedgerWriteBlockedError('ledger is in dry-run mode')
    }
  }
}

/**
 * Exact-replay guard.
 *
 * The primary protection against duplicate delivery is the fold: a re-dispatched
 * workflow reads the same events, lands on the same state and round, and does not
 * repeat work. This is the last resort for the case the fold cannot see — two
 * runners racing on a stale ledger read.
 *
 * A rejected turn counts as processed. Re-running a turn that already breached
 * policy would just breach it again.
 */
export function hasTurnBeenProcessed(
  events: readonly LedgerEvent[],
  idempotencyKey: string
): boolean {
  return events.some(
    (event) =>
      (event.event === 'turn_completed' || event.event === 'turn_rejected') &&
      event.idempotency_key === idempotencyKey
  )
}
