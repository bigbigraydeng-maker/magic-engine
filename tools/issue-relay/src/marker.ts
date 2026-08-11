/**
 * Every reply this tool posts carries an invisible HTML-comment trailer that
 * records which source comment triggered it and which round it belongs to.
 * That trailer is the only state this pilot keeps — there is no database and
 * no external ledger. Re-reading the Issue's own comment history is how a
 * fresh workflow run rediscovers "how far did we get".
 */

export type Round = number | 'halt'

export interface RelayMarker {
  readonly round: Round
  readonly sourceCommentId: number
}

const MARKER_RE = /<!-- me2-issue-relay:v1 round=(halt|\d+) source_comment_id=(\d+) -->/

export function buildMarker(marker: RelayMarker): string {
  return `<!-- me2-issue-relay:v1 round=${marker.round} source_comment_id=${marker.sourceCommentId} -->`
}

export function parseMarker(body: string): RelayMarker | null {
  const match = MARKER_RE.exec(body)
  if (!match) return null

  const [, roundRaw, idRaw] = match
  return {
    round: roundRaw === 'halt' ? 'halt' : Number(roundRaw),
    sourceCommentId: Number(idRaw),
  }
}
