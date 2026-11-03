import { describe, expect, it, vi } from 'vitest'
import {
  POLL_INTERVAL_MS,
  POLL_MAX_CONSECUTIVE_FAILURES,
  POLL_MAX_MS,
  POLL_TIMEOUT_MESSAGE,
  POLL_UNSTABLE_MESSAGE,
  interpretPrescriptionPoll,
  pollHuatuoPrescription,
  type PrescriptionPollSnapshot,
} from '../poll-prescription'

function snap(overrides: Partial<PrescriptionPollSnapshot> = {}): PrescriptionPollSnapshot {
  return {
    status: 'generating',
    progress_note: null,
    error_message: null,
    content: null,
    self_grade: null,
    generation_meta: null,
    agent_name: 'huatuo',
    ...overrides,
  }
}

function jsonResponse(snapshot: PrescriptionPollSnapshot): Response {
  return new Response(JSON.stringify({
    prescription: {
      ...snapshot,
      id: 'p1',
      client_id: 'c1',
    },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('interpretPrescriptionPoll', () => {
  it('waits while generating and accepts a draft with content', () => {
    expect(interpretPrescriptionPoll(snap(), 'generate')).toBe('wait')
    const ready = snap({
      status: 'draft',
      content: { summary: 'ok', phases: [], kpi_targets: [], budget_allocation: [] },
    })
    expect(interpretPrescriptionPoll(ready, 'generate')).toEqual({ ok: true, snapshot: ready })
  })

  it('treats a refine error on a draft as failure', () => {
    const row = snap({ status: 'draft', error_message: '精修失败', content: { summary: 'old', phases: [], kpi_targets: [], budget_allocation: [] } })
    expect(interpretPrescriptionPoll(row, 'refine')).toEqual({ ok: false, error: '精修失败' })
  })

  it('surfaces a failed generate', () => {
    expect(interpretPrescriptionPoll(snap({ status: 'failed', error_message: '超时' }), 'generate'))
      .toEqual({ ok: false, error: '超时' })
  })
})

describe('pollHuatuoPrescription', () => {
  it('returns the draft without sleeping once it is ready', async () => {
    const sleep = vi.fn(async () => undefined)
    const ready = snap({
      status: 'draft',
      progress_note: '华佗正在开方…',
      content: { summary: 'ok', phases: [], kpi_targets: [], budget_allocation: [] },
    })
    const notes: Array<string | null> = []
    const outcome = await pollHuatuoPrescription(
      'c1',
      'p1',
      { mode: 'generate', onProgress: (note) => notes.push(note) },
      sleep,
      () => 0,
      async () => jsonResponse(ready),
    )
    expect(outcome.ok).toBe(true)
    expect(sleep).not.toHaveBeenCalled()
    expect(notes).toEqual(['华佗正在开方…'])
  })

  it('stops after repeated network failures', async () => {
    const sleep = vi.fn(async () => undefined)
    let nowMs = 0
    const outcome = await pollHuatuoPrescription(
      'c1',
      'p1',
      { mode: 'generate' },
      sleep,
      () => nowMs,
      async () => { throw new Error('offline') },
    )
    expect(outcome).toEqual({ ok: false, error: POLL_UNSTABLE_MESSAGE })
    expect(sleep).toHaveBeenCalledTimes(POLL_MAX_CONSECUTIVE_FAILURES - 1)
  })

  it('gives up when the wait exceeds the cap', async () => {
    const sleep = vi.fn(async () => undefined)
    let nowMs = 0
    const outcome = await pollHuatuoPrescription(
      'c1',
      'p1',
      { mode: 'generate' },
      async (ms) => {
        expect(ms).toBe(POLL_INTERVAL_MS)
        nowMs = POLL_MAX_MS + 1
      },
      () => nowMs,
      async () => jsonResponse(snap()),
    )
    expect(outcome).toEqual({ ok: false, error: POLL_TIMEOUT_MESSAGE })
  })
})
