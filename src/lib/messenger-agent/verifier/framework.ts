/**
 * Verifier gate framework — the generic pipeline shell (Issue #1579, L1).
 *
 * This is the piece that runs before a Governed Reply Agent draft is allowed to
 * reach a human for approval. It knows nothing about tours, brand names, or any
 * other client's facts — it only knows how to run a list of `Gate<TContext>`
 * against one context object and collect what blocked.
 *
 * Per the me-platform-tier-gate 平台化闸门: this file must stay client-agnostic.
 * Any CTS-specific gate (brand redline phrases, tour canonical facts, URL
 * allowlists, …) belongs in `verifier/policies/cts.ts`, not here. A future
 * client (ME Real Estate, ME Travel, …) reuses this same runner with its own
 * policy file — it should never need to touch this one.
 *
 * ## Why `require_human_confirm` is always `true`
 *
 * Per CLAUDE.md's Inngest 硬约束: "人工审核只能推进到下一事件，不等于发布授权" —
 * passing every gate makes a draft *eligible* to be shown to Ray/FDE for
 * approval, it never means "send this automatically." The literal `true` is
 * not a placeholder to be conditionally computed later; it is the fail-closed
 * contract for this whole pipeline. If a future caller wants a true
 * no-human-in-the-loop auto-send path, that is a deliberate, separate design
 * decision — not something this framework should silently start doing because
 * someone widened this field's type.
 */

/**
 * One independent check in the pipeline. `id` is a short, stable,
 * machine-readable identifier (e.g. `brand_redline`, `length`) — it becomes
 * the prefix of every reason string this gate contributes to
 * `blocked_reasons`, so a human or a log line can tell which gate fired
 * without re-reading the gate's implementation.
 *
 * `check` is a pure function: given the context, return `null` when the gate
 * passes, or a non-empty human-readable reason string when it blocks. A gate
 * must never throw for an expected "this draft is bad" case — that is a
 * pass/fail result, not an exceptional one. Throwing is reserved for
 * programmer errors (e.g. a policy misconfigured its own context).
 */
export interface Gate<TContext> {
  id: string
  check(context: TContext): string | null
}

/**
 * Result contract every policy pipeline returns, unchanged across clients
 * (issue #1579 spec). `ok` is `true` only when every gate passed.
 * `blocked_reasons` lists every gate that fired, not just the first — a
 * human reviewing a blocked draft should see everything wrong with it in one
 * pass, not fix one gate and get surprised by the next. Empty when `ok` is
 * `true`.
 */
export interface VerifierResult {
  ok: boolean
  blocked_reasons: string[]
  require_human_confirm: true
}

/**
 * Run every gate against `context` and collect the result. Deliberately does
 * NOT short-circuit on the first failure — see `blocked_reasons` above.
 *
 * A gate whose `check` throws is treated as a block, not silently swallowed
 * (fail-closed, per CLAUDE.md 铁律 "发布…必须 fail-closed"): a bug or missing
 * fact inside one gate must never let an otherwise-blocked draft slip through
 * because the framework crashed and the caller's outer try/catch defaulted to
 * "let it send."
 */
export function runVerifierGates<TContext>(
  gates: ReadonlyArray<Gate<TContext>>,
  context: TContext
): VerifierResult {
  const blocked_reasons: string[] = []

  for (const gate of gates) {
    let reason: string | null
    try {
      reason = gate.check(context)
    } catch (err) {
      reason = err instanceof Error ? err.message : String(err)
    }
    if (reason) {
      blocked_reasons.push(`${gate.id}: ${reason}`)
    }
  }

  return {
    ok: blocked_reasons.length === 0,
    blocked_reasons,
    require_human_confirm: true,
  }
}
