/**
 * POST /api/clients/[id]/flywheel/gsc-attribution
 *
 * Triggers GSC attribution computation for all SEO flywheel actions for a client.
 * For each SEO action, finds the GSC snapshot before and after the action date,
 * computes delta (clicks, impressions, avg_position), and upserts into flywheel_outcomes.
 *
 * Body: { window_days?: number }  (default 28)
 *
 * Returns: { success, client_id, actions_found, outcomes_written, skipped, errors }
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P17.A.4
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireBearerToken } from '@/lib/validation-utils'
import {
  runGscAttributionForClient,
  type GscAttributionResult,
} from '@/lib/flywheel/attribution/gsc-bridge'
import { resolveEffectiveWindow } from '@/lib/flywheel/attribution/dual-window-gate'
import { requirePaidClientAccess } from '@/lib/auth/client-access'

export const dynamic = 'force-dynamic'

const DEFAULT_WINDOW_DAYS = 28
const MAX_WINDOW_DAYS     = 90

/** The window this caller may actually use, and whether a request was declined. */
function resolveWindow(rawBody: { window_days?: unknown }): {
  windowDays: number
  refused: { requested: number; used: number; reason: string } | null
} {
  let requested = DEFAULT_WINDOW_DAYS
  if (typeof rawBody.window_days === 'number' && rawBody.window_days > 0) {
    requested = Math.min(Math.round(rawBody.window_days), MAX_WINDOW_DAYS)
  }

  // A custom window is a second window, and this endpoint bypasses the cron.
  //
  // On main a manual run REPLACED the previous rows — the delete had no window
  // filter — so an action never held more than one window's worth. The natural
  // key now includes window_days, which is right (a 7-day and a 28-day answer
  // are different facts) but means a manual run ADDS rather than replaces. With
  // the memory consumers still counting rows, one manual 7-day run beside the
  // cron's 28-day one doubles the evidence behind that action, exactly what
  // ATTRIBUTION_DUAL_WINDOW_ENABLED exists to prevent — so the same gate has to
  // cover this path, or the gate is not a gate.
  const effective = resolveEffectiveWindow(requested, DEFAULT_WINDOW_DAYS)
  if (!effective.overrideRefused) return { windowDays: effective.windowDays, refused: null }

  // Refused out loud rather than silently ignored: an operator who asked for 7
  // days and got 28 without being told would read the result as a 7-day answer.
  return {
    windowDays: effective.windowDays,
    refused: {
      requested: effective.requested ?? requested,
      used: effective.windowDays,
      reason:
        'Custom attribution windows are disabled while ' +
        'ATTRIBUTION_DUAL_WINDOW_ENABLED is off — a second window would ' +
        'double the evidence behind each action for consumers that still ' +
        'count outcome rows. See Issue #859.',
    },
  }
}

/**
 * Three kinds of error, and they mean different things for this response:
 *
 *   · post-write cleanup debt — the outcome rows landed, then retiring
 *     superseded rows failed. Nothing was lost; the next run tidies up, and a
 *     502 would claim the opposite. Forgiven only when something actually
 *     landed: a page-scoped action whose page is absent from `top_pages` writes
 *     nothing and still retires its domain keys, so a failure there leaves the
 *     stale rows on the board with nothing to weigh against it.
 *   · pre-write reconciliation failure — nothing was made right: the unsigned
 *     rows still block the contract migration and a duplicated window is still
 *     double-counted. Reconciliation runs before the maturity check, so a run
 *     can end with zero writes and one of these.
 *   · a real write failure — an upsert or snapshot query threw.
 *
 * See Issue #859, rounds 18 and 19.
 */
function classify(result: GscAttributionResult): { success: boolean; status: number } {
  const hasErrors = result.errors.length > 0
  const onlyCleanupFailed =
    hasErrors &&
    result.reconcile_errors === 0 &&
    result.outcomes_written > 0 &&
    result.errors.length === result.cleanup_errors
  const hardErrors =
    result.errors.length - result.cleanup_errors - result.reconcile_errors

  return {
    success: !hasErrors || onlyCleanupFailed,
    status: hardErrors > 0 && result.outcomes_written === 0 ? 502 : 200,
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }

  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  // `req.json()` SUCCEEDS on a literal `null` body, so a plain assignment puts
  // null into rawBody and the window read below throws a TypeError — a 500 for
  // a request that used to fall back to the default. Splitting the handler in
  // round 30 moved that read out of the try that used to absorb it; the guard
  // has to be on the shape, not on the parse. (Codex P2, round 32 on PR #862.)
  let rawBody: { window_days?: unknown } = {}
  try {
    const parsed: unknown = await req.json()
    if (parsed && typeof parsed === 'object') rawBody = parsed as { window_days?: unknown }
  } catch {
    // no body, or not JSON — the default window stands
  }

  const { windowDays, refused } = resolveWindow(rawBody)
  const result = await runGscAttributionForClient(params.id, windowDays)
  const { success, status } = classify(result)

  return NextResponse.json(
    {
      success,
      client_id:        result.client_id,
      actions_found:    result.actions_found,
      outcomes_written: result.outcomes_written,
      skipped:          result.skipped,
      cleanup_errors:   result.cleanup_errors,
      reconcile_errors: result.reconcile_errors,
      errors:           result.errors,
      window_days:      windowDays,
      ...(refused ? { window_override_refused: refused } : {}),
    },
    { status },
  )
}
