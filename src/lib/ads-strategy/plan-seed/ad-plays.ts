import { PLAY_CATALOG, type PlayKey } from '../play-vocabulary'

/** 允许的广告打法（单一来源：play-vocabulary 的 PLAY_CATALOG）。 */
export const PLAY_KEYS: readonly PlayKey[] = Object.keys(PLAY_CATALOG) as PlayKey[]

/** 一条广告打法：步骤编号 + 打法。 */
export interface AdPlay {
  step_key: string
  play: PlayKey
}

const STEP_KEY_RE = /^[a-z0-9_-]+$/
const MAX_STEP_KEY_LEN = 40
const MAX_PLAYS = 8

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isPlayKey(v: unknown): v is PlayKey {
  return typeof v === 'string' && (PLAY_KEYS as readonly string[]).includes(v)
}

/**
 * 校验单条打法。合法返回 AdPlay（step_key 已 trim），否则返回错误原因字符串。
 * 严格版和宽松版共用这一份规则。
 */
function parseOne(item: unknown): AdPlay | string {
  if (!isPlainObject(item)) return '不是对象'
  const rawKey = item.step_key
  if (typeof rawKey !== 'string') return 'step_key 不合法'
  const stepKey = rawKey.trim()
  if (stepKey.length === 0 || stepKey.length > MAX_STEP_KEY_LEN || !STEP_KEY_RE.test(stepKey)) {
    return 'step_key 不合法'
  }
  if (!isPlayKey(item.play)) return 'play 不在允许范围内'
  return { step_key: stepKey, play: item.play }
}

/**
 * 严格解析广告打法列表。任何一条不合法都整体失败，返回中文错误信息。
 */
export function parseAdPlays(raw: unknown): { ok: true; plays: AdPlay[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: '广告打法必须是一个列表' }
  if (raw.length < 1 || raw.length > MAX_PLAYS) {
    return { ok: false, error: '广告打法至少 1 条、最多 8 条' }
  }
  const plays: AdPlay[] = []
  const seen = new Set<string>()
  for (let i = 0; i < raw.length; i++) {
    const res = parseOne(raw[i])
    if (typeof res === 'string') {
      if (res === '不是对象') return { ok: false, error: `第 ${i + 1} 项不是对象` }
      if (res === 'play 不在允许范围内') return { ok: false, error: `第 ${i + 1} 项的 play 不在允许范围内` }
      return {
        ok: false,
        error: `第 ${i + 1} 项的 step_key 不合法（只能用小写字母、数字、- 和 _，最长 40 个字符）`,
      }
    }
    if (seen.has(res.step_key)) {
      return { ok: false, error: `第 ${i + 1} 项的 step_key 和前面重复` }
    }
    seen.add(res.step_key)
    plays.push(res)
  }
  return { ok: true, plays }
}

/**
 * 宽松解析（用于 LLM 输出）：永不抛错。
 * 丢弃不合法项、丢弃重复 step_key（保留第一条），最多保留 8 条。
 */
export function lenientAdPlays(raw: unknown): AdPlay[] {
  if (!Array.isArray(raw)) return []
  const out: AdPlay[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (out.length >= MAX_PLAYS) break
    const res = parseOne(item)
    if (typeof res === 'string') continue
    if (seen.has(res.step_key)) continue
    seen.add(res.step_key)
    out.push({ step_key: res.step_key, play: res.play })
  }
  return out
}

/**
 * 华佗生成入口用：严格校验 LLM 给的 ad_plays。
 * 不是数组 / 任何一条不合法 / 超过 8 条 / step_key 重复 → 返回 undefined（调用方应删掉该键）。
 * 返回值只含 step_key 与 play 两个字段，多余字段（如预算）一律丢弃。
 */
export function sanitizeSeedAdPlays(raw: unknown): AdPlay[] | undefined {
  const res = parseAdPlays(raw)
  return res.ok ? res.plays : undefined
}

/** 华佗 LLM 输出的 ad_plays 清洗结果：成功（plays 可为空数组）或失败（带中文原因，不含 LLM 原文）。 */
export type LlmAdPlaysResult = { ok: true; plays: AdPlay[] } | { ok: false; reason: string }

/**
 * 华佗 LLM 输出专用：只读 play，step_key 由系统按阶段号 + 序号生成。
 * LLM 给的 step_key 及其它字段（预算、账户等）一律忽略。
 */
export function adPlaysFromLlm(raw: unknown, phaseNumber: number): LlmAdPlaysResult {
  const n = Number.isInteger(phaseNumber) && phaseNumber >= 0 ? phaseNumber : 0
  if (!Array.isArray(raw)) return { ok: false, reason: '广告打法必须是一个列表' }
  if (raw.length === 0) return { ok: true, plays: [] }
  if (raw.length > MAX_PLAYS) return { ok: false, reason: '广告打法最多 8 条' }
  const plays: AdPlay[] = []
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i]
    if (!isPlainObject(item)) return { ok: false, reason: `第 ${i + 1} 项不是对象` }
    if (!isPlayKey(item.play)) return { ok: false, reason: `第 ${i + 1} 项的 play 不在允许范围内` }
    plays.push({ step_key: `p${n}-${i + 1}-${item.play}`, play: item.play })
  }
  return { ok: true, plays }
}

/** 内存中的「ad_plays 被丢弃」标记，仅用于日志/诊断，永不持久化。 */
const droppedSeeds = new WeakSet<object>()

export function markAdPlaysDropped(seed: object): void {
  droppedSeeds.add(seed)
}

export function wasAdPlaysDropped(seed: object): boolean {
  return droppedSeeds.has(seed)
}

/**
 * 两个生成入口共用的 ad_plays 落地逻辑。
 * - raw 为 undefined/null：LLM 主动不给 → 删键，不打标记、不记日志。
 * - 解析成功且非空：写入系统生成的 plays。
 * - 解析成功但为空：删键，不打标记、不记日志。
 * - 解析失败：删键 + 打标记 + 记一条 warn。
 */
export function applyLlmAdPlays(
  target: { ad_plays?: { step_key: string; play: string }[] },
  raw: unknown,
  phaseNumber: number,
): void {
  if (raw === undefined || raw === null) {
    delete target.ad_plays
    return
  }
  const res = adPlaysFromLlm(raw, phaseNumber)
  if (res.ok) {
    if (res.plays.length > 0) {
      target.ad_plays = res.plays
    } else {
      delete target.ad_plays
    }
    return
  }
  delete target.ad_plays
  markAdPlaysDropped(target)
  const n = Number.isInteger(phaseNumber) && phaseNumber >= 0 ? phaseNumber : 0
  console.warn(`[huatuo] ad_plays dropped phase=${n} reason=${res.reason}`)
}
