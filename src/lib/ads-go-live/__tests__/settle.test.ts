import { describe, expect, it, vi } from 'vitest'
import { isLive, settleGoLive, type ActivateAttempt, type LayerRead, type SettlePorts } from '../settle'

function ports(over: Partial<SettlePorts> = {}): SettlePorts & {
  claim: ReturnType<typeof vi.fn>
  activate: ReturnType<typeof vi.fn>
  read: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
  owns: ReturnType<typeof vi.fn>
} {
  const claim = vi.fn(async (): Promise<ActivateAttempt> => ({ ok: true, retryable: true }))
  const activate = vi.fn(async (): Promise<ActivateAttempt> => ({ ok: true, retryable: true }))
  const read = vi.fn(async (): Promise<LayerRead[]> => [{ name: '广告系列', status: 'ACTIVE' }])
  const pause = vi.fn(async () => ({ ok: true, failed: [] as string[] }))
  const owns = vi.fn(async () => true)
  return {
    claim,
    activate,
    read,
    pause,
    owns,
    claimAndActivate: claim,
    activateOnly: activate,
    readBack: read,
    stillOwns: owns,
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

  it('does not pause when a retryable activation failure loses the claim during readback', async () => {
    let owner: 'self' | 'other' | null = null
    const claim = vi.fn()
      .mockImplementationOnce(async () => {
        owner = null
        return { ok: false, error: '开 第一次没开成', retryable: true, holding: false }
      })
      .mockImplementationOnce(async () => {
        // The claim itself succeeded, then activation failed and the draft was released.
        owner = 'self'
        owner = null
        return { ok: false, error: '开 第二次没开成', retryable: true, holding: false }
      })
    const read = vi.fn(async () => {
      if (owner === null) owner = 'other'
      return [{ name: '广告系列', status: 'PAUSED' as string | null }]
    })
    const pause = vi.fn(async () => ({ ok: true, failed: [] as string[] }))
    const p = ports({
      claimAndActivate: claim,
      readBack: read,
      keepPaused: pause,
      stillOwns: vi.fn(async () => owner === 'self'),
    })
    const result = await settleGoLive(p)
    expect(result).toMatchObject({
      outcome: 'held',
      paused: false,
      reason: expect.stringContaining('没有再改广告'),
    })
    expect(claim).toHaveBeenCalledTimes(2)
    expect(p.activate).not.toHaveBeenCalled()
    expect(pause).not.toHaveBeenCalled()
    expect(owner).toBe('other')
  })

  it('pauses only while this request still holds the claim', async () => {
    let status: 'waiting' | 'activating' = 'waiting'
    let owner: 'self' | 'other' | null = null
    const claim = vi.fn(async () => {
      if (status !== 'waiting') {
        return { ok: false, error: '这条刚被别处处理过，这次没有再开。', retryable: false, holding: false }
      }
      status = 'activating'
      owner = 'self'
      return { ok: false, error: '开 没开成', retryable: true, holding: true }
    })
    const activate = vi.fn(async () => {
      if (owner !== 'self' || status !== 'activating') {
        return { ok: false, error: '开 没有占位', retryable: false, holding: false }
      }
      return { ok: false, error: '开 第二次没开成', retryable: true, holding: true }
    })
    const read = vi.fn(async () => {
      if (status === 'waiting') {
        status = 'activating'
        owner = 'other'
      }
      return [{ name: '广告系列', status: 'PAUSED' as string | null }]
    })
    const pause = vi.fn(async () => {
      if (owner !== 'self') throw new Error('paused while another request holds activating')
      return { ok: true, failed: [] as string[] }
    })
    const p = ports({
      claimAndActivate: claim,
      activateOnly: activate,
      readBack: read,
      keepPaused: pause,
      stillOwns: vi.fn(async () => owner === 'self' && status === 'activating'),
    })
    const result = await settleGoLive(p)
    expect(result).toMatchObject({ outcome: 'held', paused: true })
    expect(claim).toHaveBeenCalledTimes(1)
    expect(activate).toHaveBeenCalledTimes(1)
    expect(pause).toHaveBeenCalledTimes(1)
    expect(owner).toBe('self')
  })

  it('does not pause when the second claim loses the slot', async () => {
    const claim = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: '开 第一次没开成', retryable: true })
      .mockResolvedValueOnce({ ok: false, error: '这条刚被别处处理过，这次没有再开。', retryable: false })
    const pause = vi.fn(async () => ({ ok: true, failed: [] as string[] }))
    const p = ports({
      claimAndActivate: claim,
      readBack: vi.fn(async () => [{ name: '广告系列', status: null }]),
      keepPaused: pause,
    })
    const result = await settleGoLive(p)
    expect(result).toMatchObject({ outcome: 'held', paused: false })
    expect(claim).toHaveBeenCalledTimes(2)
    expect(p.activate).not.toHaveBeenCalled()
    expect(pause).not.toHaveBeenCalled()
    expect(result.readback).toContain('读不到')
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
