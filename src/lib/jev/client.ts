// TypeSafe Jev judgment model adapter — L3 Connector (external read-only judgment
// service, see docs/roadmap/2026-08-19-me2-platformization-principle.md). Packaged
// externally as "Compliance Engine" (docs/PRODUCT.md / docs/ARCHITECTURE.md wrapper
// table) — do NOT surface "Jev"/"TypeSafe" in UI or client-facing copy. Internal code,
// env vars, and logs may use the real name per CLAUDE.md.
//
// No SDK exists for this vendor — plain fetch, resolved per call (no module-level
// client object to violate the "no top-level SDK init" rule; there's nothing stateful
// to initialise).

const JEV_API_URL = 'https://api.typesafe.ai/v1/systemone'
const JEV_MODEL = 'jev-latest'

// Real-world latency observed in evaluation was low (sub-second to a couple of
// seconds). This runs inline in the worker's /complete request (route maxDuration=60s,
// already spent on several DB round-trips) — kept tight so a slow/degraded Jev never
// meaningfully eats into that budget. Callers must still treat any failure as
// non-fatal (see content-quality-guard.ts) — this call is never allowed to block
// or fail the work order completion flow.
const JEV_TIMEOUT_MS = 6000
const JEV_MAX_ATTEMPTS = 2
const JEV_RETRY_BACKOFF_MS = 800

export interface JevQuestion {
  type: 'noul'
  instructions: string
}

export interface JevAnswer {
  noul: number
}

export interface JevResult {
  answers: Record<string, JevAnswer>
}

// `onTimeout` aborts the underlying fetch's AbortController so a slow provider doesn't keep
// running (and billing) in the background after we've already moved on to a retry — without
// it only the wrapper promise rejects, the original request stays in flight unconsumed
// (2026-09-20 codex review round 2).
function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => { onTimeout(); reject(new Error(`jev call timed out after ${ms}ms`)) }, ms)
    p.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) },
    )
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Ask Jev one or more noul (0..1 continuous) questions about a state object.
 * Retries once on 429 with a short backoff; any other non-2xx or malformed
 * response throws. Callers are responsible for treating failure as
 * "needs human review", not as a pass (fail-closed — see content-quality-guard.ts).
 */
export async function callJev(
  state: Record<string, unknown>,
  questions: Record<string, JevQuestion>,
): Promise<JevResult> {
  const apiKey = process.env.TYPESAFE_API_KEY
  if (!apiKey) {
    throw new Error('TYPESAFE_API_KEY environment variable is not set')
  }

  let lastErr: unknown
  for (let attempt = 0; attempt < JEV_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(JEV_RETRY_BACKOFF_MS * attempt)
    const controller = new AbortController()
    try {
      // Header arrival and body read/parse must share ONE deadline + ONE AbortController.
      // A provider that returns headers promptly but stalls mid-body-transfer would
      // otherwise hang past the timeout — `withTimeout` only cleared its timer once the
      // outer promise settled, and previously that promise was just `fetch(...)`, which
      // resolves as soon as headers land, not once the body is fully read (2026-09-20
      // codex review round 3). Wrapping the whole header+body lifecycle in one async IIFE
      // keeps both under the same timer and the same abort signal.
      const { status, body } = await withTimeout(
        (async () => {
          const res = await fetch(JEV_API_URL, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ state, model: JEV_MODEL, questions }),
            signal: controller.signal,
          })
          const parsed = await res.json()
          return { status: res.status, body: parsed }
        })(),
        JEV_TIMEOUT_MS,
        () => controller.abort(),
      )
      if (status === 429) {
        lastErr = new Error('jev rate limited (429)')
        continue
      }
      if (status < 200 || status >= 300) {
        throw new Error(`jev call failed (${status}): ${JSON.stringify(body).slice(0, 300)}`)
      }
      return body as JevResult
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('jev call failed')
}
