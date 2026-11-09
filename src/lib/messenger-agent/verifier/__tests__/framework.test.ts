/**
 * Tests for the generic verifier gate framework (Issue #1579, L1).
 * No CTS or client semantics belong in this file — see cts.test.ts for that.
 */

import { describe, expect, it } from 'vitest'
import { runVerifierGates, type Gate } from '../framework'

interface Ctx {
  value: number
}

describe('runVerifierGates', () => {
  it('returns ok:true with no blocked_reasons when every gate passes', () => {
    const gates: Gate<Ctx>[] = [
      { id: 'always_pass_1', check: () => null },
      { id: 'always_pass_2', check: () => null },
    ]
    const result = runVerifierGates(gates, { value: 1 })
    expect(result).toEqual({ ok: true, blocked_reasons: [], require_human_confirm: true })
  })

  it('collects reasons from every failing gate, not just the first', () => {
    const gates: Gate<Ctx>[] = [
      { id: 'a', check: () => 'reason a' },
      { id: 'b', check: () => null },
      { id: 'c', check: () => 'reason c' },
    ]
    const result = runVerifierGates(gates, { value: 1 })
    expect(result.ok).toBe(false)
    expect(result.blocked_reasons).toEqual(['a: reason a', 'c: reason c'])
    expect(result.require_human_confirm).toBe(true)
  })

  it('treats a gate that throws as a block (fail-closed), not a silent pass', () => {
    const gates: Gate<Ctx>[] = [
      {
        id: 'explodes',
        check: () => {
          throw new Error('boom')
        },
      },
    ]
    const result = runVerifierGates(gates, { value: 1 })
    expect(result.ok).toBe(false)
    expect(result.blocked_reasons[0]).toBe('explodes: boom')
  })

  it('require_human_confirm is true even when the draft is otherwise clean', () => {
    const result = runVerifierGates([{ id: 'noop', check: () => null }], { value: 1 })
    expect(result.require_human_confirm).toBe(true)
  })

  it('runs every gate using the same context object', () => {
    const seen: number[] = []
    const gates: Gate<Ctx>[] = [
      { id: 'g1', check: (ctx) => { seen.push(ctx.value); return null } },
      { id: 'g2', check: (ctx) => { seen.push(ctx.value); return null } },
    ]
    runVerifierGates(gates, { value: 42 })
    expect(seen).toEqual([42, 42])
  })
})
