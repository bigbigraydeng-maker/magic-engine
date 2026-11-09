import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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
  SNAPSHOT_KEY,
  type NineGridFrame,
  type NineGridInput,
} from '@/lib/maliang/render-check'
import {
  REVIEW_V2_ESTIMATE_USD,
  buildReviewPromptV2,
  parseReviewV2,
  runReviewCheckV2,
  verdictV2,
  withinWeeklyBudget,
  type MaliangCheckV2,
  type ReviewV2Result,
} from '@/lib/maliang/render-check-v2'
import { toWorkOrderSnapshotV2 } from '@/lib/maliang/work-order-review'

const probeMock = vi.mocked(safeProbeRemoteFile)

const baseInput: NineGridInput = {
  title: 'Test reel',
  brandName: 'Acme Co',
  expectedCaptions: [],
  visualNotes: [],
  logoExpected: true,
}

function okFrame(i: number): NineGridFrame {
  return {
    t_pct: NINE_GRID_PCTS[i],
    image_ok: true,
    image_note: '',
    text_seen: '',
    text_ok: true,
    text_note: '',
    logo_seen: true,
    logo_ok: true,
    logo_note: '',
  }
}

function okFrames(): NineGridFrame[] {
  return NINE_GRID_PCTS.map((_, i) => okFrame(i))
}

interface V2Payload {
  frames: NineGridFrame[]
  overall_note: string
  shots: Array<{ t_start: number; t_end: number; shown: string; text_seen: string; logo_visible: boolean }>
  audio: { speech_present: boolean; transcript: string; music_present: boolean; problems: string[] }
  identifiable_faces: Array<{ t_start: number; t_end: number; count: number }>
}

function v2Payload(overrides: Partial<V2Payload> = {}): V2Payload {
  return {
    frames: okFrames(),
    overall_note: '',
    shots: [{ t_start: 0, t_end: 3, shown: 'beach', text_seen: 'Hello', logo_visible: true }],
    audio: { speech_present: true, transcript: 'hello there', music_present: true, problems: [] },
    identifiable_faces: [],
    ...overrides,
  }
}

function v2Json(overrides: Partial<V2Payload> = {}): string {
  return JSON.stringify(v2Payload(overrides))
}

function okResult(overrides: Partial<ReviewV2Result> = {}): ReviewV2Result {
  return {
    frames: okFrames(),
    overall_note: '',
    shots: [{ t_start: 0, t_end: 3, shown: 'beach', text_seen: 'Hello', logo_visible: true }],
    audio: { speech_present: true, transcript: 'hello there', music_present: true, problems: [] },
    identifiable_faces: [],
    ...overrides,
  }
}

const meta = {
  videoUrl: 'https://example.supabase.co/v.mp4',
  checkedAt: '2026-01-01T00:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('buildReviewPromptV2', () => {
  it('keeps the v1 question markers and brand, and adds the v2 sections', () => {
    const prompt = buildReviewPromptV2(baseInput)
    expect(prompt).toContain('IMAGE')
    expect(prompt).toContain('LOGO')
    expect(prompt).toContain('Acme Co')
    expect(prompt).toContain('SHOTS')
    expect(prompt).toContain('AUDIO')
    expect(prompt).toContain('IDENTIFIABLE FACES')
  })

  it('does not contain the old v1 single-line schema marker', () => {
    const prompt = buildReviewPromptV2(baseInput)
    expect(prompt).not.toContain('"logo_note":""},{"t_pct":12.5')
  })

  it('embeds a parseable JSON example with the v2 keys', () => {
    const prompt = buildReviewPromptV2(baseInput)
    const marker = 'exactly this schema:'
    const idx = prompt.indexOf(marker)
    expect(idx).toBeGreaterThanOrEqual(0)
    const jsonText = prompt.slice(idx + marker.length).trim()
    const parsed: unknown = JSON.parse(jsonText)
    expect(parsed).not.toBeNull()
    expect(typeof parsed).toBe('object')
    const obj = parsed as Record<string, unknown>
    expect(Object.keys(obj).sort()).toEqual(
      ['audio', 'frames', 'identifiable_faces', 'overall_note', 'shots'].sort(),
    )
  })
})

describe('parseReviewV2', () => {
  it('parses valid JSON into 9 frames, 1 shot, and the transcript', () => {
    const parsed = parseReviewV2(v2Json())
    expect(parsed).not.toBeNull()
    expect(parsed?.frames).toHaveLength(9)
    expect(parsed?.shots).toHaveLength(1)
    expect(parsed?.audio.transcript).toBe('hello there')
  })

  it('parses JSON wrapped in ```json fences', () => {
    const raw = '```json\n' + v2Json() + '\n```'
    expect(parseReviewV2(raw)).not.toBeNull()
  })

  it('returns null for non-JSON', () => {
    expect(parseReviewV2('not json at all')).toBeNull()
  })

  it('returns null for only 8 frames', () => {
    expect(parseReviewV2(v2Json({ frames: okFrames().slice(0, 8) }))).toBeNull()
  })

  it('returns null when audio is missing', () => {
    const payload = v2Payload()
    const withoutAudio: Record<string, unknown> = { ...payload }
    delete withoutAudio.audio
    expect(parseReviewV2(JSON.stringify(withoutAudio))).toBeNull()
  })

  it('returns null when audio.problems is not an array', () => {
    const payload = v2Payload()
    const bad = {
      ...payload,
      audio: { speech_present: true, transcript: '', music_present: true, problems: 'nope' },
    }
    expect(parseReviewV2(JSON.stringify(bad))).toBeNull()
  })

  it('returns null when a face has count -1', () => {
    expect(
      parseReviewV2(v2Json({ identifiable_faces: [{ t_start: 0, t_end: 1, count: -1 }] })),
    ).toBeNull()
  })

  it('returns null when a shot lacks t_start', () => {
    const payload = v2Payload()
    const bad = {
      ...payload,
      shots: [{ t_end: 3, shown: 'beach', text_seen: '', logo_visible: true }],
    }
    expect(parseReviewV2(JSON.stringify(bad))).toBeNull()
  })

  it('returns null for a top-level JSON array', () => {
    expect(parseReviewV2(JSON.stringify([v2Payload()]))).toBeNull()
  })
})

describe('verdictV2', () => {
  it('passes when everything is ok', () => {
    const v = verdictV2(okResult(), baseInput)
    expect(v.status).toBe('pass')
    expect(v.check_version).toBe('v2')
    expect(v.reasons).toEqual([])
    expect(v.questions).toEqual([])
  })

  it('fails when there is no speech and no music', () => {
    const v = verdictV2(
      okResult({
        audio: { speech_present: false, transcript: '', music_present: false, problems: [] },
      }),
      baseInput,
    )
    expect(v.status).toBe('fail')
    expect(v.reasons.join(' ')).toContain('silent')
  })

  it('passes with speech only', () => {
    const v = verdictV2(
      okResult({
        audio: { speech_present: true, transcript: 'hi', music_present: false, problems: [] },
      }),
      baseInput,
    )
    expect(v.status).toBe('pass')
  })

  it('passes with music only', () => {
    const v = verdictV2(
      okResult({
        audio: { speech_present: false, transcript: '', music_present: true, problems: [] },
      }),
      baseInput,
    )
    expect(v.status).toBe('pass')
  })

  it('adds a question for an identifiable face but does not fail', () => {
    const v = verdictV2(
      okResult({ identifiable_faces: [{ t_start: 3.5, t_end: 5, count: 2 }] }),
      baseInput,
    )
    expect(v.status).toBe('pass')
    expect(v.reasons).toEqual([])
    expect(v.questions).toHaveLength(1)
    expect(v.questions[0]).toContain('3.5')
    expect(v.questions[0]).toContain('需人确认授权')
  })

  it('adds no question for a face with count 0', () => {
    const v = verdictV2(
      okResult({ identifiable_faces: [{ t_start: 0, t_end: 1, count: 0 }] }),
      baseInput,
    )
    expect(v.questions).toEqual([])
  })

  it('adds one question per identifiable face', () => {
    const v = verdictV2(
      okResult({
        identifiable_faces: [
          { t_start: 0, t_end: 1, count: 1 },
          { t_start: 2, t_end: 3, count: 1 },
        ],
      }),
      baseInput,
    )
    expect(v.questions).toHaveLength(2)
  })

  it('still fails on a bad image frame', () => {
    const frames = okFrames()
    frames[2] = { ...frames[2], image_ok: false, image_note: 'melted' }
    const v = verdictV2(okResult({ frames }), baseInput)
    expect(v.status).toBe('fail')
    expect(v.reasons.join(' ')).toContain('画面')
  })

  it('still fails on a bad text frame', () => {
    const frames = okFrames()
    frames[1] = { ...frames[1], text_ok: false, text_note: 'cut off' }
    const v = verdictV2(okResult({ frames }), baseInput)
    expect(v.status).toBe('fail')
  })

  it('fails when logo is expected but never seen', () => {
    const frames = okFrames().map((f) => ({ ...f, logo_seen: false, logo_ok: false }))
    const v = verdictV2(okResult({ frames }), baseInput)
    expect(v.status).toBe('fail')
    expect(v.reasons.join(' ')).toContain('logo')
  })

  it('passes when logo is not expected and never seen', () => {
    const frames = okFrames().map((f) => ({ ...f, logo_seen: false, logo_ok: false }))
    const v = verdictV2(okResult({ frames }), { ...baseInput, logoExpected: false })
    expect(v.status).toBe('pass')
  })

  it('does not judge the transcript', () => {
    const v = verdictV2(
      okResult({
        audio: {
          speech_present: true,
          transcript: 'something unrelated',
          music_present: true,
          problems: [],
        },
      }),
      baseInput,
    )
    expect(v.status).toBe('pass')
  })

  it('copies videoUrl and checkedAt from meta', () => {
    const v = verdictV2(okResult(), baseInput, meta)
    expect(v.video_url).toBe(meta.videoUrl)
    expect(v.checked_at).toBe(meta.checkedAt)
  })
})

describe('runReviewCheckV2', () => {
  const videoUrl = 'https://example.supabase.co/v.mp4'
  const allowedHosts = ['example.supabase.co']

  function stubFetch(): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) })),
    )
  }

  it('returns unverifiable when apiKey is undefined and does not call analyze', async () => {
    const analyze = vi.fn()
    const check = await runReviewCheckV2(
      { videoUrl, input: baseInput, apiKey: undefined },
      { analyze, allowedHosts },
    )
    expect(check.status).toBe('unverifiable')
    expect(check.reasons.join(' ')).toContain('GEMINI_API_KEY')
    expect(check.check_version).toBe('v2')
    expect(analyze).not.toHaveBeenCalled()
  })

  it('returns unverifiable when the probe fails', async () => {
    probeMock.mockResolvedValueOnce({ ok: false, error: 'blocked' })
    const analyze = vi.fn()
    const check = await runReviewCheckV2(
      { videoUrl, input: baseInput, apiKey: 'test-key' },
      { analyze, allowedHosts },
    )
    expect(check.status).toBe('unverifiable')
    expect(check.reasons.join(' ')).toContain('视频下载失败')
    expect(analyze).not.toHaveBeenCalled()
  })

  it('returns unverifiable when analyze throws', async () => {
    probeMock.mockResolvedValueOnce({ ok: true, finalUrl: videoUrl })
    stubFetch()
    const analyze = vi.fn(async () => {
      throw new Error('boom')
    })
    const check = await runReviewCheckV2(
      { videoUrl, input: baseInput, apiKey: 'test-key' },
      { analyze, allowedHosts },
    )
    expect(check.status).toBe('unverifiable')
    expect(check.reasons.join(' ')).toContain('模型调用失败')
  })

  it('returns unverifiable (never pass) when analyze returns garbage', async () => {
    probeMock.mockResolvedValueOnce({ ok: true, finalUrl: videoUrl })
    stubFetch()
    const analyze = vi.fn(async () => 'totally not json')
    const check = await runReviewCheckV2(
      { videoUrl, input: baseInput, apiKey: 'test-key' },
      { analyze, allowedHosts },
    )
    expect(check.status).toBe('unverifiable')
    expect(check.reasons.join(' ')).toContain('模型回答格式不对')
    expect(check.frames).toEqual([])
    expect(check.check_version).toBe('v2')
  })

  it('passes on a valid v2 answer and forwards the v2 prompt', async () => {
    probeMock.mockResolvedValueOnce({ ok: true, finalUrl: videoUrl })
    stubFetch()
    const analyze = vi.fn(async (_file: string, _prompt: string, _key: string) => v2Json())
    const check = await runReviewCheckV2(
      { videoUrl, input: baseInput, apiKey: 'test-key' },
      { analyze, allowedHosts },
    )
    expect(check.status).toBe('pass')
    expect(check.shots).toHaveLength(1)
    expect(check.model).toBe('gemini-2.5-flash')
    expect(analyze.mock.calls[0][1]).toContain('IDENTIFIABLE FACES')
  })

  it('fails on a valid v2 answer with silent audio', async () => {
    probeMock.mockResolvedValueOnce({ ok: true, finalUrl: videoUrl })
    stubFetch()
    const analyze = vi.fn(async () =>
      v2Json({
        audio: { speech_present: false, transcript: '', music_present: false, problems: [] },
      }),
    )
    const check = await runReviewCheckV2(
      { videoUrl, input: baseInput, apiKey: 'test-key' },
      { analyze, allowedHosts },
    )
    expect(check.status).toBe('fail')
  })

  it('passes with a question when a face is present', async () => {
    probeMock.mockResolvedValueOnce({ ok: true, finalUrl: videoUrl })
    stubFetch()
    const analyze = vi.fn(async () =>
      v2Json({ identifiable_faces: [{ t_start: 1, t_end: 2, count: 1 }] }),
    )
    const check = await runReviewCheckV2(
      { videoUrl, input: baseInput, apiKey: 'test-key' },
      { analyze, allowedHosts },
    )
    expect(check.status).toBe('pass')
    expect(check.questions).toHaveLength(1)
  })
})

describe('withinWeeklyBudget', () => {
  it('allows a spend plus estimate under the cap', () => {
    expect(withinWeeklyBudget(0, 1, 0.05)).toBe(true)
  })

  it('allows a spend plus estimate exactly equal to the cap', () => {
    expect(withinWeeklyBudget(0.5, 1, 0.5)).toBe(true)
  })

  it('rejects a spend plus estimate over the cap', () => {
    expect(withinWeeklyBudget(0.96, 1, 0.05)).toBe(false)
  })

  it('rejects when already at the cap', () => {
    expect(withinWeeklyBudget(1, 1, 0.05)).toBe(false)
  })

  it('rejects a zero cap', () => {
    expect(withinWeeklyBudget(0, 0, 0.05)).toBe(false)
  })

  it('rejects a negative cap', () => {
    expect(withinWeeklyBudget(0, -1, 0.05)).toBe(false)
  })

  it('rejects a negative spend', () => {
    expect(withinWeeklyBudget(-1, 1, 0.05)).toBe(false)
  })

  it('rejects a negative estimate', () => {
    expect(withinWeeklyBudget(0, 1, -0.05)).toBe(false)
  })

  it('rejects NaN in each position', () => {
    expect(withinWeeklyBudget(Number.NaN, 1, 0.05)).toBe(false)
    expect(withinWeeklyBudget(0, Number.NaN, 0.05)).toBe(false)
    expect(withinWeeklyBudget(0, 1, Number.NaN)).toBe(false)
  })

  it('rejects an infinite cap', () => {
    expect(withinWeeklyBudget(0, Number.POSITIVE_INFINITY, 0.05)).toBe(false)
  })

  it('exposes a positive finite estimate', () => {
    expect(Number.isFinite(REVIEW_V2_ESTIMATE_USD)).toBe(true)
    expect(REVIEW_V2_ESTIMATE_USD).toBeGreaterThan(0)
  })
})

describe('toWorkOrderSnapshotV2', () => {
  function passCheck(): MaliangCheckV2 {
    return verdictV2(okResult(), baseInput, meta)
  }

  it('stamps the v2 check and preserves other output fields', () => {
    const check = passCheck()
    const result = toWorkOrderSnapshotV2({ caption: 'x', other: 1 }, check)
    expect(result[SNAPSHOT_KEY]).toEqual(check)
    const stored = result[SNAPSHOT_KEY]
    expect(stored).not.toBeNull()
    expect(typeof stored).toBe('object')
    expect('check_version' in (stored as object)).toBe(true)
    expect(result.caption).toBe('x')
    expect(result.other).toBe(1)
    expect(result.machine_reviewed).toBe(true)
  })

  it('marks an unverifiable check as not machine reviewed', () => {
    const check: MaliangCheckV2 = {
      check_version: 'v2',
      status: 'unverifiable',
      checked_at: meta.checkedAt,
      video_url: meta.videoUrl,
      reasons: ['模型回答格式不对'],
      frames: [],
      model: null,
      shots: [],
      audio: { speech_present: false, transcript: '', music_present: false, problems: [] },
      identifiable_faces: [],
      questions: [],
    }
    const result = toWorkOrderSnapshotV2({ caption: 'x' }, check)
    expect(result.machine_reviewed).toBe(false)
  })

  it('returns an object holding the snapshot when current is undefined', () => {
    const check = passCheck()
    const result = toWorkOrderSnapshotV2(undefined, check)
    expect(result[SNAPSHOT_KEY]).toEqual(check)
  })
})
