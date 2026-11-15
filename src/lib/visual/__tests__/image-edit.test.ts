import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/ai/openai-client', () => ({ getOpenAIClient: vi.fn() }))
vi.mock('@/lib/visual/storage', () => ({ uploadFromBase64: vi.fn() }))

import { imageEditCostUsd, runImageEdit, type ImageEditDeps } from '../image-edit'

const REQ = { model: 'gpt-image-2.6-flare', imageUrl: 'https://store/photo.jpg', prompt: 'make a poster', clientId: 'client-1' }
// Token counts from the 2026-11-15 live trial.
const USAGE = { input_tokens_details: { image_tokens: 1536, text_tokens: 262 }, output_tokens: 1353 }

function deps(over: Partial<ImageEditDeps> = {}): ImageEditDeps {
  return {
    fetchSource: vi.fn().mockResolvedValue({ bytes: Buffer.from('jpg'), mimeType: 'image/jpeg' }),
    edit: vi.fn().mockResolvedValue({ b64: 'AAAA', usage: USAGE, requestId: 'req_1' }),
    store: vi.fn().mockResolvedValue({ storage_url: 'https://bucket/posters/p.jpg', file_size_kb: 400 }),
    ...over,
  }
}

describe('imageEditCostUsd', () => {
  it('prices image in, text in and output tokens', () => {
    // 1536*8 + 262*5 + 1353*30 = 12288 + 1310 + 40590 = 54188 → $0.054188
    expect(imageEditCostUsd('gpt-image-2.6-flare', USAGE)).toBe(0.054188)
  })
  it('unknown model or no usage → unknown cost', () => {
    expect(imageEditCostUsd('some-other-model', USAGE)).toBeNull()
    expect(imageEditCostUsd('gpt-image-2.6-flare', null)).toBeNull()
  })
})

describe('runImageEdit', () => {
  it('success: one edit, output stored in our bucket, cost + request id returned', async () => {
    const d = deps()
    const r = await runImageEdit(REQ, d)
    expect(r).toEqual({ ok: true, outputUrl: 'https://bucket/posters/p.jpg', fileSizeKb: 400, costUsd: 0.054188, requestId: 'req_1' })
    expect(d.edit).toHaveBeenCalledTimes(1)
    expect(d.edit).toHaveBeenCalledWith({ model: REQ.model, image: Buffer.from('jpg'), mimeType: 'image/jpeg', prompt: REQ.prompt })
    expect(d.store).toHaveBeenCalledWith({ base64: 'AAAA', clientId: 'client-1' })
  })

  it('source photo unreachable → no edit (nothing spent)', async () => {
    const d = deps({ fetchSource: vi.fn().mockRejectedValue(new Error('HTTP 404')) })
    const r = await runImageEdit(REQ, d)
    expect(r).toEqual({ ok: false, reason: 'source_fetch_failed: HTTP 404', costUsd: null, requestId: null })
    expect(d.edit).not.toHaveBeenCalled()
  })

  it('provider error → returned once, never re-submitted', async () => {
    const d = deps({ edit: vi.fn().mockRejectedValue(new Error('timeout')) })
    const r = await runImageEdit(REQ, d)
    expect(r).toMatchObject({ ok: false, reason: 'edit_failed_maybe_billed: timeout', costUsd: null })
    expect(d.edit).toHaveBeenCalledTimes(1)
    expect(d.store).not.toHaveBeenCalled()
  })

  it('no image in the response → no_output, cost still reported', async () => {
    const d = deps({ edit: vi.fn().mockResolvedValue({ b64: null, usage: USAGE, requestId: 'req_2' }) })
    expect(await runImageEdit(REQ, d)).toEqual({ ok: false, reason: 'no_output', costUsd: 0.054188, requestId: 'req_2' })
    expect(d.store).not.toHaveBeenCalled()
  })

  it('storage failure → fallback with the cost already spent', async () => {
    const d = deps({ store: vi.fn().mockRejectedValue(new Error('bucket down')) })
    expect(await runImageEdit(REQ, d)).toEqual({ ok: false, reason: 'output_store_failed: bucket down', costUsd: 0.054188, requestId: 'req_1' })
  })
})
