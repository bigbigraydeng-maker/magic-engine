import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const loadCreativeDecision = vi.fn()
const proposeCreativeStateCards = vi.fn()
const createKernel = vi.fn(() => ({ now: () => new Date('2026-11-10T18:00:00.000Z') }))

vi.mock('@/lib/action-submission/creative-state-live', () => ({
  loadCreativeDecision: (...args: unknown[]) => loadCreativeDecision(...args),
}))
vi.mock('@/lib/action-submission/creative-state-card', () => ({
  proposeCreativeStateCards: (...args: unknown[]) => proposeCreativeStateCards(...args),
}))
vi.mock('@/lib/kernel', () => ({
  createKernel: (...args: unknown[]) => createKernel(...args),
}))

import { runCreativeStateDaily } from '../daily'

const SB = {} as never

describe('runCreativeStateDaily', () => {
  beforeEach(() => {
    loadCreativeDecision.mockReset()
    proposeCreativeStateCards.mockReset()
    createKernel.mockClear()
  })

  it('issues the cards the rules already chose, and does not write an ad', async () => {
    loadCreativeDecision.mockResolvedValue({ proposals: [{ kind: 'move_to_scale' }], skipped: [] })
    proposeCreativeStateCards.mockResolvedValue({ issued: [{ kind: 'move_to_scale', runId: 'run-1' }], skipped: [] })
    const result = await runCreativeStateDaily(SB, 'client-1', new Date('2026-11-10T18:00:00.000Z'))
    expect(result).toEqual({ cards: 1, skipped: [], wroteMeta: false })
    expect(proposeCreativeStateCards).toHaveBeenCalledTimes(1)
    expect(proposeCreativeStateCards.mock.calls[0][1].clicker).toEqual({ kind: 'agent', email: null })
  })

  it('does not open a card when there is nothing to propose', async () => {
    loadCreativeDecision.mockResolvedValue({ proposals: [], skipped: ['no_target'] })
    const result = await runCreativeStateDaily(SB, 'client-1')
    expect(result).toEqual({ cards: 0, skipped: ['no_target'], wroteMeta: false })
    expect(proposeCreativeStateCards).not.toHaveBeenCalled()
  })

  it('a failed read stays a failed read and still does not write', async () => {
    loadCreativeDecision.mockRejectedValue(new Error('ledger down'))
    const result = await runCreativeStateDaily(SB, 'client-1')
    expect(result.wroteMeta).toBe(false)
    expect(result.cards).toBe(0)
    expect(result.error).toContain('ledger down')
  })
})

describe('daily creative runner source', () => {
  it('does not name a Meta write', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/creative-state/daily.ts'), 'utf8')
    expect(source).not.toContain('graph.facebook')
    expect(source).not.toContain('createAdFromPost')
    expect(source).not.toContain('getMetaTokenForClient')
    expect(source).toContain('wroteMeta: false')
  })
})
