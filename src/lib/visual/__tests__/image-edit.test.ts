import { describe, expect, it, vi } from 'vitest'
import { runImageEdit, type ImageEditDeps } from '../image-edit'

const req = { model: 'm', imageUrl: 'https://img/a.jpg', prompt: 'p', resolution: '2K' as const, timeoutMs: 1000 }

function deps(over: Partial<ImageEditDeps> = {}): ImageEditDeps {
  return {
    submit: vi.fn().mockResolvedValue('req-1'),
    poll: vi.fn().mockResolvedValue({ status: 'completed', outputs: ['https://out/p.jpg'], costUsd: 0.038 }),
    ...over,
  }
}

describe('runImageEdit', () => {
  it('submits once with the edit input and returns the first https output', async () => {
    const d = deps()
    const r = await runImageEdit(req, d)
    expect(r).toEqual({ ok: true, outputUrl: 'https://out/p.jpg', costUsd: 0.038, requestId: 'req-1' })
    expect(d.submit).toHaveBeenCalledTimes(1)
    expect(d.submit).toHaveBeenCalledWith('m', {
      prompt: 'p',
      images_list: ['https://img/a.jpg'],
      resolution: '2K',
      output_format: 'jpg',
    })
    expect(d.poll).toHaveBeenCalledWith('req-1', 1000)
  })

  it('submit error → failure, no request id', async () => {
    const r = await runImageEdit(req, deps({ submit: vi.fn().mockRejectedValue(new Error('402 no credit')) }))
    expect(r).toMatchObject({ ok: false, requestId: null })
    if (!r.ok) expect(r.reason).toContain('submit_failed')
  })

  it('poll timeout → failure with request id, never re-submits', async () => {
    const d = deps({ poll: vi.fn().mockRejectedValue(new Error('timed out')) })
    const r = await runImageEdit(req, d)
    expect(r).toMatchObject({ ok: false, requestId: 'req-1' })
    if (!r.ok) expect(r.reason).toContain('poll_failed')
    expect(d.submit).toHaveBeenCalledTimes(1)
  })

  it('failed job keeps cost for the receipt', async () => {
    const d = deps({ poll: vi.fn().mockResolvedValue({ status: 'failed', outputs: [], error: 'nsfw', costUsd: 0.01 }) })
    const r = await runImageEdit(req, d)
    expect(r).toMatchObject({ ok: false, costUsd: 0.01, requestId: 'req-1' })
    expect(d.submit).toHaveBeenCalledTimes(1)
  })

  it('completed but no usable output → no_output', async () => {
    const d = deps({ poll: vi.fn().mockResolvedValue({ status: 'completed', outputs: ['http://insecure'], costUsd: undefined }) })
    const r = await runImageEdit(req, d)
    expect(r).toEqual({ ok: false, reason: 'no_output', costUsd: null, requestId: 'req-1' })
  })
})
