/**
 * What the unattended publisher's own records say about a plan, for the manual
 * side (revoke / recall) to show next to the plan's publish receipt.
 *
 * The receipt (`publish_meta.published[]`) is what manual recall and the revoke
 * notice read. The auto-publisher also keeps an attempts table. The two can
 * disagree (a receipt write that failed after Facebook accepted the post, a
 * sweep that is still mid-send, an outcome nobody has confirmed). Anything the
 * attempts table knows about that the receipt does not must reach a human.
 */
import { isMissingTableError, listAttempts, type AttemptRecord } from './daily-plan-auto-publish-worker-store'

/** A post the attempts table recorded as published but the receipt does not list. */
export interface UnrecordedPost {
  date: string
  post_id: string
  scheduled_publish_time: string | null
}

/** A date whose outcome is not settled: a send in progress or an unconfirmed result. */
export interface UnconfirmedDate {
  date: string
  status: 'claimed' | 'unknown_outcome'
}

export interface AutoPublishRecordsView {
  /** `UNKNOWN` = the attempts table could not be read; the lists are empty but mean nothing. */
  status: 'OK' | 'UNKNOWN'
  posts: UnrecordedPost[]
  unconfirmed: UnconfirmedDate[]
}

/** Pure: split attempts into "published but not in the receipt" and "outcome not settled". */
export function classifyAttempts(attempts: AttemptRecord[], receiptPostIds: ReadonlySet<string>): Omit<AutoPublishRecordsView, 'status'> {
  const posts: UnrecordedPost[] = []
  const unconfirmed: UnconfirmedDate[] = []
  for (const attempt of attempts) {
    if (attempt.status === 'published' && attempt.post_id && !receiptPostIds.has(attempt.post_id)) {
      posts.push({ date: attempt.date, post_id: attempt.post_id, scheduled_publish_time: attempt.scheduled_publish_time })
    } else if (attempt.status === 'claimed' || attempt.status === 'unknown_outcome') {
      unconfirmed.push({ date: attempt.date, status: attempt.status })
    }
  }
  return { posts, unconfirmed }
}

/**
 * Read the attempts for `dates` and classify them. A missing table means the
 * unattended publisher does not exist here: a checked, empty answer. Any other
 * read failure is `UNKNOWN` — never an empty `OK`.
 */
export async function readAutoPublishRecords(input: {
  planId: string
  clientId: string
  dates: string[]
  receiptPostIds: ReadonlySet<string>
  read?: typeof listAttempts
}): Promise<AutoPublishRecordsView> {
  try {
    const attempts = await (input.read ?? listAttempts)(input.planId, input.clientId, input.dates)
    return { status: 'OK', ...classifyAttempts(attempts, input.receiptPostIds) }
  } catch (error: unknown) {
    if (isMissingTableError(error)) return { status: 'OK', posts: [], unconfirmed: [] }
    return { status: 'UNKNOWN', posts: [], unconfirmed: [] }
  }
}
