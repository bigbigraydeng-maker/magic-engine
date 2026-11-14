import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ create: vi.fn(), getClient: vi.fn() }))

vi.mock('@/lib/anthropic/client', () => ({
  getAnthropicClient: mocks.getClient,
  MODEL_HAIKU: 'haiku-test',
  modelCostUsd: (_m: string, i: number, o: number) => i / 1e6 + o / 1e6,
}))

import { POSTER_TRANSCRIBE_PROMPT, readPosterText } from '../poster-text-reader'

const realFetch = globalThis.fetch

function imageResponse(bytes: number, status = 200) {
  return new Response(status === 200 ? new Uint8Array(bytes) : null, {
    status,
    headers: { 'content-type': 'image/jpeg' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getClient.mockReturnValue({ messages: { create: mocks.create } })
  mocks.create.mockResolvedValue({
    content: [{ type: 'text', text: 'China Panorama\n14 Days' }],
    usage: { input_tokens: 1000, output_tokens: 20 },
  })
})
afterEach(() => { globalThis.fetch = realFetch })

describe('readPosterText (default reader, fake SDK + fake fetch)', () => {
  it('sends the image + a copy-only prompt to the small model, returns text and cost', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () => imageResponse(10))
    const r = await readPosterText('https://out/p.jpg')
    expect(r).toEqual({ ok: true, text: 'China Panorama\n14 Days', costUsd: 0.00102 })
    const req = mocks.create.mock.calls[0][0]
    expect(req.model).toBe('haiku-test')
    expect(req.temperature).toBe(0)
    expect(req.messages[0].content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg' } })
    expect(req.messages[0].content[1].text).toBe(POSTER_TRANSCRIBE_PROMPT)
    expect(POSTER_TRANSCRIBE_PROMPT).toContain('Do not correct')
    // client created inside the call, not at import
    expect(mocks.getClient).toHaveBeenCalledTimes(1)
  })

  it('image fetch failure / too large → failed, no model call, cost null', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(imageResponse(0, 404))
    expect(await readPosterText('https://out/p.jpg')).toEqual({ ok: false, reason: 'image_fetch_404', costUsd: null })
    globalThis.fetch = vi.fn().mockResolvedValue(imageResponse(5 * 1024 * 1024 + 1))
    expect(await readPosterText('https://out/p.jpg')).toMatchObject({ ok: false, reason: 'image_too_large' })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('model error → failed; empty transcription → failed with cost', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () => imageResponse(10))
    mocks.create.mockRejectedValueOnce(new Error('overloaded'))
    expect(await readPosterText('https://out/p.jpg')).toMatchObject({ ok: false, costUsd: null })
    mocks.create.mockResolvedValueOnce({ content: [], usage: { input_tokens: 1000, output_tokens: 0 } })
    expect(await readPosterText('https://out/p.jpg')).toEqual({ ok: false, reason: 'empty_transcription', costUsd: 0.001 })
  })
})
