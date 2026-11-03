// 马良 · 出片分镜自检 v2（agent 自治计划 B2 扩展）。在 v1 九宫格三问（画面 / 文字 / logo）之上，
// 追加三项：逐镜镜头表（shots）、音轨体检（audio）、可辨认人脸（identifiable_faces）。
// 复用 render-check.ts 的 prompt 骨架、解析器与裁决器，绝不重复定义。只出裁决，不发布、不改片。
// 读不到 / 格式不对 = unverifiable，绝不给「过关」默认值。人脸只进 questions（需人确认授权），
// 不进 reasons、不判 fail。

import {
  MALIANG_MODEL, NINE_GRID_PCTS, asString, buildNineGridPrompt, decideVerdict, downloadAndAnalyze,
  isPlainObject, parseFrame, parseJsonObject,
  type MaliangCheck, type NineGridFrame, type NineGridInput, type VideoAnalyzer,
} from '@/lib/maliang/render-check'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReviewShot {
  t_start: number
  t_end: number
  shown: string
  text_seen: string
  logo_visible: boolean
}

export interface ReviewAudio {
  speech_present: boolean
  transcript: string
  music_present: boolean
  problems: string[]
}

export interface IdentifiableFace {
  t_start: number
  t_end: number
  count: number
}

export interface ReviewV2Result {
  frames: NineGridFrame[]
  overall_note: string
  shots: ReviewShot[]
  audio: ReviewAudio
  identifiable_faces: IdentifiableFace[]
}

export interface MaliangCheckV2 extends MaliangCheck {
  check_version: 'v2'
  shots: ReviewShot[]
  audio: ReviewAudio
  identifiable_faces: IdentifiableFace[]
  questions: string[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Estimated model cost of one v2 check, USD. */
export const REVIEW_V2_ESTIMATE_USD = 0.05

// ─── Prompt ───────────────────────────────────────────────────────────────────

const V2_SCHEMA_EXAMPLE = {
  frames: [
    {
      t_pct: 0,
      image_ok: true,
      image_note: '',
      text_seen: '',
      text_ok: true,
      text_note: '',
      logo_seen: true,
      logo_ok: true,
      logo_note: '',
    },
  ],
  overall_note: '',
  shots: [{ t_start: 0, t_end: 2.5, shown: '', text_seen: '', logo_visible: true }],
  audio: { speech_present: true, transcript: '', music_present: true, problems: [] },
  identifiable_faces: [{ t_start: 0, t_end: 2.5, count: 1 }],
}

function buildV2Instructions(): string {
  const pcts = NINE_GRID_PCTS.map((p) => `${p}%`).join(', ')
  const example = JSON.stringify(V2_SCHEMA_EXAMPLE)
  return `ADDITIONAL TASKS (v2)

(a) SHOTS — list every shot change you observe, in order. For each shot give:
    t_start and t_end in seconds (numbers), shown (what is shown, short),
    text_seen (on-screen text verbatim, empty string if none),
    logo_visible (boolean).

(b) AUDIO — report:
    speech_present (boolean), transcript (verbatim transcript of all speech, empty string if none),
    music_present (boolean), problems (array of strings: silence gaps longer than 2 seconds,
    clipping/distortion, speech language not matching the on-screen text language; empty array if none).

(c) IDENTIFIABLE FACES — for each shot where a real person's face is clearly identifiable
    (frontal or near-frontal and recognisable): t_start, t_end (seconds) and count of such faces.
    Leave out shots with no identifiable face. Empty array if none.

The frames array covers the 9 moments at ${pcts}; frames must contain 9 objects, one per moment listed above.

Output ONLY JSON - no markdown, no explanation, exactly this schema:
${example}`
}

export function buildReviewPromptV2(input: NineGridInput): string {
  const v1 = buildNineGridPrompt(input)
  const cut = v1.lastIndexOf('Output ONLY JSON')
  const head = cut >= 0 ? v1.slice(0, cut) : v1
  return `${head}${buildV2Instructions()}`
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

function parseShot(raw: unknown): ReviewShot | null {
  if (!isPlainObject(raw)) return null
  if (typeof raw.t_start !== 'number' || typeof raw.t_end !== 'number') return null
  if (typeof raw.logo_visible !== 'boolean') return null
  return {
    t_start: raw.t_start,
    t_end: raw.t_end,
    shown: asString(raw.shown),
    text_seen: asString(raw.text_seen),
    logo_visible: raw.logo_visible,
  }
}

function parseAudio(raw: unknown): ReviewAudio | null {
  if (!isPlainObject(raw)) return null
  if (typeof raw.speech_present !== 'boolean' || typeof raw.music_present !== 'boolean') return null
  if (!Array.isArray(raw.problems)) return null
  const problems = raw.problems.filter((p): p is string => typeof p === 'string')
  if (problems.length !== raw.problems.length) return null
  return {
    speech_present: raw.speech_present,
    transcript: asString(raw.transcript),
    music_present: raw.music_present,
    problems,
  }
}

function parseFace(raw: unknown): IdentifiableFace | null {
  if (!isPlainObject(raw)) return null
  if (typeof raw.t_start !== 'number' || typeof raw.t_end !== 'number') return null
  if (typeof raw.count !== 'number' || !Number.isInteger(raw.count) || raw.count < 0) return null
  return { t_start: raw.t_start, t_end: raw.t_end, count: raw.count }
}

function parseArray<T>(raw: unknown, parse: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(raw)) return null
  const out: T[] = []
  for (const item of raw) {
    const parsed = parse(item)
    if (parsed === null) return null
    out.push(parsed)
  }
  return out
}

export function parseReviewV2(raw: string): ReviewV2Result | null {
  try {
    const obj = parseJsonObject(raw)
    if (!Array.isArray(obj.frames) || obj.frames.length !== 9) return null
    const frames = obj.frames.map((f, i) => parseFrame(f, i))
    const shots = parseArray(obj.shots, parseShot)
    if (shots === null) return null
    const audio = parseAudio(obj.audio)
    if (audio === null) return null
    const identifiable_faces = parseArray(obj.identifiable_faces, parseFace)
    if (identifiable_faces === null) return null
    return { frames, overall_note: asString(obj.overall_note), shots, audio, identifiable_faces }
  } catch {
    return null
  }
}

// ─── Verdict ──────────────────────────────────────────────────────────────────

export function verdictV2(
  result: ReviewV2Result,
  input: NineGridInput,
  meta: { videoUrl?: string; checkedAt?: string; model?: string | null } = {},
): MaliangCheckV2 {
  const v1 = decideVerdict(
    { frames: result.frames, overall_note: result.overall_note },
    input.logoExpected,
  )
  const reasons = [...v1.reasons]

  if (!result.audio.speech_present && !result.audio.music_present) {
    reasons.push('silent：全片没有人声也没有音乐')
  }

  const questions: string[] = []
  for (const f of result.identifiable_faces) {
    if (f.count > 0) questions.push(`可辨认人脸 @ ${f.t_start}s，需人确认授权`)
  }

  return {
    check_version: 'v2',
    status: reasons.length > 0 ? 'fail' : 'pass',
    checked_at: meta.checkedAt ?? new Date().toISOString(),
    video_url: meta.videoUrl ?? '',
    reasons,
    frames: result.frames,
    model: meta.model === undefined ? MALIANG_MODEL : meta.model,
    shots: result.shots,
    audio: result.audio,
    identifiable_faces: result.identifiable_faces,
    questions,
  }
}

export function unverifiableV2(videoUrl: string, checkedAt: string, reason: string): MaliangCheckV2 {
  return {
    check_version: 'v2',
    status: 'unverifiable',
    checked_at: checkedAt,
    video_url: videoUrl,
    reasons: [reason],
    frames: [],
    model: null,
    shots: [],
    audio: { speech_present: false, transcript: '', music_present: false, problems: [] },
    identifiable_faces: [],
    questions: [],
  }
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export async function runReviewCheckV2(
  params: { videoUrl: string; input: NineGridInput; apiKey: string | undefined },
  deps: { analyze?: VideoAnalyzer; allowedHosts?: readonly string[]; now?: Date } = {},
): Promise<MaliangCheckV2> {
  const { videoUrl, input, apiKey } = params
  const checkedAt = (deps.now ?? new Date()).toISOString()

  if (!apiKey) {
    return unverifiableV2(videoUrl, checkedAt, 'GEMINI_API_KEY 未配置，马良看不了片')
  }

  const prompt = buildReviewPromptV2(input)
  const analyzed = await downloadAndAnalyze({
    videoUrl,
    prompt,
    apiKey,
    analyze: deps.analyze,
    allowedHosts: deps.allowedHosts,
  })
  if (!analyzed.ok) {
    return unverifiableV2(videoUrl, checkedAt, analyzed.reason)
  }

  const parsed = parseReviewV2(analyzed.raw)
  if (parsed === null) {
    return unverifiableV2(videoUrl, checkedAt, '模型回答格式不对：v2 回答无法解析')
  }

  return verdictV2(parsed, input, { videoUrl, checkedAt })
}

// ─── Budget ───────────────────────────────────────────────────────────────────

export function withinWeeklyBudget(spentUsd: number, capUsd: number, estimateUsd: number): boolean {
  if (!Number.isFinite(spentUsd) || !Number.isFinite(capUsd) || !Number.isFinite(estimateUsd)) {
    return false
  }
  if (spentUsd < 0 || estimateUsd < 0 || capUsd <= 0) return false
  return spentUsd + estimateUsd <= capUsd
}
