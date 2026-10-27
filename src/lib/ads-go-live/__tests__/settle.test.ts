import { describe, expect, it, vi } from 'vitest'
import { isLive, settleGoLive, type ActivateAttempt, type LayerRead, type SettlePorts } from '../settle'

function ports(over: Partial<SettlePorts> = {}): SettlePorts & {
  claim: ReturnType<typeof vi.fn>
  activate: ReturnType<typeof vi.fn>
  read: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
} {
  const claim = vi.fn(async (): Promise<ActivateAttempt> => ({ ok: true, retryable: true }))
  const activate = vi.fn(async (): Promise<ActivateAttempt> => ({ ok: true, retryable: true }))
  const read = vi.fn(async (): Promise<LayerRead[]> => [{ name: '广告系列', status: 'ACTIVE' }])
  const pause = vi.fn(async () => ({ ok: true, failed: [] as string[] }))
  return {
    claim,
    activate,
    read,
    pause,
    claimAndActivate: claim,
    activateOnly: activate,
    readBack: read,
    keepPaused: pause,
    ...over,
  }
}

describe('settleGoLive', () => {
  it('does not write again when the first readback is already live', async () => {
    const p = ports()
    const result = await settleGoLive(p)
    expect(result).toMatchObject({ outcome: 'live', attempts: 1 })
    expect(p.claim).toHaveBeenCalledTimes(1)
    expect(p.activate).not.toHaveBeenCalled()
    expect(p.pause).not.toHaveBeenCalled()
  })

  it('retries a retryable failure with a second claim and does not use activate-only', async () => {
    const claim = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: '开 第一次没开成', retryable: true })
      .mockResolvedValueOnce({ ok: true, retryable: true })
    const read = vi.fn()
      .mockResolvedValueOnce([{ name: '广告', status: 'PAUSED' }])
      .mockResolvedValueOnce([{ name: '广告', status: 'ACTIVE' }])
    const p = ports({ claimAndActivate: claim, readBack: read })
    const result = await settleGoLive(p)
    expect(result).toMatchObject({ outcome: 'live', attempts: 2 })
    expect(claim).toHaveBeenCalledTimes(2)
    expect(p.activate).not.toHaveBeenCalled()
    expect(p.pause).not.toHaveBeenCalled()
  })

  it('retries with activate-only when the claim succeeded but the readback is not live', async () => {
    const read = vi.fn()
      .mockResolvedValueOnce([{ name: '广告组', status: null }])
      .mockResolvedValueOnce([{ name: '广告组', status: 'ACTIVE' }])
    const p = ports({ readBack: read })
    const result = await settleGoLive(p)
    expect(result).toMatchObject({ outcome: 'live', attempts: 2 })
    expect(p.claim).toHaveBeenCalledTimes(1)
    expect(p.activate).toHaveBeenCalledTimes(1)
    expect(p.pause).not.toHaveBeenCalled()
    expect(isLive([{ name: '广告组', status: null }])).toBe(false)
  })

  it('pauses and holds when both reads are not live', async () => {
    const read = vi.fn(async () => [{ name: '广告系列', status: 'PAUSED' }])
    const p = ports({ readBack: read })
    const result = await settleGoLive(p)
    expect(result.outcome).toBe('held')
    if (result.outcome === 'held') expect(result.paused).toBe(true)
    expect(p.pause).toHaveBeenCalledTimes(1)
    expect(result.readback).toContain('不是在投')
  })

  it('does not activate or pause after a non-retryable failure', async () => {
    const claim = vi.fn(async () => ({ ok: false, error: '占不到这条草案', retryable: false }))
    const p = ports({
      claimAndActivate: claim,
      readBack: vi.fn(async () => [{ name: '广告系列', status: 'PAUSED' }]),
    })
    const result = await settleGoLive(p)
    expect(result).toMatchObject({ outcome: 'held', paused: false })
    expect(p.activate).not.toHaveBeenCalled()
    expect(p.pause).not.toHaveBeenCalled()
    expect(claim).toHaveBeenCalledTimes(1)
  })

  it('reports live without a second write when a failed claim already reads active', async () => {
    const claim = vi.fn(async () => ({ ok: false, error: '占不到这条草案', retryable: false }))
    const p = ports({
      claimAndActivate: claim,
      readBack: vi.fn(async () => [{ name: '广告', status: 'ACTIVE' }, { name: '广告系列', status: 'ACTIVE' }]),
    })
    const result = await settleGoLive(p)
    expect(result).toMatchObject({ outcome: 'live', attempts: 1 })
    expect(p.activate).not.toHaveBeenCalled()
    expect(p.pause).not.toHaveBeenCalled()
  })
})
