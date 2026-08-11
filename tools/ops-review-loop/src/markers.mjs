/**
 * The loop's only state store is PR comment text: a hidden HTML marker per
 * transition, of the form:
 *
 *   <!-- ops-codex-loop:stage=<stage> pr=<n> sha=<sha> [round=<n>] -->
 *
 * There is no database and this is OPS-only tooling, so re-reading the PR's
 * own comment history on every run *is* the ledger. Two runs that read the
 * same comments land on the same decision (see plan.mjs) instead of racing
 * to redo work — the same "state is a fold over the ledger" idea used by
 * tools/ai-orchestrator, just against PR comments instead of Issue comments.
 */

const MARKER_RE = /<!--\s*ops-codex-loop:stage=(\S+)\s+pr=(\d+)\s+sha=([0-9a-f]{7,40})(?:\s+round=(\d+))?\s*-->/g

export function buildMarker({ stage, pr, sha, round }) {
  const roundPart = round === undefined ? '' : ` round=${round}`
  return `<!-- ops-codex-loop:stage=${stage} pr=${pr} sha=${sha}${roundPart} -->`
}

export function parseMarkers(commentBodies) {
  const markers = []
  for (const body of commentBodies) {
    if (!body) continue
    for (const match of body.matchAll(MARKER_RE)) {
      markers.push({
        stage: match[1],
        pr: Number(match[2]),
        sha: match[3],
        round: match[4] === undefined ? undefined : Number(match[4]),
      })
    }
  }
  return markers
}
