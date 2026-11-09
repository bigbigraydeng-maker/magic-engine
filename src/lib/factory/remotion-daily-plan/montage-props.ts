import type {
  AssetPoolClip,
  BlockReason,
  BrandInput,
  IndustryWordProfile,
  MontageBuildReceipt,
  MontageBuildResult,
  MontageProps,
  MusicTrack,
  ProductFactInput,
  WordSpec,
} from './types'
import { pickMusic, stagedFileName, type MusicPick } from './music'

/** Maximum age of a product fact before it is considered stale. */
export const FACT_MAX_AGE_DAYS = 14
/** Minimum number of clips in the pool. */
export const POOL_MIN_CLIPS = 8
/** Minimum number of distinct clip kinds. */
export const POOL_MIN_KINDS = 3
/** Maximum number of clips kept from the pool. */
export const POOL_MAX_CLIPS = 24

/** Input for the montage props builder. */
export interface BuildMontageInput {
  fact: ProductFactInput
  brand: BrandInput
  pool: readonly AssetPoolClip[]
  tracks: readonly MusicTrack[]
  profile: IndustryWordProfile
  now: Date
  /** Client's IANA time zone for 'today' (default Pacific/Auckland — AU/NZ clients). */
  timeZone?: string
}

/** Failure shape shared by every gate. */
type Failure = { ok: false; reason: BlockReason; detail: string; fix: string }

/** Build a failure result. */
function fail(reason: BlockReason, detail: string, fix: string): Failure {
  return { ok: false, reason, detail, fix }
}

/** Gate 1-3: fact status, freshness and required fields. */
function gateFact(fact: ProductFactInput, now: Date): { ok: true } | Failure {
  if (fact.status !== 'ok') {
    const reason: BlockReason = fact.status === 'stale' ? 'fact_stale' : 'fact_not_ok'
    return fail(reason, `产品事实状态为 ${fact.status}`, '请重新抓取并核对产品事实')
  }
  if (fact.verified_at === null) {
    return fail('fact_stale', '产品事实没有核验时间', '请重新抓取并核对产品事实')
  }
  const t = Date.parse(fact.verified_at)
  if (!Number.isFinite(t)) {
    return fail('fact_stale', '产品事实核验时间无法解析', '请重新抓取并核对产品事实')
  }
  const ageDays = (now.getTime() - t) / 86400000
  if (ageDays > FACT_MAX_AGE_DAYS) {
    return fail('fact_stale', `产品事实已过期 ${Math.floor(ageDays)} 天`, '请重新抓取并核对产品事实')
  }
  if (ageDays < -1) {
    return fail('fact_stale', '产品事实核验时间在未来', '请检查系统时间或重新抓取')
  }
  const missing =
    fact.duration_days === null ||
    fact.from_price === null ||
    fact.departures === null ||
    fact.departures.length === 0 ||
    fact.inclusions === null ||
    fact.inclusions.length === 0
  if (missing) {
    return fail('fact_incomplete', '产品事实缺少必要字段', '请补全行程天数、价格、出发日期和包含项目')
  }
  return { ok: true }
}

const CLIP_PATH = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/
const CLIP_EXTS = ['.mp4', '.mov', '.webm']
const LOGO_EXTS = ['.png', '.jpg', '.jpeg', '.webp']
const TAG = /^[a-z0-9-]{1,24}$/
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/
const CLIP_KINDS = ['aerial', 'street', 'person', 'detail']
const CLIP_SOURCES = ['own', 'stock', 'ai']
const WORD_BGS = ['black', 'brand', 'white']
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

/** A safe relative file name with an allowed extension (same rule as the engine's relFile). */
function isSafeFile(file: string, exts: readonly string[]): boolean {
  if (file.length > 120 || file.includes('..') || !CLIP_PATH.test(file)) return false
  return exts.some((e) => file.toLowerCase().endsWith(e))
}

/** Engine-equivalent field check for one pool clip; returns the problem or null. */
function clipProblem(c: AssetPoolClip): string | null {
  if (typeof c.file !== 'string' || !isSafeFile(c.file, CLIP_EXTS)) return `镜头文件名不合规：${String(c.file)}`
  if (typeof c.tag !== 'string' || !TAG.test(c.tag)) return `镜头标签不合规（只能小写字母、数字、连字符）：${String(c.tag)}`
  if (!CLIP_KINDS.includes(c.kind)) return `镜头类型不合规：${String(c.kind)}`
  if (!CLIP_SOURCES.includes(c.source)) return `镜头来源不合规：${String(c.source)}`
  if (!Number.isInteger(c.lenFrames) || c.lenFrames < 30 || c.lenFrames > 900) return `镜头长度必须是 30 到 900 帧：${c.file}`
  if (c.luma !== undefined && !(Number.isFinite(c.luma) && c.luma >= 1 && c.luma <= 255)) return `镜头亮度必须在 1 到 255：${c.file}`
  return null
}

/** Gate 4: truncate to the clips actually emitted, then check fields, duplicates, size and kind diversity on THAT set. */
function gatePool(
  pool: readonly AssetPoolClip[],
): { ok: true; clips: AssetPoolClip[] } | Failure {
  const clips = pool.slice(0, POOL_MAX_CLIPS)
  for (const c of clips) {
    const problem = clipProblem(c)
    if (problem !== null) return fail('pool_invalid_clip', problem, '请修正该客户的镜头池配置')
  }
  const seen = new Set<string>()
  for (const c of clips) {
    if (seen.has(c.file)) {
      return fail('pool_duplicate_file', `镜头文件重复：${c.file}`, '请删除重复的镜头文件')
    }
    seen.add(c.file)
  }
  if (clips.length < POOL_MIN_CLIPS) {
    return fail('pool_too_small', `镜头池只有 ${clips.length} 个，至少需要 ${POOL_MIN_CLIPS} 个`, '请补充更多镜头')
  }
  const kinds = new Set(clips.map((c) => c.kind))
  if (kinds.size < POOL_MIN_KINDS) {
    return fail('pool_kinds_too_few', `镜头池只有 ${kinds.size} 种类型，至少需要 ${POOL_MIN_KINDS} 种`, '请补充不同类型的镜头')
  }
  return { ok: true, clips }
}

/** Gate 4b: brand colour and logo file must satisfy the engine's constraints. */
function gateBrand(brand: BrandInput): { ok: true } | Failure {
  if (typeof brand.brandColor !== 'string' || !HEX_COLOR.test(brand.brandColor)) {
    return fail('brand_invalid', `品牌色不是 #RRGGBB：${String(brand.brandColor)}`, '请在品牌资料里填写 #RRGGBB 格式的品牌色')
  }
  if (typeof brand.logoFile !== 'string' || !isSafeFile(brand.logoFile, LOGO_EXTS)) {
    return fail('brand_invalid', `logo 文件名不合规：${String(brand.logoFile)}`, 'logo 必须是素材库里的 png/jpg/webp 相对文件名')
  }
  return { ok: true }
}

/** Gate 5b: engine-equivalent checks on what an industry profile returned (the profile is an open extension point). */
function gateWords(words: readonly WordSpec[]): { ok: true } | Failure {
  for (const w of words) {
    const t = typeof w.text === 'string' ? w.text.trim() : ''
    if (t.length < 1 || t.length > 12 || CONTROL_CHARS.test(w.text)) {
      return fail('word_invalid', `词「${String(w.text)}」必须是 1 到 12 个字符且不含控制字符`, '请修正行业词串')
    }
    if (![1, 2, 3].includes(w.beats) || !WORD_BGS.includes(w.bg)) {
      return fail('word_invalid', `词「${w.text}」的拍数必须是 1 到 3、背景必须是 black/brand/white`, '请修正行业词串')
    }
  }
  const first = words[0]
  if (first !== undefined && !(/^\d/.test(first.text.trim()) || /[?？]$/.test(first.text.trim()))) {
    return fail('word_invalid', `第一个词「${first.text}」必须以数字开头或是问句`, '蒙太奇首词必须是数字或问句，请修正行业词串')
  }
  return { ok: true }
}

/** The client's local calendar date as YYYY-MM-DD (en-CA formats that way). */
function localToday(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** Gate 6: every digit-run in a word must appear in the product fact. */
function echoCheck(fact: ProductFactInput, words: readonly WordSpec[]): { ok: true } | Failure {
  const allowed = new Set<string>()
  const add = (s: string): void => {
    for (const m of s.match(/\d+/g) ?? []) {
      allowed.add(m)
      // A zero-padded number in the fact (a date like 05-08) may be shown unpadded (8 MAY).
      allowed.add(String(Number(m)))
    }
  }
  if (fact.from_price !== null) {
    add(fact.from_price.amount.toLocaleString('en-US', { maximumFractionDigits: 2 }))
  }
  if (fact.duration_days !== null) {
    add(String(fact.duration_days))
  }
  for (const d of fact.departures ?? []) {
    add(d)
  }
  for (const inc of fact.inclusions ?? []) {
    add(inc)
  }
  for (const w of words) {
    for (const m of w.text.match(/\d+/g) ?? []) {
      if (!allowed.has(m)) {
        return fail('number_not_in_fact', `词「${w.text}」里的数字 ${m} 不在产品事实里`, '请只使用产品事实里的数字')
      }
    }
  }
  return { ok: true }
}

/** Rotation values cycled across words by index. */
const ROTATIONS = [-3, 3, -2, 2, -1, 1] as const

/** Gate 8-9: assemble props and receipt from validated pieces. */
function assemble(
  input: BuildMontageInput,
  clips: AssetPoolClip[],
  pick: MusicPick,
  words: readonly WordSpec[],
): { props: MontageProps; receipt: MontageBuildReceipt } {
  let at = 0
  const propsWords = words.map((w, i) => {
    const entry = {
      at,
      beats: w.beats,
      text: w.text,
      bg: w.bg,
      rot: ROTATIONS[i % ROTATIONS.length],
    }
    at += w.beats
    return entry
  })

  const bars = pick.totalBeats / 4
  const fastBars = Array.from(
    new Set([Math.floor((bars * 3) / 8), Math.floor((bars * 6) / 8)]),
  ).filter((b) => b >= 1 && b < bars)

  const props: MontageProps = {
    brandColor: input.brand.brandColor,
    logoFile: input.brand.logoFile,
    musicFile: stagedFileName(pick.track),
    beats: pick.beats,
    totalBeats: pick.totalBeats,
    fastBars,
    placeTerms: [],
    words: propsWords,
    clips,
  }

  const recipe_gaps: Array<{ column: string; reason: string }> = []
  if (!clips.some((c) => c.kind === 'person')) {
    recipe_gaps.push({ column: '真人出镜/自拍感', reason: '镜头池里没有真人镜头' })
  }
  if (!clips.some((c) => c.source === 'own')) {
    recipe_gaps.push({ column: '真实感', reason: '镜头池里没有自有素材（全部是库存或 AI）' })
  }

  const receipt: MontageBuildReceipt = {
    template: 'montage',
    profile: input.profile.id,
    music: {
      id: pick.track.id,
      folder: pick.track.folder,
      file: pick.track.file,
      status: pick.track.status,
    },
    total_beats: pick.totalBeats,
    duration_sec: pick.durationSec,
    words: words.map((w) => w.text),
    recipe_gaps,
    fact_source_url: input.fact.source_url,
    fact_verified_at: input.fact.verified_at ?? '',
    no_publish: true,
  }
  return { props, receipt }
}

/** Build validated montage props and a receipt, or a structured failure. */
export function buildMontageProps(input: BuildMontageInput): MontageBuildResult {
  const factGate = gateFact(input.fact, input.now)
  if (!factGate.ok) {
    return factGate
  }
  const poolGate = gatePool(input.pool)
  if (!poolGate.ok) {
    return poolGate
  }
  const brandGate = gateBrand(input.brand)
  if (!brandGate.ok) {
    return brandGate
  }

  const today = localToday(input.now, input.timeZone ?? 'Pacific/Auckland')
  const built = input.profile.buildWords(input.fact, { now: input.now, today })
  if (!built.ok) {
    return fail(built.reason, built.detail, '请检查产品事实或行业词库')
  }
  const words = built.words
  const wordGate = gateWords(words)
  if (!wordGate.ok) {
    return wordGate
  }
  if (words.length < 10) {
    return fail('too_few_words', `词数量只有 ${words.length} 个，至少需要 10 个`, '请补充更多产品事实或包含项目')
  }
  if (words.length > 30) {
    return fail('too_many_words', `词数量有 ${words.length} 个，最多 30 个`, '请精简词库')
  }

  const echo = echoCheck(input.fact, words)
  if (!echo.ok) {
    return echo
  }

  const sum = words.reduce((acc, w) => acc + w.beats, 0)
  const pick = pickMusic(input.tracks, sum + 2)
  if (pick === null) {
    return fail('no_usable_music', '没有可用的音乐', '请补充或更换音乐')
  }
  if (sum > pick.totalBeats - 2) {
    return fail('no_usable_music', `词总拍数 ${sum} 超过可用拍数 ${pick.totalBeats - 2}`, '请精简词库或更换音乐')
  }

  const { props, receipt } = assemble(input, poolGate.clips, pick, words)
  return { ok: true, props, receipt }
}
