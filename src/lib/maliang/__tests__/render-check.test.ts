import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return { generateContent: async () => ({ response: { text: () => '' } }) }
    }
  },
}))

vi.mock('@google/generative-ai/server', () => ({
  GoogleAIFileManager: class {
    async uploadFile() {
      return { file: { name: 'files/x', uri: 'https://example.invalid/x', state: 'ACTIVE' } }
    }
    async getFile() {
      return { name: 'files/x', uri: 'https://example.invalid/x', state: 'ACTIVE' }
    }
    async deleteFile() {}
  },
}))

vi.mock('@/lib/factory/safe-remote-fetch', () => ({
  safeProbeRemoteFile: vi.fn(),
}))

import { safeProbeRemoteFile } from '@/lib/factory/safe-remote-fetch'
import {
  NINE_GRID_PCTS,
  MALIANG_MODEL,
  SNAPSHOT_KEY,
  buildNineGridPrompt,
  parseNineGridResponse,
  decideVerdict,
  mergeMaliangIntoSnapshot,
  readMaliangFromSnapshot,
  allowedVideoHosts,
  runNineGridCheck,
  type NineGridFrame,
  type NineGridInput,
  type NineGridResult,
  type MaliangCheck,
} from '../render-check'
import { reconcileTextOnlyMiss } from '../text-compare'

const probeMock = vi.mocked(safeProbeRemoteFile)

function frame(overrides: Partial<NineGridFrame> = {}): NineGridFrame {
  return {
    t_pct: 0,
    image_ok: true,
    image_note: '',
    text_seen: '',
    text_ok: true,
    text_note: '',
    logo_seen: true,
    logo_ok: true,
    logo_note: '',
    ...overrides,
  }
}

function nineFrames(overrides: Partial<NineGridFrame> = {}): NineGridFrame[] {
  return NINE_GRID_PCTS.map((p) => frame({ t_pct: p, ...overrides }))
}

function validJson(frames: NineGridFrame[] = nineFrames()): string {
  return JSON.stringify({ frames, overall_note: 'looks fine' })
}

const baseInput: NineGridInput = {
  title: 'Zephyr Coast Teaser',
  brandName: 'Zephyr Coast',
  expectedCaptions: ['Book your escape', 'Limited summer offer'],
  visualNotes: ['scene 2 is AI-generated', 'aerial coastline shot'],
  logoExpected: true,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('buildNineGridPrompt', () => {
  it('lists all 9 percentages, title, brand, captions, and ONLY JSON', () => {
    const prompt = buildNineGridPrompt(baseInput)
    for (const p of NINE_GRID_PCTS) {
      expect(prompt).toContain(`${p}%`)
    }
    expect(prompt).toContain('Zephyr Coast Teaser')
    expect(prompt).toContain('Zephyr Coast')
    expect(prompt).toContain('Book your escape')
    expect(prompt).toContain('Limited summer offer')
    expect(prompt).toContain('ONLY JSON')
  })
})

describe('parseNineGridResponse', () => {
  it('accepts a fenced valid 9-frame JSON', () => {
    const raw = '```json\n' + validJson() + '\n```'
    const parsed = parseNineGridResponse(raw)
    expect(parsed.frames).toHaveLength(9)
    expect(parsed.overall_note).toBe('looks fine')
  })

  it('throws on 8 frames', () => {
    const raw = JSON.stringify({ frames: nineFrames().slice(0, 8), overall_note: '' })
    expect(() => parseNineGridResponse(raw)).toThrow()
  })

  it('throws on non-boolean image_ok', () => {
    const frames = nineFrames()
    const bad = { ...frames[0], image_ok: 'yes' }
    const raw = JSON.stringify({ frames: [bad, ...frames.slice(1)], overall_note: '' })
    expect(() => parseNineGridResponse(raw)).toThrow()
  })

  it('throws on non-JSON', () => {
    expect(() => parseNineGridResponse('not json at all')).toThrow()
  })
})

describe('decideVerdict', () => {
  it('passes when all ok and logo seen', () => {
    const result: NineGridResult = { frames: nineFrames(), overall_note: '' }
    const v = decideVerdict(result, true)
    expect(v.status).toBe('pass')
    expect(v.reasons).toEqual([])
  })

  it('fails when frame 3 image_ok is false', () => {
    const frames = nineFrames()
    frames[2] = frame({ t_pct: 25, image_ok: false, image_note: 'melted face' })
    const v = decideVerdict({ frames, overall_note: '' }, true)
    expect(v.status).toBe('fail')
    expect(v.reasons.some((r) => r.includes('第 3 镜画面'))).toBe(true)
  })

  it('fails when logoExpected and no frame has logo_seen', () => {
    const frames = nineFrames({ logo_seen: false, logo_ok: false })
    const v = decideVerdict({ frames, overall_note: '' }, true)
    expect(v.status).toBe('fail')
    expect(v.reasons.some((r) => r.includes('全片 9 镜都没看到'))).toBe(true)
  })

  it('passes when logoExpected is false and no logo seen', () => {
    const frames = nineFrames({ logo_seen: false, logo_ok: false })
    const v = decideVerdict({ frames, overall_note: '' }, false)
    expect(v.status).toBe('pass')
    expect(v.reasons).toEqual([])
  })

  it('fails when logo_seen true but logo_ok false', () => {
    const frames = nineFrames()
    frames[4] = frame({ t_pct: 50, logo_seen: true, logo_ok: false, logo_note: 'cropped' })
    const v = decideVerdict({ frames, overall_note: '' }, true)
    expect(v.status).toBe('fail')
    expect(v.reasons.some((r) => r.includes('第 5 镜 logo'))).toBe(true)
  })
})

describe('snapshot merge / read', () => {
  it('preserves endcard and libai_provenance, sets maliang_check only', () => {
    const current = { endcard: { cta: 'Book now' }, libai_provenance: { run: 7 } }
    const check: MaliangCheck = {
      status: 'pass',
      checked_at: '2026-01-01T00:00:00.000Z',
      video_url: 'https://example.supabase.co/v.mp4',
      reasons: [],
      frames: nineFrames(),
      model: MALIANG_MODEL,
    }
    const merged = mergeMaliangIntoSnapshot(current, check)
    expect(merged.endcard).toEqual({ cta: 'Book now' })
    expect(merged.libai_provenance).toEqual({ run: 7 })
    expect(merged[SNAPSHOT_KEY]).toEqual(check)
  })

  it('readMaliangFromSnapshot returns null for junk and object for valid', () => {
    expect(readMaliangFromSnapshot(null)).toBeNull()
    expect(readMaliangFromSnapshot({})).toBeNull()
    expect(readMaliangFromSnapshot({ [SNAPSHOT_KEY]: { status: 'nope' } })).toBeNull()

    const valid: MaliangCheck = {
      status: 'fail',
      checked_at: '2026-01-01T00:00:00.000Z',
      video_url: 'https://example.supabase.co/v.mp4',
      reasons: ['第 1 镜画面：melted'],
      frames: nineFrames(),
      model: MALIANG_MODEL,
    }
    const read = readMaliangFromSnapshot({ [SNAPSHOT_KEY]: valid })
    expect(read).not.toBeNull()
    expect(read?.status).toBe('fail')
  })
})

describe('allowedVideoHosts', () => {
  it('parses the host out of NEXT_PUBLIC_SUPABASE_URL', () => {
    const hosts = allowedVideoHosts({ NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co' })
    expect(hosts).toEqual(['example.supabase.co'])
  })

  it('returns [] when unset', () => {
    expect(allowedVideoHosts({})).toEqual([])
  })
})

describe('reconcileTextOnlyMiss', () => {
  const line = 'West Lake and the Legend of the White Snake'
  const expected = [line]

  it('treats a case or line-break difference as a model miss when the picture has the whole line', () => {
    const frames = nineFrames()
    frames[2] = frame({
      t_pct: 25,
      text_ok: false,
      text_note: '少了 Snake',
      text_seen: 'West Lake and the Legend of the White\nSnake',
    })
    const verdict = decideVerdict({ frames, overall_note: '' }, true)
    const next = reconcileTextOnlyMiss(verdict, frames, expected)
    expect(verdict.status).toBe('fail')
    expect(next.status).toBe('pass')
    expect(next.text_recheck).toBe('false_positive')
  })

  it('still fails when the picture is actually missing the word', () => {
    const frames = nineFrames()
    frames[2] = frame({
      t_pct: 25,
      text_ok: false,
      text_note: '少了 Snake',
      text_seen: 'West Lake and the Legend of the White',
    })
    const next = reconcileTextOnlyMiss(decideVerdict({ frames, overall_note: '' }, true), frames, expected)
    expect(next.status).toBe('fail')
    expect(next.text_recheck).toBeNull()
    expect(next.reasons.some((reason) => reason.includes('少了 Snake'))).toBe(true)
  })

  it('does not override a real picture problem', () => {
    const frames = nineFrames()
    frames[2] = frame({ t_pct: 25, image_ok: false, image_note: '糊了', text_seen: line })
    const next = reconcileTextOnlyMiss(decideVerdict({ frames, overall_note: '' }, true), frames, expected)
    expect(next.status).toBe('fail')
    expect(next.text_recheck).toBeNull()
  })

  it('leaves an already passing check unchanged', () => {
    const frames = nineFrames({ text_seen: line })
    const next = reconcileTextOnlyMiss(decideVerdict({ frames, overall_note: '' }, true), frames, expected)
    expect(next.status).toBe('pass')
    expect(next.text_recheck).toBeNull()
  })
})

describe('runNineGridCheck', () => {
  const videoUrl = 'https://example.supabase.co/v.mp4'

  it('returns unverifiable when apiKey is undefined and does not call analyze', async () => {
    const analyze = vi.fn()
    const check = await runNineGridCheck({
      videoUrl,
      input: baseInput,
      apiKey: undefined,
      analyze,
      allowedHosts: ['example.supabase.co'],
    })
    expect(check.status).toBe('unverifiable')
    expect(check.reasons.join(' ')).toContain('GEMINI_API_KEY')
    expect(analyze).not.toHaveBeenCalled()
  })

  it('returns unverifiable when probe fails', async () => {
    probeMock.mockResolvedValueOnce({ ok: false, error: '这个链接指向内部地址，不能用' })
    const analyze = vi.fn()
    const check = await runNineGridCheck({
      videoUrl,
      input: baseInput,
      apiKey: 'test-key',
      analyze,
      allowedHosts: ['example.supabase.co'],
    })
    expect(check.status).toBe('unverifiable')
    expect(check.reasons.join(' ')).toContain('视频下载失败')
    expect(analyze).not.toHaveBeenCalled()
  })

  it('returns fail with 9 frames when analyze returns one bad text frame', async () => {
    probeMock.mockResolvedValueOnce({ ok: true, finalUrl: videoUrl })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) })),
    )
    const frames = nineFrames()
    frames[1] = frame({ t_pct: 12.5, text_ok: false, text_note: 'cut off' })
    const analyze = vi.fn(async () => validJson(frames))

    const check = await runNineGridCheck({
      videoUrl,
      input: baseInput,
      apiKey: 'test-key',
      analyze,
      allowedHosts: ['example.supabase.co'],
    })
    expect(check.status).toBe('fail')
    expect(check.frames).toHaveLength(9)
    expect(check.model).toBe('gemini-2.5-flash')
    vi.unstubAllGlobals()
  })

  it('returns unverifiable when analyze returns garbage', async () => {
    probeMock.mockResolvedValueOnce({ ok: true, finalUrl: videoUrl })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) })),
    )
    const analyze = vi.fn(async () => 'totally not json')
    const check = await runNineGridCheck({
      videoUrl,
      input: baseInput,
      apiKey: 'test-key',
      analyze,
      allowedHosts: ['example.supabase.co'],
    })
    expect(check.status).toBe('unverifiable')
    expect(check.reasons.join(' ')).toContain('模型回答格式不对')
    vi.unstubAllGlobals()
  })
})
